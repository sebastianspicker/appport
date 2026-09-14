use super::{
    catalog, catalog_body_response, client, concurrent_server, device, direct_user_permission, run,
    snapshot_catalog_response, AuthorizedCatalog, CatalogService, Response,
};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

fn observe(active: &AtomicUsize, maximum: &AtomicUsize) {
    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
    maximum.fetch_max(current, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(20));
    active.fetch_sub(1, Ordering::SeqCst);
}

fn entries(count: usize) -> (Vec<(String, String)>, String) {
    let entries = (0..count)
        .map(|index| (format!("app-{index}"), "1".to_owned()))
        .collect::<Vec<_>>();
    let borrowed = entries
        .iter()
        .map(|(id, version)| (id.as_str(), version.as_str()))
        .collect::<Vec<_>>();
    let body = catalog(&borrowed);
    (entries, body)
}

fn authorize(base: url::Url) -> AuthorizedCatalog {
    run(CatalogService::new(client(base)).authorized_catalog("token", "user", &device(), "en-US"))
        .expect("authorized catalog")
}

fn finish_catalog(
    result: &AuthorizedCatalog,
    expected_rows: usize,
    expected_requests: usize,
    requests: &AtomicUsize,
    handle: std::thread::JoinHandle<()>,
) {
    handle.join().expect("mock server");
    assert_eq!(result.rows.len(), expected_rows);
    assert_eq!(requests.load(Ordering::SeqCst), expected_requests);
}

#[test]
fn application_permissions_run_with_observed_maximum_concurrency_of_four() {
    let (_entries, body) = entries(9);
    let body = Arc::new(body);
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let response_body = Arc::clone(&body);
    let response_active = Arc::clone(&active);
    let response_maximum = Arc::clone(&maximum);
    let (base, requests, handle) = concurrent_server(12, move |request| {
        if let Some(response) = catalog_body_response(
            request,
            response_body.as_str(),
            r#"{"groups":[]}"#,
            r#"{"results":[]}"#,
        ) {
            return response;
        }
        assert!(request.contains("/permissions/RELEASE"));
        observe(&response_active, &response_maximum);
        direct_user_permission()
    });

    let result = authorize(base);

    finish_catalog(&result, 9, 12, &requests, handle);
    assert_eq!(maximum.load(Ordering::SeqCst), 4);
    assert_eq!(active.load(Ordering::SeqCst), 0);
}

#[test]
fn recursive_groups_are_requested_once_and_concurrently_for_shared_app_demand() {
    let (entries, body) = entries(8);
    let body = Arc::new(body);
    let group_calls = Arc::new([AtomicUsize::new(0), AtomicUsize::new(0)]);
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let response_body = Arc::clone(&body);
    let response_calls = Arc::clone(&group_calls);
    let response_active = Arc::clone(&active);
    let response_maximum = Arc::clone(&maximum);
    let (base, requests, handle) = concurrent_server(13, move |request| {
        if let Some(response) = catalog_body_response(
            request,
            response_body.as_str(),
            r#"{"groups":[]}"#,
            r#"{"results":[]}"#,
        ) {
            return response;
        }
        if request.contains("/security/groups/") {
            let index = usize::from(request.contains("nested-b"));
            response_calls[index].fetch_add(1, Ordering::SeqCst);
            observe(&response_active, &response_maximum);
            return Response::json(200, r#"{"results":[{"uuid":"user"}]}"#);
        }
        let app_index = entries
            .iter()
            .position(|(id, _)| request.contains(id))
            .expect("permission application");
        let group = if app_index % 2 == 0 {
            "nested-a"
        } else {
            "nested-b"
        };
        Response::json(
            200,
            format!(
                r#"{{"results":[{{"read":true,"userGroupInfo":{{"uuid":"{group}","type":"GROUP"}}}}]}}"#
            ),
        )
    });

    let result = authorize(base);

    finish_catalog(&result, 8, 13, &requests, handle);
    assert_eq!(group_calls[0].load(Ordering::SeqCst), 1);
    assert_eq!(group_calls[1].load(Ordering::SeqCst), 1);
    assert_eq!(maximum.load(Ordering::SeqCst), 2);
}

#[test]
fn direct_authorization_skips_an_unavailable_recursive_group() {
    let body = catalog(&[("direct", "1")]);
    let group_calls = Arc::new(AtomicUsize::new(0));
    let response_calls = Arc::clone(&group_calls);
    let (base, requests, handle) = concurrent_server(4, move |request| {
        if let Some(response) =
            catalog_body_response(request, &body, r#"{"groups":[]}"#, r#"{"results":[]}"#)
        {
            return response;
        }
        if request.contains("/security/groups/") {
            response_calls.fetch_add(1, Ordering::SeqCst);
            return Response::json(503, r#"{"message":"unavailable"}"#);
        }
        Response::json(
            200,
            r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}},{"read":true,"userGroupInfo":{"uuid":"unavailable","type":"GROUP"}}]}"#,
        )
    });

    let result = authorize(base);

    finish_catalog(&result, 1, 4, &requests, handle);
    assert_eq!(group_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn action_target_does_not_request_an_unrelated_application_permission() {
    let body = catalog(&[("target", "1"), ("unrelated", "1")]);
    let (base, requests, handle) = concurrent_server(5, move |request| {
        if let Some(response) = snapshot_catalog_response(request, &body) {
            return response;
        }
        assert!(request.contains("/content/apps/target/permissions/RELEASE"));
        direct_user_permission()
    });
    let service = super::snapshot_service(base);

    let (matched_device, app) =
        run(service.action_target("token", "user", "target", "en-US")).expect("target");

    handle.join().expect("mock server");
    assert_eq!(matched_device.id, "device");
    assert_eq!(app.id, "target");
    assert_eq!(requests.load(Ordering::SeqCst), 5);
}
