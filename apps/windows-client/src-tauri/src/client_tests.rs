use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    },
    thread,
};

struct MockResponse {
    status: u16,
    content_type: &'static str,
    body: String,
}

fn mock_server(responses: Vec<MockResponse>) -> (Url, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let request_count = Arc::clone(&requests);
    let handle = thread::spawn(move || {
        for response in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 16 * 1024];
            let _ = stream.read(&mut request);
            request_count.fetch_add(1, Ordering::SeqCst);
            let reason = if response.status == 200 {
                "OK"
            } else {
                "Error"
            };
            write!(
                stream,
                "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.status,
                reason,
                response.content_type,
                response.body.len(),
                response.body
            )
            .unwrap();
        }
    });
    (
        Url::parse(&format!("http://{address}/")).unwrap(),
        requests,
        handle,
    )
}

fn catalog_response(names: &[&str]) -> CatalogMockResponse {
    let results = names
        .iter()
        .map(|name| format!(r#"{{"uuid":"{name}","name":"{name}","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{{"RELEASE":{{"uuid":"version","versionName":"1"}}}},"icon":null,"internalName":null}}"#))
        .collect::<Vec<_>>()
        .join(",");
    CatalogMockResponse {
        status: 200,
        content_type: "application/json",
        body: format!(r#"{{"results":[{results}]}}"#),
    }
}

fn catalog_setup_response(path: &str, names: &[&str]) -> Option<CatalogMockResponse> {
    if path.ends_with("/content/apps/baseInfo") {
        return Some(catalog_response(names));
    }
    if path.ends_with("/security/users/user/groups") {
        return Some(CatalogMockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"groups":[]}"#.into(),
        });
    }
    if path.ends_with("/installedApps/baseInfo/query") {
        return Some(CatalogMockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[]}"#.into(),
        });
    }
    None
}

fn direct_user_permission() -> CatalogMockResponse {
    CatalogMockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#.into(),
    }
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

fn test_client(base: Url) -> RelutionClient {
    RelutionClient::new(RelutionConfig {
        base,
        organization_uuid: "10000000-0000-4000-8000-000000000001".into(),
        native_app_uuid: "20000000-0000-4000-8000-000000000002".into(),
        writes_enabled: false,
    })
    .unwrap()
}

fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

fn app(id: &str, install_state: crate::wire::AppInstallState) -> AvailableApp {
    AvailableApp {
        id: id.into(),
        name: id.into(),
        description: None,
        publisher: None,
        source: crate::wire::AppSource::Winget,
        package_identifier: None,
        released_version_id: "version".into(),
        released_version_label: None,
        installed_version_id: None,
        installed_version_label: None,
        install_state,
        active_action_id: None,
        active_action_state: None,
        has_icon: false,
    }
}

#[test]
fn only_fixed_https_origins_are_accepted() {
    for value in [
        "http://example.test/",
        "https://user@example.test/",
        "https://example.test/?tenant=one",
    ] {
        assert!(!fixed_https(&Url::parse(value).unwrap()));
    }
    assert!(fixed_https(&Url::parse("https://example.test/").unwrap()));
}

#[test]
fn device_matching_fails_closed_for_ambiguous_or_invalid_evidence() {
    let evidence = evidence::NativeDeviceEvidenceV1 {
        version: 1,
        ent_dmid: Some("same".into()),
        smbios_uuid: None,
        bios_serial: None,
        hostname: "device".into(),
    };
    let device = |uuid: &str| dto::Device {
        uuid: uuid.into(),
        device_id: Some("same".into()),
        name: "device".into(),
        status: "COMPLIANT".into(),
        platform: "WINDOWS".into(),
        user_uuid: "user".into(),
        organization_uuid: "tenant".into(),
        serial_number: None,
    };
    let devices = vec![device("one"), device("two")];
    assert!(match_device(&evidence, &devices).is_err());
}

#[test]
fn device_matching_accepts_serial_and_hostname_with_harmless_formatting() {
    let evidence = evidence::NativeDeviceEvidenceV1 {
        version: 1,
        ent_dmid: None,
        smbios_uuid: Some("123e4567-e89b-12d3-a456-426614174000".into()),
        bios_serial: Some(" synthetic-42 ".into()),
        hostname: " test-win-042 ".into(),
    };
    let device = dto::Device {
        uuid: "30000000-0000-4000-8000-000000000003".into(),
        device_id: Some("ABCDEF0123456789ABCDEF0123456789".into()),
        name: "TEST-WIN-042".into(),
        status: "COMPLIANT".into(),
        platform: "WINDOWS".into(),
        user_uuid: "40000000-0000-4000-8000-000000000004".into(),
        organization_uuid: "10000000-0000-4000-8000-000000000001".into(),
        serial_number: Some("SYNTHETIC-42".into()),
    };
    assert_eq!(
        match_device(&evidence, &[device]).unwrap().uuid,
        "30000000-0000-4000-8000-000000000003"
    );
}

#[test]
fn forbidden_status_reports_missing_authorization() {
    assert_eq!(
        status(reqwest::StatusCode::FORBIDDEN),
        "authorization: account or token lacks required Relution access"
    );
}

#[test]
fn relution_action_states_are_mapped_fail_closed() {
    assert_eq!(remote_state("EXECUTED"), crate::journal::State::Verifying);
    assert_eq!(remote_state("ERROR"), crate::journal::State::Failed);
    assert_eq!(remote_state("future-state"), crate::journal::State::Unknown);
}

#[test]
fn inventory_confirmation_requires_exact_identity() {
    let item = dto::Inventory {
        identifier: Some("pkg".into()),
        _name: Some("App".into()),
        app_uuid: Some("app".into()),
        version_uuid: Some("v2".into()),
        version_to_show: None,
        version_name: None,
        update: None,
    };
    assert!(inventory_matches(&item, "app", "v2", Some("pkg")));
    assert!(!inventory_matches(&item, "app", "v1", Some("pkg")));
    assert!(!inventory_matches(&item, "app", "v2", Some("other")));
}

#[test]
fn numeric_inventory_versions_classify_teams_updates_without_uuid_authority() {
    let inventory = |version_uuid: Option<&str>, label: Option<&str>, update| dto::Inventory {
        identifier: None,
        _name: Some("App".into()),
        app_uuid: Some("app".into()),
        version_uuid: version_uuid.map(str::to_owned),
        version_to_show: label.map(str::to_owned),
        version_name: None,
        update,
    };

    let cases = [
        (
            "26198.304.4946.9672",
            "26183.1903.4892.4448",
            Some("same-release-uuid"),
            Some(false),
            crate::wire::AppInstallState::UpdateAvailable,
        ),
        (
            "24215.1007.3146.1670",
            "24215.1007.3146.2020",
            Some("different-release-uuid"),
            Some(true),
            crate::wire::AppInstallState::Available,
        ),
        (
            "1.2.0.0",
            " 1.2 ",
            Some("different-release-uuid"),
            Some(true),
            crate::wire::AppInstallState::Available,
        ),
    ];
    for (released, installed, installed_uuid, update, expected) in cases {
        let mut app = app("Teams", crate::wire::AppInstallState::Available);
        app.released_version_id = "same-release-uuid".into();
        app.released_version_label = Some(released.into());
        apply_inventory(
            &mut app,
            Some(&inventory(installed_uuid, Some(installed), update)),
        );
        assert_eq!(app.install_state, expected, "{released} versus {installed}");
    }

    let mut uuid_fallback = app("app", crate::wire::AppInstallState::Available);
    uuid_fallback.released_version_label = Some("current build".into());
    apply_inventory(
        &mut uuid_fallback,
        Some(&inventory(
            Some("different-release-uuid"),
            Some("installed build"),
            Some(false),
        )),
    );
    assert_eq!(
        uuid_fallback.install_state,
        crate::wire::AppInstallState::UpdateAvailable
    );

    let mut update_flag_fallback = app("app", crate::wire::AppInstallState::Available);
    update_flag_fallback.released_version_label = Some("current build".into());
    apply_inventory(
        &mut update_flag_fallback,
        Some(&inventory(
            Some("version"),
            Some("installed build"),
            Some(true),
        )),
    );
    assert_eq!(
        update_flag_fallback.install_state,
        crate::wire::AppInstallState::UpdateAvailable
    );
}

#[test]
fn bootstrap_summary_counts_cached_authorized_catalog_views() {
    let mut apps = vec![
        app("available", crate::wire::AppInstallState::Available),
        app("update", crate::wire::AppInstallState::UpdateAvailable),
        app("active", crate::wire::AppInstallState::ActionActive),
    ];
    apps[1].released_version_label = Some("24215.1007.3146.2020".into());

    let (available_count, update_keys) = bootstrap_catalog_summary(&apps);

    assert_eq!(available_count, 1);
    assert_eq!(update_keys, ["update:version:24215.1007.3146.2020"]);
}

#[test]
fn catalog_views_return_distinct_install_state_datasets() {
    let catalog = vec![
        app("available", crate::wire::AppInstallState::Available),
        app("update", crate::wire::AppInstallState::UpdateAvailable),
        app("active", crate::wire::AppInstallState::ActionActive),
    ];
    let available = filter_catalog_view(catalog.clone(), crate::wire::CatalogView::Apps);
    let updates = filter_catalog_view(catalog, crate::wire::CatalogView::Updates);

    assert_eq!(
        available.iter().map(|app| &app.id).collect::<Vec<_>>(),
        ["available"]
    );
    assert_eq!(
        updates.iter().map(|app| &app.id).collect::<Vec<_>>(),
        ["update"]
    );
}

#[test]
fn concurrent_cold_catalog_reads_share_one_refresh() {
    let (base, requests, server) = mock_server(vec![
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"uuid":"app","name":"App","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"version","versionName":"1"}},"icon":null,"internalName":null}]}"#.into(),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"groups":[]}"#.into(),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[]}"#.into(),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#.into(),
        },
    ]);
    let client = Arc::new(test_client(base));
    let device = Arc::new(CurrentDevice {
        id: "device".into(),
        wire: NativeDevice {
            name: "Device".into(),
            status: "COMPLIANT".into(),
            last_seen_at: None,
        },
    });

    let first_client = Arc::clone(&client);
    let first_device = Arc::clone(&device);
    let second_client = Arc::clone(&client);
    let second_device = Arc::clone(&device);
    let (first, second) = run(async move {
        let first = tokio::spawn(async move {
            first_client
                .cached_apps("token", "user", first_device.as_ref(), 7)
                .await
        });
        let second = tokio::spawn(async move {
            second_client
                .cached_apps("token", "user", second_device.as_ref(), 7)
                .await
        });
        (first.await.unwrap(), second.await.unwrap())
    });
    assert_eq!(first.unwrap().len(), 1);
    assert_eq!(second.unwrap().len(), 1);
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 4);
}

#[test]
fn concurrent_cold_device_reads_share_one_lookup_per_credential_generation() {
    let client = Arc::new(test_client(Url::parse("http://127.0.0.1/").unwrap()));
    let lookups = Arc::new(AtomicUsize::new(0));
    let first_client = Arc::clone(&client);
    let first_lookups = Arc::clone(&lookups);
    let second_client = Arc::clone(&client);
    let second_lookups = Arc::clone(&lookups);
    let (first, second) = run(async move {
        let first = tokio::spawn(async move {
            first_client
                .cached_current_device(7, || async move {
                    first_lookups.fetch_add(1, Ordering::SeqCst);
                    Ok(test_device())
                })
                .await
        });
        let second = tokio::spawn(async move {
            second_client
                .cached_current_device(7, || async move {
                    second_lookups.fetch_add(1, Ordering::SeqCst);
                    Ok(test_device())
                })
                .await
        });
        (first.await.unwrap(), second.await.unwrap())
    });

    assert_eq!(first.unwrap().id, "device");
    assert_eq!(second.unwrap().id, "device");
    assert_eq!(lookups.load(Ordering::SeqCst), 1);
    assert_eq!(
        run(client.cached_current_device(8, || async {
            lookups.fetch_add(1, Ordering::SeqCst);
            Ok(test_device())
        }))
        .unwrap()
        .id,
        "device"
    );
    assert_eq!(lookups.load(Ordering::SeqCst), 2);
}

#[test]
fn mocked_transport_accepts_server_extensions_but_rejects_missing_required_fields() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"uuid":"u","name":"n","organizationUuid":"o","activated":true,"email":"n@example.test"}],"errors":[],"status":"OK","message":"users"}"#.into(),
    }, MockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"uuid":"u","name":"n","organizationUuid":"o"}]}"#.into(),
    }]);
    let client = test_client(base);
    let result: Result<dto::Page<dto::User>, String> =
        run(client.get("/api/users", "token", vec![]));
    assert_eq!(result.unwrap().results[0].uuid, "u");
    let invalid: Result<dto::Page<dto::User>, String> =
        run(client.get("/api/users", "token", vec![]));
    assert!(matches!(invalid, Err(error) if error == "server: invalid Relution response"));
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 2);
}

#[test]
fn mocked_reads_paginate_and_retry_transient_statuses() {
    let full_page = (0..PAGE_SIZE)
        .map(|index| format!(r#"{{"uuid":"group-{index}"}}"#))
        .collect::<Vec<_>>()
        .join(",");
    let (base, requests, server) = mock_server(vec![
        MockResponse {
            status: 503,
            content_type: "application/json",
            body: "{}".into(),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: format!(
                r#"{{"items":[{full_page}],"nonpagedCount":101,"version":4,"errors":[],"status":"OK","message":"groups"}}"#
            ),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"uuid":"last"}]}"#.into(),
        },
    ]);
    let client = test_client(base);
    let groups: Vec<dto::Group> = run(client.get_pages("/api/groups", "token", vec![])).unwrap();
    assert_eq!(groups.len(), PAGE_SIZE + 1);
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 3);
}

#[test]
fn mocked_mutation_is_never_retried() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 503,
        content_type: "application/json",
        body: "{}".into(),
    }]);
    let client = test_client(base);
    let result: Result<dto::Page<dto::Deployment>, String> =
        run(client.post_once("/api/deployment", "token", json!({})));
    assert!(result.is_err());
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[test]
fn mocked_recursive_group_permission_is_honored() {
    let (base, requests, server) = mock_server(vec![
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}}]}"#
                .into(),
        },
        MockResponse {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"uuid":"user"}]}"#.into(),
        },
    ]);
    let client = test_client(base);
    let context = CatalogContext {
        token: "token",
        user: "user",
        groups: &[],
        inventory: &[],
        group_memberships: AsyncMutex::new(HashMap::new()),
    };
    assert!(run(client.allowed("app", &context)).unwrap());
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 2);
}

#[test]
fn direct_user_permission_skips_recursive_group_membership_reads() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}},{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#
            .into(),
    }]);
    let client = test_client(base);
    let context = CatalogContext {
        token: "token",
        user: "user",
        groups: &[],
        inventory: &[],
        group_memberships: AsyncMutex::new(HashMap::new()),
    };

    assert!(run(client.allowed("app", &context)).unwrap());
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[test]
fn direct_group_permission_skips_recursive_group_membership_reads() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}},{"read":true,"userGroupInfo":{"uuid":"direct-group","type":"GROUP"}}]}"#
            .into(),
    }]);
    let client = test_client(base);
    let groups = ["direct-group".into()];
    let context = CatalogContext {
        token: "token",
        user: "user",
        groups: &groups,
        inventory: &[],
        group_memberships: AsyncMutex::new(HashMap::new()),
    };

    assert!(run(client.allowed("app", &context)).unwrap());
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 1);
}

#[test]
fn catalog_authorization_uses_at_most_four_concurrent_app_checks() {
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let permissions = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(MAX_CONCURRENT_CATALOG_AUTHORIZATIONS));
    let (base, requests, server) = mock_catalog_server(8, {
        let active = Arc::clone(&active);
        let peak = Arc::clone(&peak);
        let permissions = Arc::clone(&permissions);
        let barrier = Arc::clone(&barrier);
        move |request| {
            let path = request_path(request);
            if let Some(response) =
                catalog_setup_response(path, &["one", "two", "three", "four", "five"])
            {
                return response;
            }
            assert!(path.contains("/permissions/RELEASE"));
            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(current, Ordering::SeqCst);
            if permissions.fetch_add(1, Ordering::SeqCst) < MAX_CONCURRENT_CATALOG_AUTHORIZATIONS {
                barrier.wait();
            }
            active.fetch_sub(1, Ordering::SeqCst);
            direct_user_permission()
        }
    });
    let client = test_client(base);
    let apps = run(client.list_apps_for("token", "user", &test_device())).unwrap();
    server.join().unwrap();

    assert_eq!(apps.len(), 5);
    assert_eq!(
        peak.load(Ordering::SeqCst),
        MAX_CONCURRENT_CATALOG_AUTHORIZATIONS
    );
    assert_eq!(requests.load(Ordering::SeqCst), 8);
}

#[test]
fn repeated_recursive_group_permissions_fetch_members_once_per_refresh() {
    let group_requests = Arc::new(AtomicUsize::new(0));
    let (base, requests, server) = mock_catalog_server(9, {
        let group_requests = Arc::clone(&group_requests);
        move |request| {
            let path = request_path(request);
            if let Some(response) =
                catalog_setup_response(path, &["one", "two", "three", "four", "five"])
            {
                return response;
            }
            if path.ends_with("/members") {
                group_requests.fetch_add(1, Ordering::SeqCst);
                return CatalogMockResponse {
                    status: 200,
                    content_type: "application/json",
                    body: r#"{"results":[{"uuid":"user"}]}"#.into(),
                };
            }
            assert!(path.contains("/permissions/RELEASE"));
            CatalogMockResponse {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}}]}"#
                    .into(),
            }
        }
    });
    let client = test_client(base);
    let apps = run(client.list_apps_for("token", "user", &test_device())).unwrap();
    server.join().unwrap();

    assert_eq!(apps.len(), 5);
    assert_eq!(group_requests.load(Ordering::SeqCst), 1);
    assert_eq!(requests.load(Ordering::SeqCst), 9);
}

#[test]
fn catalog_authorization_keeps_sorted_output_stable() {
    let (base, requests, server) = mock_catalog_server(6, move |request| {
        let path = request_path(request);
        if path.ends_with("/content/apps/baseInfo") {
            assert!(request.contains("locale="));
            assert!(!request.contains("extend=versions"));
        }
        catalog_setup_response(path, &["Zulu", "alpha", "Mike"])
            .unwrap_or_else(direct_user_permission)
    });
    let client = test_client(base);
    let apps = run(client.list_apps_for("token", "user", &test_device())).unwrap();
    server.join().unwrap();

    assert_eq!(
        apps.iter().map(|app| app.name.as_str()).collect::<Vec<_>>(),
        ["alpha", "Mike", "Zulu"]
    );
    assert_eq!(requests.load(Ordering::SeqCst), 6);
}

#[test]
fn catalog_refresh_accepts_permission_extensions() {
    let (base, requests, server) = mock_catalog_server(8, move |request| {
        let path = request_path(request);
        if let Some(response) =
            catalog_setup_response(path, &["bad", "two", "three", "four", "five"])
        {
            return response;
        }
        assert!(path.contains("/permissions/RELEASE"));
        if path.contains("/bad/") {
            return CatalogMockResponse {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"},"unexpected":true}],"errors":[],"status":"OK"}"#
                    .into(),
            };
        }
        direct_user_permission()
    });
    let client = test_client(base);
    let result = run(client.cached_apps("token", "user", &test_device(), 42));
    server.join().unwrap();

    assert_eq!(result.unwrap().len(), 5);
    assert!(client.cache_for(42).unwrap().apps.is_some());
    assert_eq!(requests.load(Ordering::SeqCst), 8);
}

#[test]
fn mocked_icons_are_strictly_typed_and_generation_cache_is_isolated() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 200,
        content_type: "text/html",
        body: "not an image".into(),
    }]);
    let client = test_client(base);
    assert_eq!(
        run(client.fetch_icon("token", "app")).unwrap_err(),
        "server: unsupported icon type"
    );
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 1);

    {
        let mut cache = client.cache_for(7).unwrap();
        cache.icons.insert("app".into(), None);
        cache.apps = Some(vec![app(
            "available",
            crate::wire::AppInstallState::Available,
        )]);
    }
    assert!(client.cache_for(7).unwrap().icons.contains_key("app"));
    assert!(client.cache_for(7).unwrap().apps.is_some());
    let next_generation = client.cache_for(8).unwrap();
    assert!(!next_generation.icons.contains_key("app"));
    assert!(next_generation.apps.is_none());
    assert_eq!(client.icon_requests.available_permits(), 4);
}

#[test]
fn icons_reuse_hydrated_catalog_without_repeating_authorization_reads() {
    let catalog_reads = Arc::new(AtomicUsize::new(0));
    let permission_reads = Arc::new(AtomicUsize::new(0));
    let (base, requests, server) = mock_catalog_server(9, {
        let catalog_reads = Arc::clone(&catalog_reads);
        let permission_reads = Arc::clone(&permission_reads);
        move |request| {
            let path = request_path(request);
            if path.ends_with("/content/apps/baseInfo") {
                catalog_reads.fetch_add(1, Ordering::SeqCst);
            }
            if let Some(response) = catalog_setup_response(path, &["one", "two", "three"]) {
                return response;
            }
            if path.ends_with("/icon") {
                return CatalogMockResponse {
                    status: 200,
                    content_type: "image/png",
                    body: "icon".into(),
                };
            }
            assert!(path.contains("/permissions/RELEASE"));
            permission_reads.fetch_add(1, Ordering::SeqCst);
            direct_user_permission()
        }
    });
    let client = test_client(base);

    assert_eq!(
        run(client.cached_apps("token", "user", &test_device(), 7))
            .unwrap()
            .len(),
        3
    );
    for app_id in ["one", "two", "three"] {
        assert!(run(client.icon("token", "user", app_id, 7))
            .unwrap()
            .is_some());
    }

    server.join().unwrap();
    assert_eq!(catalog_reads.load(Ordering::SeqCst), 1);
    assert_eq!(permission_reads.load(Ordering::SeqCst), 3);
    assert_eq!(requests.load(Ordering::SeqCst), 9);
}

#[test]
fn icons_reject_app_ids_absent_from_the_hydrated_catalog() {
    let (base, requests, server) = mock_catalog_server(4, move |request| {
        catalog_setup_response(request_path(request), &["allowed"])
            .unwrap_or_else(direct_user_permission)
    });
    let client = test_client(base);

    assert_eq!(
        run(client.cached_apps("token", "user", &test_device(), 7))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        run(client.icon("token", "user", "forbidden", 7)).unwrap_err(),
        "server: application is not permitted"
    );

    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 4);
}

#[test]
fn mocked_action_history_requires_a_unique_new_correlation() {
    let action = crate::journal::Action {
        id: "local".into(),
        device_id: "device".into(),
        app_id: "app".into(),
        version_id: "version".into(),
        package_id: Some("package".into()),
        intent: "install".into(),
        baseline: "before".into(),
        correlation: None,
        state: crate::journal::State::Queued,
        error_code: None,
        error_message: None,
        created_at: 100,
        updated_at: 100,
    };
    let remote = |uuid: &str, app: &str| dto::DeviceAction {
        uuid: uuid.into(),
        state: "PENDING".into(),
        creation_date: 100,
        details: Some(dto::ActionDetails {
            app_uuid: Some(app.into()),
            version_uuid: None,
            package: None,
        }),
    };
    let baseline = std::collections::HashSet::from(["before"]);
    let candidates = correlation_candidates(
        vec![
            remote("before", "app"),
            remote("new", "app"),
            remote("other", "other"),
        ],
        &baseline,
        &action,
    );
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].uuid, "new");
    let ambiguous = correlation_candidates(
        vec![remote("one", "app"), remote("two", "app")],
        &baseline,
        &action,
    );
    assert_eq!(ambiguous.len(), 2);
}
