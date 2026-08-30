use super::{CatalogService, DeviceSummary, RelutionClient};
use crate::domain::catalog::AppInstallState;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};
use url::Url;

struct Response {
    status: u16,
    content_type: &'static str,
    body: String,
}

fn server(
    expected: usize,
    response: impl Fn(&str) -> Response + Send + 'static,
) -> (Url, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let address = listener.local_addr().expect("mock address");
    let requests = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&requests);
    let handle = thread::spawn(move || {
        for _ in 0..expected {
            let (mut stream, _) = listener.accept().expect("mock request");
            let mut request = [0_u8; 16 * 1024];
            let bytes = stream.read(&mut request).expect("read mock request");
            let response = response(std::str::from_utf8(&request[..bytes]).expect("HTTP text"));
            count.fetch_add(1, Ordering::SeqCst);
            write!(
                stream,
                "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.status,
                response.content_type,
                response.body.len(),
                response.body
            )
            .expect("write mock response");
        }
    });
    (
        Url::parse(&format!("http://{address}/")).expect("mock URL"),
        requests,
        handle,
    )
}

fn client(base: Url) -> Arc<RelutionClient> {
    Arc::new(
        RelutionClient::new(crate::infrastructure::relution::RelutionConfig {
            base,
            organization_uuid: "tenant".into(),
            native_app_uuid: "native".into(),
            writes_enabled: true,
        })
        .expect("client"),
    )
}

fn device() -> DeviceSummary {
    DeviceSummary {
        id: "device".into(),
        name: "Device".into(),
        status: "COMPLIANT".into(),
    }
}

fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
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
    Response {
        status: 200,
        content_type: "application/json",
        body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#.into(),
    }
}

#[test]
fn catalog_permissions_fail_closed_but_allow_direct_and_recursive_assignments() {
    let (base, requests, handle) = server(7, |request| {
        if request.contains("/content/apps/baseInfo") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: catalog(&[("direct", "1"), ("recursive", "1"), ("denied", "1")]),
            };
        }
        if request.contains("/security/users/user/groups") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"groups":[]}"#.into(),
            };
        }
        if request.contains("/installedApps/baseInfo/query") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[]}"#.into(),
            };
        }
        if request.contains("/permissions/RELEASE") && request.contains("direct") {
            return direct_user_permission();
        }
        if request.contains("/permissions/RELEASE") && request.contains("recursive") {
            return Response { status: 200, content_type: "application/json", body: r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"nested","type":"GROUP"}}]}"#.into() };
        }
        if request.contains("/security/groups/nested/members") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[{"uuid":"user"}]}"#.into(),
            };
        }
        Response {
            status: 200,
            content_type: "application/json",
            body: r#"{"results":[{"read":false,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#
                .into(),
        }
    });
    let service = CatalogService::new(client(base));

    let result =
        run(service.authorized_catalog("token", "user", &device(), "en-US")).expect("catalog");

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 7);
    assert_eq!(result.assigned_eligible_count, 2);
    assert_eq!(
        result
            .rows
            .iter()
            .map(|app| app.id.as_str())
            .collect::<Vec<_>>(),
        ["direct", "recursive"]
    );
}

#[test]
fn catalog_suppresses_current_installs_and_exposes_updates() {
    let (base, requests, handle) = server(5, |request| {
        if request.contains("/content/apps/baseInfo") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: catalog(&[("current", "1"), ("update", "2")]),
            };
        }
        if request.contains("/security/users/user/groups") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"groups":[]}"#.into(),
            };
        }
        if request.contains("/installedApps/baseInfo/query") {
            return Response { status: 200, content_type: "application/json", body: r#"{"results":[{"identifier":"current.package","name":"current","appUuid":"current","versionUuid":"current-1","versionToShow":"1","versionName":null,"hasUpdateAvailable":false},{"identifier":"update.package","name":"update","appUuid":"update","versionUuid":"update-1","versionToShow":"1","versionName":null,"hasUpdateAvailable":false}]}"#.into() };
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
        if request.contains("/content/apps/baseInfo") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: catalog(&[("allowed", "1")]),
            };
        }
        if request.contains("/security/users/user/groups") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"groups":[]}"#.into(),
            };
        }
        if request.contains("/installedApps/baseInfo/query") {
            return Response {
                status: 200,
                content_type: "application/json",
                body: r#"{"results":[]}"#.into(),
            };
        }
        if request.contains("/permissions/RELEASE") {
            return direct_user_permission();
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        Response {
            status: 200,
            content_type: "image/png",
            body: "png".into(),
        }
    });
    let service = CatalogService::new(client(base));
    let current = device();

    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &current, 7, "en-US"))
            .expect("initial catalog")
            .rows
            .len(),
        1
    );
    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &current, 7, "en-US"))
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
        Err(error) if error == "server: application is not permitted"
    ));
    assert_eq!(
        run(service.cached_authorized_catalog("token", "user", &current, 8, "en-US"))
            .expect("next generation catalog")
            .rows
            .len(),
        1
    );

    handle.join().expect("mock server");
    assert_eq!(requests.load(Ordering::SeqCst), 9);
}
