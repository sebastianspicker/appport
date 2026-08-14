use super::actions::has_blocking_remote_action;
use super::*;

fn remote_action(
    uuid: &str,
    state: &str,
    app: Option<&str>,
    version: Option<&str>,
    package: Option<&str>,
) -> dto::DeviceAction {
    dto::DeviceAction {
        uuid: uuid.into(),
        state: state.into(),
        creation_date: 100,
        details: Some(dto::ActionDetails {
            app_uuid: app.map(str::to_owned),
            version_uuid: version.map(str::to_owned),
            package: package.map(str::to_owned),
        }),
    }
}

fn action_app() -> AvailableApp {
    AvailableApp {
        id: "app".into(),
        name: "app".into(),
        description: None,
        publisher: None,
        source: crate::wire::AppSource::Winget,
        package_identifier: None,
        released_version_id: "version".into(),
        released_version_label: None,
        installed_version_id: None,
        installed_version_label: None,
        install_state: crate::wire::AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: false,
    }
}

fn test_client(base: Url) -> RelutionClient {
    RelutionClient::new(RelutionConfig {
        base,
        organization_uuid: "10000000-0000-4000-8000-000000000001".into(),
        native_app_uuid: "20000000-0000-4000-8000-000000000002".into(),
        writes_enabled: false,
    })
    .unwrap()
}

fn test_device() -> CurrentDevice {
    CurrentDevice {
        id: "device".into(),
        wire: NativeDevice {
            name: "Device".into(),
            status: "COMPLIANT".into(),
            last_seen_at: None,
        },
    }
}

fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

fn catalog_response(path: &str) -> CatalogMockResponse {
    let body = if path.ends_with("/content/apps/baseInfo") {
        r#"{"results":[{"uuid":"app","name":"app","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"version","versionName":"1"}},"icon":null,"internalName":null}]}"#
    } else if path.ends_with("/security/users/user/groups") {
        r#"{"groups":[]}"#
    } else if path.ends_with("/installedApps/baseInfo/query") {
        r#"{"results":[]}"#
    } else {
        r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#
    };
    CatalogMockResponse {
        status: 200,
        content_type: "application/json",
        body: body.into(),
    }
}

#[test]
fn active_or_unmapped_remote_actions_block_but_failed_and_cancelled_actions_do_not() {
    let app = action_app();
    let active = remote_action("active", "PENDING", Some("app"), Some("version"), None);
    let failed = remote_action("failed", "ERROR", Some("app"), Some("version"), None);
    let cancelled = remote_action("cancelled", "CANCELLED", Some("app"), Some("version"), None);
    let unknown = remote_action("unknown", "FUTURE", Some("app"), Some("version"), None);

    assert!(has_blocking_remote_action(&[active], &app));
    assert!(!has_blocking_remote_action(&[failed, cancelled], &app));
    assert!(has_blocking_remote_action(&[unknown], &app));
}

#[test]
fn native_application_probe_is_excluded_before_action_reservation() {
    let native_app_uuid = "20000000-0000-4000-8000-000000000002";
    let catalog: dto::Catalog = serde_json::from_str(&format!(
        r#"{{"uuid":"{native_app_uuid}","name":"Appport","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{{"RELEASE":{{"uuid":"version","versionName":"1"}}}},"icon":null,"internalName":null}}"#
    ))
    .unwrap();

    assert!(app_from(catalog, native_app_uuid).is_none());
}

#[test]
fn matching_remote_action_yields_zero_deployment_posts() {
    let deployment_posts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (base, requests, server) = mock_catalog_server(1, {
        let deployment_posts = std::sync::Arc::clone(&deployment_posts);
        move |request| {
            let path = request_path(request);
            if request.starts_with("POST ") && path.contains("/deployments") {
                deployment_posts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            assert!(path.ends_with("/devices/device/actions"));
            CatalogMockResponse {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[{"uuid":"existing","state":"PENDING","creationDate":100,"details":{"appUuid":"app","versionUuid":"version","appInternalName":null}}]}"#.into(),
            }
        }
    });
    let client = RelutionClient::new(RelutionConfig {
        base,
        organization_uuid: "10000000-0000-4000-8000-000000000001".into(),
        native_app_uuid: "20000000-0000-4000-8000-000000000002".into(),
        writes_enabled: true,
    })
    .unwrap();

    let result = run(client.request_action_with_context(
        "token",
        test_device(),
        action_app(),
        crate::wire::ActionIntent::Install,
    ));
    assert!(matches!(
        result,
        Err(error) if error == "server: a matching Relution action is already active"
    ));
    server.join().unwrap();
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_eq!(
        deployment_posts.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[test]
fn remote_action_identity_requires_a_match_without_any_contradiction() {
    let matches = |app, version, package| {
        action_details_match(
            remote_action("candidate", "PENDING", app, version, package)
                .details
                .as_ref(),
            "app",
            "version",
            Some("package"),
        )
    };

    assert!(matches(Some("app"), Some("version"), None));
    assert!(matches(None, None, Some("package")));
    assert!(!matches(Some("other"), Some("version"), None));
    assert!(!matches(Some("app"), Some("other"), None));
    assert!(!matches(Some("app"), Some("version"), Some("other")));
    assert!(!matches(None, None, None));
}

#[test]
fn correlation_excludes_mixed_identity_mismatches() {
    let action = crate::journal::Action {
        id: "local".into(),
        device_id: "device".into(),
        app_id: "app".into(),
        version_id: "version".into(),
        package_id: Some("package".into()),
        intent: "install".into(),
        baseline: String::new(),
        correlation: None,
        state: crate::journal::State::Queued,
        error_code: None,
        error_message: None,
        created_at: 100,
        updated_at: 100,
    };
    let baseline = std::collections::HashSet::new();
    let candidates = correlation_candidates(
        vec![
            remote_action("match", "PENDING", Some("app"), Some("version"), None),
            remote_action(
                "app-mismatch",
                "PENDING",
                Some("other"),
                Some("version"),
                None,
            ),
            remote_action(
                "package-mismatch",
                "PENDING",
                Some("app"),
                None,
                Some("other"),
            ),
            remote_action("package-match", "PENDING", None, None, Some("package")),
        ],
        &baseline,
        &action,
    );

    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.uuid.as_str())
            .collect::<Vec<_>>(),
        ["match", "package-match"]
    );
}

#[test]
fn same_generation_catalog_invalidation_refetches_apps_and_keeps_icons() {
    let (base, requests, server) =
        mock_catalog_server(8, move |request| catalog_response(request_path(request)));
    let client = test_client(base);
    let device = test_device();

    assert_eq!(
        run(client.cached_apps("token", "user", &device, 7))
            .unwrap()
            .len(),
        1
    );
    client
        .cache_for(7)
        .unwrap()
        .icons
        .insert("app".into(), Some("icon".into()));
    run(client.invalidate_cached_apps(7)).unwrap();
    {
        let cache = client.cache_for(7).unwrap();
        assert!(cache.apps.is_none());
        assert_eq!(
            cache.icons.get("app").and_then(|icon| icon.as_deref()),
            Some("icon")
        );
    }
    assert_eq!(
        run(client.cached_apps("token", "user", &device, 7))
            .unwrap()
            .len(),
        1
    );

    server.join().unwrap();
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 8);
}

#[test]
fn catalog_invalidation_waits_for_an_in_progress_refresh_before_clearing() {
    let client = std::sync::Arc::new(test_client(Url::parse("http://127.0.0.1:1/").unwrap()));
    {
        let mut cache = client.cache_for(7).unwrap();
        cache.icons.insert("app".into(), Some("icon".into()));
    }
    run(async {
        let refresh = client.catalog_refresh.lock().await;
        let invalidating_client = std::sync::Arc::clone(&client);
        let invalidation =
            tokio::spawn(async move { invalidating_client.invalidate_cached_apps(7).await });
        tokio::task::yield_now().await;
        assert!(!invalidation.is_finished());
        client.cache_for(7).unwrap().apps = Some(vec![action_app()]);
        drop(refresh);
        invalidation.await.unwrap().unwrap();
    });
    let cache = client.cache_for(7).unwrap();
    assert!(cache.apps.is_none());
    assert_eq!(
        cache.icons.get("app").and_then(|icon| icon.as_deref()),
        Some("icon")
    );
}
