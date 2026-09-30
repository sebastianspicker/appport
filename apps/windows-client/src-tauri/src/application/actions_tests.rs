use super::{has_blocking_remote_action, Action, ActionService, AvailableApp, RelutionClient};
use crate::error::Error;
use crate::{
    application::{
        action_test_support::{
            catalog_response, journal_environment, JournalSandbox, DIRECT_PERMISSION,
            EMPTY_INVENTORY,
        },
        catalog::CatalogService,
        test_support::{client, run, server as requests_server, Response},
    },
    domain::{
        action::{RemoteAction, RemoteActionDetails, Reservation, State},
        catalog::{AppInstallState, AppSource},
        device::DeviceEvidence,
    },
    infrastructure::journal,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

fn app() -> AvailableApp {
    AvailableApp {
        id: "app".into(),
        name: "App".into(),
        description: None,
        publisher: None,
        source: AppSource::Winget,
        package_identifier: Some("app.package".into()),
        released_version_id: "version".into(),
        released_version_label: Some("2".into()),
        installed_version_id: None,
        installed_version_label: None,
        install_state: AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: false,
    }
}

fn service(client: Arc<RelutionClient>) -> ActionService {
    ActionService::new(Arc::clone(&client), Arc::new(CatalogService::new(client)))
}

fn service_with_test_evidence(client: Arc<RelutionClient>) -> (ActionService, Arc<CatalogService>) {
    let catalog = Arc::new(CatalogService::with_test_device_evidence(
        Arc::clone(&client),
        DeviceEvidence {
            version: 1,
            ent_dmid: Some("device-evidence".into()),
            smbios_uuid: None,
            bios_serial: None,
            hostname: "Device".into(),
        },
    ));
    (ActionService::new(client, Arc::clone(&catalog)), catalog)
}

fn one_request_server(
    expected_path: &'static str,
    status: u16,
    body: &'static str,
) -> (url::Url, Arc<AtomicUsize>, std::thread::JoinHandle<()>) {
    requests_server(1, move |request| {
        assert!(request.contains(expected_path));
        Response::json(status, body)
    })
}

#[test]
fn active_and_unmapped_remote_actions_block_a_new_reservation() {
    let action = |id: &str, state: &str| RemoteAction {
        id: id.into(),
        state: state.into(),
        created_at: 1,
        details: Some(RemoteActionDetails {
            app_id: Some("app".into()),
            version_id: Some("version".into()),
            package_id: Some("app.package".into()),
        }),
    };

    assert!(has_blocking_remote_action(
        &[action("active", "PENDING")],
        &app()
    ));
    assert!(!has_blocking_remote_action(
        &[action("failed", "ERROR")],
        &app()
    ));
    assert!(has_blocking_remote_action(
        &[action("unknown", "FUTURE")],
        &app()
    ));
}

#[test]
fn reserved_submission_is_not_retried_and_ambiguous_delivery_stays_unknown() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let (base, requests, handle) =
        one_request_server("/content/apps/app/versions/version/deployments", 503, "{}");
    let client = client(base, true);
    let service = service(Arc::clone(&client));
    run(journal::ActionJournal::new().reserve(Reservation {
        id: "action",
        tenant: "tenant",
        device: "device",
        app: "app",
        version: "version",
        package: Some("app.package"),
        intent: crate::domain::action::Intent::Install,
        baseline: "",
    }))
    .expect("reserve before deployment");

    run(service.record_submission(
        "action",
        run(client.deploy("token", "app", "version", "device")),
    ))
    .expect("ambiguous response is retained");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    let action = run(journal::ActionJournal::new().action("action"))
        .expect("journal read")
        .expect("saved action");
    assert_eq!(action.state, State::Unknown);
    assert_eq!(action.error_code.as_deref(), Some("SUBMISSION_UNCERTAIN"));
}

#[test]
fn reconciliation_requires_exact_inventory_identity() {
    let (base, requests, handle) = one_request_server(
        "/installedApps/baseInfo/query",
        200,
        r#"{"results":[{"identifier":"other.package","name":"App","appUuid":"app","versionUuid":"version","versionToShow":"2","versionName":null,"hasUpdateAvailable":false}]}"#,
    );
    let service = service(client(base, true));
    let action = Action {
        id: "action".into(),
        device_id: "device".into(),
        app_id: "app".into(),
        version_id: "version".into(),
        package_id: Some("app.package".into()),
        intent: crate::domain::action::Intent::Install,
        baseline: String::new(),
        correlation: None,
        state: State::Verifying,
        error_code: None,
        error_message: None,
        created_at: 1,
        updated_at: 1,
    };

    assert!(!run(service.target_installed("token", &action)).expect("inventory response"));

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[test]
fn request_action_revalidates_cached_authority_then_reserves_before_one_deployment() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_requests = Arc::clone(&observed);
    let deployments = Arc::new(AtomicUsize::new(0));
    let deployment_requests = Arc::clone(&deployments);
    let (base, requests, handle) = requests_server(12, move |request| {
        observed_requests
            .lock()
            .expect("observed request lock")
            .push(request.lines().next().expect("request line").to_owned());
        if let Some(response) = catalog_response(request, DIRECT_PERMISSION) {
            return response;
        }
        if request.contains("/api/management/v1/devices/device/actions") {
            return Response::json(200, EMPTY_INVENTORY);
        }
        assert!(request
            .contains("POST /api/management/v1/content/apps/app/versions/version/deployments"));
        for field in [
            r#""appUuid":"app""#,
            r#""versionUuid":"version""#,
            r#""deviceUuid":"device""#,
        ] {
            assert!(
                request.contains(field),
                "deployment body is missing {field}"
            );
        }
        deployment_requests.fetch_add(1, Ordering::SeqCst);
        let active = run(journal::ActionJournal::new().active_actions("device"))
            .expect("read durable reservation");
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].app_id, "app");
        assert_eq!(active[0].state, State::Reserved);
        Response::json(200, r#"{"results":[{"successful":true}]}"#)
    });
    let client = client(base, true);
    let (service, catalog) = service_with_test_evidence(client);

    run(catalog.bootstrap("token", "User", "user", 7, "en-US")).expect("prime cache");
    let action =
        run(service.request_action("token", "user", "app", "en-US")).expect("accepted action");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 12);
    assert_eq!(deployments.load(Ordering::SeqCst), 1);
    assert_eq!(action.state, crate::domain::action::ActionState::Queued);
    let saved = run(journal::ActionJournal::new().action(&action.id))
        .expect("journal read")
        .expect("saved action");
    assert_eq!(saved.state, State::Queued);
    assert_eq!(saved.device_id, "device");
    assert_eq!(saved.app_id, "app");
    assert_eq!(saved.version_id, "version");
    assert_eq!(saved.package_id.as_deref(), Some("app.package"));
    let observed = observed.lock().expect("observed request lock");
    for path in [
        "/api/management/v2/devices/baseInfo/query",
        "/api/management/v1/content/apps/baseInfo",
        "/api/management/v1/security/users/user/groups",
        "/api/management/v2/devices/device/installedApps/baseInfo/query",
        "/api/management/v1/content/apps/app/permissions/RELEASE",
    ] {
        assert_eq!(
            observed
                .iter()
                .filter(|request| request.contains(path))
                .count(),
            2,
            "cached request_action input was not revalidated: {path}"
        );
    }
    assert_eq!(
        observed
            .iter()
            .filter(|request| request.contains("/api/management/v1/devices/device/actions"))
            .count(),
        1
    );
    assert_eq!(
        observed
            .iter()
            .filter(|request| request.contains("/deployments"))
            .count(),
        1
    );
}

#[test]
fn request_action_persists_unknown_after_one_ambiguous_deployment_submission() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let deployments = Arc::new(AtomicUsize::new(0));
    let deployment_requests = Arc::clone(&deployments);
    let (base, requests, handle) = requests_server(7, move |request| {
        if let Some(response) = catalog_response(request, DIRECT_PERMISSION) {
            return response;
        }
        if request.contains("/api/management/v1/devices/device/actions") {
            return Response::json(200, EMPTY_INVENTORY);
        }
        assert!(request
            .contains("POST /api/management/v1/content/apps/app/versions/version/deployments"));
        deployment_requests.fetch_add(1, Ordering::SeqCst);
        assert_eq!(
            run(journal::ActionJournal::new().active_actions("device"))
                .expect("read durable reservation")
                .as_slice()[0]
                .state,
            State::Reserved
        );
        Response::json(503, "{}")
    });
    let (service, _) = service_with_test_evidence(client(base, true));

    let action = run(service.request_action("token", "user", "app", "en-US"))
        .expect("uncertain submission is retained");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 7);
    assert_eq!(deployments.load(Ordering::SeqCst), 1);
    assert_eq!(action.state, crate::domain::action::ActionState::Unknown);
    let saved = run(journal::ActionJournal::new().action(&action.id))
        .expect("journal read")
        .expect("saved action");
    assert_eq!(saved.state, State::Unknown);
    assert_eq!(saved.error_code.as_deref(), Some("SUBMISSION_UNCERTAIN"));
}

#[test]
fn request_action_denies_unauthorized_apps_before_reservation_or_deployment() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let deployments = Arc::new(AtomicUsize::new(0));
    let deployment_requests = Arc::clone(&deployments);
    let (base, requests, handle) = requests_server(5, move |request| {
        if request.contains("/deployments") {
            deployment_requests.fetch_add(1, Ordering::SeqCst);
        }
        catalog_response(
            request,
            r#"{"results":[{"read":false,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#,
        )
        .expect("authorization validation request")
    });
    let (service, _) = service_with_test_evidence(client(base, true));

    assert!(matches!(
        run(service.request_action("token", "user", "app", "en-US")),
        Err(error) if error == Error::server("application is not permitted")
    ));

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 5);
    assert_eq!(deployments.load(Ordering::SeqCst), 0);
    assert!(run(journal::ActionJournal::new().active_actions("device"))
        .expect("journal read")
        .is_empty());
}

#[test]
fn request_action_blocks_matching_remote_actions_before_reservation_or_deployment() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let deployments = Arc::new(AtomicUsize::new(0));
    let deployment_requests = Arc::clone(&deployments);
    let (base, requests, handle) = requests_server(6, move |request| {
        if request.contains("/deployments") {
            deployment_requests.fetch_add(1, Ordering::SeqCst);
        }
        if let Some(response) = catalog_response(request, DIRECT_PERMISSION) {
            return response;
        }
        assert!(request.contains("/api/management/v1/devices/device/actions"));
        Response::json(
            200,
            r#"{"results":[{"uuid":"remote","state":"PENDING","creationDate":1,"details":{"appUuid":"app","versionUuid":"version","appInternalName":"app.package"}}]}"#,
        )
    });
    let (service, _) = service_with_test_evidence(client(base, true));

    assert!(matches!(
        run(service.request_action("token", "user", "app", "en-US")),
        Err(error) if error == Error::server("a matching Relution action is already active")
    ));

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 6);
    assert_eq!(deployments.load(Ordering::SeqCst), 0);
    assert!(run(journal::ActionJournal::new().active_actions("device"))
        .expect("journal read")
        .is_empty());
}
