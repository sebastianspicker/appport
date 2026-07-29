use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
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
fn state_is_unknown_for_an_unmapped_relution_value() {
    assert_eq!(
        status(reqwest::StatusCode::FORBIDDEN),
        "device_match_failed: device not assigned"
    );
}

#[test]
fn relution_action_states_are_mapped_fail_closed() {
    assert_eq!(remote_state("EXECUTED"), "verifying");
    assert_eq!(remote_state("ERROR"), "failed");
    assert_eq!(remote_state("future-state"), "unknown");
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
fn mocked_transport_rejects_unknown_fields_at_the_http_boundary() {
    let (base, requests, server) = mock_server(vec![MockResponse {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"uuid":"u","name":"n","organizationUuid":"o","activated":true,"unexpected":1}]}"#.into(),
    }]);
    let client = test_client(base);
    let result: Result<dto::Page<dto::User>, String> =
        run(client.get("/api/users", "token", vec![]));
    assert!(matches!(
        result,
        Err(error) if error == "server: invalid Relution response"
    ));
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 1);
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
            body: format!(r#"{{"results":[{full_page}]}}"#),
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
    assert!(run(client.allowed("token", "user", &[], "app")).unwrap());
    server.join().unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 2);
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

    client
        .cache_for(7)
        .unwrap()
        .icons
        .insert("app".into(), None);
    assert!(client.cache_for(7).unwrap().icons.contains_key("app"));
    assert!(!client.cache_for(8).unwrap().icons.contains_key("app"));
    assert_eq!(client.icon_requests.available_permits(), 4);
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
        state: "queued".into(),
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
