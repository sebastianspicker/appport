use super::{join2, AuthorizedCatalog, CatalogService, DeviceSummary, RelutionClient};
use crate::error::Error;
use crate::{
    application::test_support::{client as test_client, run, server, Response},
    domain::{catalog::AppInstallState, device::DeviceEvidence},
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

#[path = "catalog_concurrency_tests.rs"]
mod concurrency;
#[path = "catalog_icon_tests.rs"]
mod icons;
#[path = "catalog_performance.rs"]
mod performance;
#[path = "catalog_snapshot_tests.rs"]
mod snapshots;

fn device() -> DeviceSummary {
    DeviceSummary {
        id: "device".into(),
        name: "Device".into(),
        status: "COMPLIANT".into(),
    }
}

fn client(base: url::Url) -> Arc<RelutionClient> {
    test_client(base, true)
}

fn catalog(entries: &[(&str, &str)]) -> String {
    let entries = entries
        .iter()
        .map(|(id, version)| format!(r#"{{"uuid":"{id}","name":"{id}","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{{"RELEASE":{{"uuid":"{id}-{version}","versionName":"{version}"}}}},"icon":"icon","internalName":"{id}.package"}}"#))
        .collect::<Vec<_>>()
        .join(",");
    format!(r#"{{"results":[{entries}]}}"#)
}

fn direct_user_permission() -> Response {
    Response::json(
        200,
        r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#,
    )
}

fn catalog_read_response(
    request: &str,
    entries: &[(&str, &str)],
    groups: &str,
    inventory: &str,
) -> Option<Response> {
    catalog_body_response(request, &catalog(entries), groups, inventory)
}

fn catalog_body_response(
    request: &str,
    body: &str,
    groups: &str,
    inventory: &str,
) -> Option<Response> {
    if request.contains("/content/apps/baseInfo") {
        return Some(Response::json(200, body));
    }
    if request.contains("/security/users/user/groups") {
        return Some(Response::json(200, groups));
    }
    if request.contains("/installedApps/baseInfo/query") {
        return Some(Response::json(200, inventory));
    }
    None
}

fn assigned_device_response(id: &str, name: &str) -> Response {
    Response::json(
        200,
        format!(
            r#"{{"results":[{{"uuid":"{id}","deviceId":"device-evidence","name":"{name}","status":"COMPLIANT","platform":"WINDOWS","userUuid":"user","organizationUuid":"tenant","serialNumber":null}}]}}"#
        ),
    )
}

fn snapshot_catalog_response(request: &str, body: &str) -> Option<Response> {
    if request.contains("/devices/baseInfo/query") {
        return Some(assigned_device_response("device", "Device"));
    }
    catalog_body_response(request, body, r#"{"groups":[]}"#, r#"{"results":[]}"#)
}

fn allowed_catalog_response(request: &str) -> Option<Response> {
    catalog_read_response(
        request,
        &[("allowed", "1")],
        r#"{"groups":[]}"#,
        r#"{"results":[]}"#,
    )
    .or_else(|| {
        request
            .contains("/permissions/RELEASE")
            .then(direct_user_permission)
    })
}

fn snapshot_response(request: &str) -> Response {
    snapshot_catalog_response(request, &catalog(&[("allowed", "1")]))
        .or_else(|| allowed_catalog_response(request))
        .expect("snapshot request")
}

fn snapshot_service(base: url::Url) -> CatalogService {
    CatalogService::with_test_device_evidence(
        client(base),
        DeviceEvidence {
            version: 1,
            ent_dmid: Some("device-evidence".into()),
            smbios_uuid: None,
            bios_serial: None,
            hostname: "Device".into(),
        },
    )
}

fn concurrent_server(
    expected: usize,
    response: impl Fn(&str) -> Response + Send + Sync + 'static,
) -> (url::Url, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind concurrent server");
    let address = listener.local_addr().expect("server address");
    let requests = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&requests);
    let response = Arc::new(response);
    let handle = thread::spawn(move || {
        let mut handlers = Vec::with_capacity(expected);
        for _ in 0..expected {
            let (mut stream, _) = listener.accept().expect("server request");
            let response = Arc::clone(&response);
            let count = Arc::clone(&count);
            handlers.push(thread::spawn(move || {
                let mut request = [0_u8; 16 * 1024];
                let bytes = stream.read(&mut request).expect("read request");
                let response =
                    response(std::str::from_utf8(&request[..bytes]).expect("HTTP text"));
                count.fetch_add(1, Ordering::SeqCst);
                write!(
                    stream,
                    "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.content_type,
                    response.body.len(),
                    response.body
                )
                .expect("write response");
            }));
        }
        for handler in handlers {
            handler.join().expect("request handler");
        }
    });
    (
        url::Url::parse(&format!("http://{address}/")).expect("server URL"),
        requests,
        handle,
    )
}

#[test]
fn catalog_permissions_fail_closed_but_allow_direct_group_and_recursive_assignments() {
    let (base, requests, handle) = server(8, |request| {
        if let Some(response) = catalog_read_response(
            request,
            &[
                ("direct-user", "1"),
                ("direct-group", "1"),
                ("recursive", "1"),
                ("denied", "1"),
            ],
            r#"{"groups":[{"uuid":"direct-group"}]}"#,
            r#"{"results":[]}"#,
        ) {
            return response;
        }
        if request.contains("/permissions/RELEASE") && request.contains("direct-user") {
            return direct_user_permission();
        }
        if request.contains("/permissions/RELEASE") && request.contains("direct-group") {
            return Response::json(
                200,
                r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"direct-group","type":"GROUP"}}]}"#,
            );
        }
        if request.contains("/permissions/RELEASE") && request.contains("recursive") {
            return Response::json(
                200,
                r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}}]}"#,
            );
        }
        if request.contains("/security/groups/nested/members") {
            return Response::json(200, r#"{"results":[{"uuid":"user"}]}"#);
        }
        Response::json(
            200,
            r#"{"results":[{"read":false,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#,
        )
    });
    let service = CatalogService::new(client(base));

    let result =
        run(service.authorized_catalog("token", "user", &device(), "en-US")).expect("catalog");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 8);
    assert_eq!(result.assigned_eligible_count, 3);
    assert_eq!(
        result
            .rows
            .iter()
            .map(|app| app.id.as_str())
            .collect::<Vec<_>>(),
        ["direct-group", "direct-user", "recursive"]
    );
}

#[test]
fn catalog_suppresses_current_installs_and_exposes_updates() {
    let (base, requests, handle) = server(5, |request| {
        if let Some(response) = catalog_read_response(
            request,
            &[("current", "1"), ("update", "2")],
            r#"{"groups":[]}"#,
            r#"{"results":[{"identifier":"current.package","name":"current","appUuid":"current","versionUuid":"current-1","versionToShow":"1","versionName":null,"hasUpdateAvailable":false},{"identifier":"update.package","name":"update","appUuid":"update","versionUuid":"update-1","versionToShow":"1","versionName":null,"hasUpdateAvailable":false}]}"#,
        ) {
            return response;
        }
        direct_user_permission()
    });
    let service = CatalogService::new(client(base));

    let result =
        run(service.authorized_catalog("token", "user", &device(), "en-US")).expect("catalog");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 5);
    assert_eq!(result.assigned_eligible_count, 2);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "update");
    assert_eq!(
        result.rows[0].install_state,
        AppInstallState::UpdateAvailable
    );
}

#[test]
fn credential_generation_fences_cold_catalog_reads_and_authorizes_icon_fetches() {
    let (base, requests, handle) = server(9, |request| {
        if let Some(response) = allowed_catalog_response(request) {
            return response;
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        Response {
            status: 200,
            content_type: "image/png",
            body: "png".into(),
        }
    });
    let service = CatalogService::new(client(base));
    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US"))
            .expect("initial catalog")
            .rows
            .len(),
        1
    );
    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US"))
            .expect("cached catalog")
            .rows
            .len(),
        1
    );
    assert!(run(service.icon("token", "user", "allowed", 7, "en-US"))
        .expect("authorized icon")
        .is_some());
    assert!(run(service.icon("token", "user", "allowed", 7, "en-US"))
        .expect("cached icon")
        .is_some());
    assert!(matches!(
        run(service.icon("token", "user", "denied", 7, "en-US")),
        Err(error) if error == Error::server("application is not permitted")
    ));
    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &device(), 8, "en-US"))
            .expect("next generation catalog")
            .rows
            .len(),
        1
    );

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 9);
}

#[test]
fn invalidation_refreshes_only_the_current_generation_and_rejects_the_prior_one() {
    let (base, requests, handle) = server(12, |request| {
        allowed_catalog_response(request).expect("catalog request")
    });
    let service = CatalogService::new(client(base));
    run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US"))
        .expect("initial catalog");
    run(service.invalidate_apps(7)).expect("current generation invalidated");
    run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US"))
        .expect("refreshed catalog");
    run(service.cached_authorized_catalog("token", "user", &device(), 8, "en-US"))
        .expect("advanced generation catalog");
    assert!(matches!(
        run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US")),
        Err(error) if error == Error::session_expired("stale cache generation")
    ));

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 12);
}

#[test]
fn cold_and_forced_refreshes_coalesce_and_publish_one_revision() {
    let (base, requests, handle) = server(10, snapshot_response);
    let service = snapshot_service(base);

    let (first, second) = run(join2(
        service.authorized_snapshot("token", "user", 7, "en-US", false),
        service.authorized_snapshot("token", "user", 7, "en-US", false),
    ));
    let first = first.expect("first cold snapshot");
    let second = second.expect("coalesced cold snapshot");
    assert_eq!(first.revision, second.revision);

    let (forced, also_forced) = run(join2(
        service.authorized_snapshot("token", "user", 7, "en-US", true),
        service.authorized_snapshot("token", "user", 7, "en-US", true),
    ));
    let forced = forced.expect("forced snapshot");
    let also_forced = also_forced.expect("coalesced forced snapshot");
    assert_ne!(first.revision, forced.revision);
    assert_eq!(forced.revision, also_forced.revision);

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 10);
}

#[test]
fn expired_snapshot_is_refreshed_instead_of_used_as_fallback() {
    let (base, requests, handle) = server(10, snapshot_response);
    let service = snapshot_service(base).with_cache_ttl(Duration::ZERO);

    let first = run(service.authorized_snapshot("token", "user", 7, "en-US", false))
        .expect("first snapshot");
    let second = run(service.authorized_snapshot("token", "user", 7, "en-US", false))
        .expect("refreshed snapshot");
    assert_ne!(first.revision, second.revision);

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 10);
}

impl CatalogService {
    async fn cached_authorized_catalog(
        &self,
        token: &str,
        user_uuid: &str,
        device: &DeviceSummary,
        generation: u64,
        locale: &str,
    ) -> Result<AuthorizedCatalog, Error> {
        let context = self.cache.context(generation, locale)?;
        if let Some(catalog) = self.cache.catalog(generation, locale, self.catalog_ttl)? {
            return Ok(catalog);
        }
        let _refresh = self.catalog_refresh.lock().await;
        if let Some(catalog) = self.cache.refreshed_since(&context, self.catalog_ttl)? {
            return Ok(catalog);
        }
        let catalog = self
            .authorized_catalog(token, user_uuid, device, locale)
            .await?;
        self.cache.store_catalog(&context, catalog.clone())?;
        Ok(catalog)
    }
}
