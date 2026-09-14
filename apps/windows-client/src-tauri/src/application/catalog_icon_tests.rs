use super::{
    allowed_catalog_response, client, concurrent_server, device, join2, run, CatalogService,
    Response,
};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

fn seed(service: &CatalogService) {
    run(service.cached_authorized_catalog("token", "user", &device(), 7, "en-US"))
        .expect("authorized catalog");
}

fn icon_response(status: u16, body: &str) -> Response {
    Response {
        status,
        content_type: "image/png",
        body: body.into(),
    }
}

#[test]
fn concurrent_icon_requests_are_coalesced() {
    let icon_calls = Arc::new(AtomicUsize::new(0));
    let response_calls = Arc::clone(&icon_calls);
    let (base, requests, handle) = concurrent_server(5, move |request| {
        if let Some(response) = allowed_catalog_response(request) {
            return response;
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        response_calls.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(30));
        icon_response(200, "png")
    });
    let service = CatalogService::new(client(base));
    seed(&service);

    let (first, second) = run(join2(
        service.icon("token", "user", "allowed", 7, "en-US"),
        service.icon("token", "user", "allowed", 7, "en-US"),
    ));

    handle.join().expect("mock server");
    assert_eq!(first.expect("first icon"), second.expect("second icon"));
    assert_eq!(icon_calls.load(Ordering::SeqCst), 1);
    assert_eq!(requests.load(Ordering::SeqCst), 5);
}

#[test]
fn stale_icon_completion_is_rejected_after_application_invalidation() {
    let (base, requests, handle) = concurrent_server(5, move |request| {
        if let Some(response) = allowed_catalog_response(request) {
            return response;
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        std::thread::sleep(Duration::from_millis(40));
        icon_response(200, "png")
    });
    let service = CatalogService::new(client(base));
    seed(&service);

    let (icon, invalidation) = run(join2(
        service.icon("token", "user", "allowed", 7, "en-US"),
        async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            service.invalidate_apps(7).await
        },
    ));

    handle.join().expect("mock server");
    invalidation.expect("application invalidation");
    assert!(matches!(
        icon,
        Err(error) if error == "session-expired: icon authorization was invalidated"
    ));
    assert_eq!(requests.load(Ordering::SeqCst), 5);
}

#[test]
fn transient_icon_errors_are_not_cached() {
    let icon_calls = Arc::new(AtomicUsize::new(0));
    let response_calls = Arc::clone(&icon_calls);
    let (base, requests, handle) = concurrent_server(6, move |request| {
        if let Some(response) = allowed_catalog_response(request) {
            return response;
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        if response_calls.fetch_add(1, Ordering::SeqCst) == 0 {
            icon_response(503, "unavailable")
        } else {
            icon_response(200, "png")
        }
    });
    let service = CatalogService::new(client(base));
    seed(&service);

    assert!(run(service.icon("token", "user", "allowed", 7, "en-US")).is_err());
    assert!(run(service.icon("token", "user", "allowed", 7, "en-US"))
        .expect("retried icon")
        .is_some());

    handle.join().expect("mock server");
    assert_eq!(icon_calls.load(Ordering::SeqCst), 2);
    assert_eq!(requests.load(Ordering::SeqCst), 6);
}

#[test]
fn missing_icons_are_cached_by_the_native_service() {
    let icon_calls = Arc::new(AtomicUsize::new(0));
    let response_calls = Arc::clone(&icon_calls);
    let (base, requests, handle) = concurrent_server(5, move |request| {
        if let Some(response) = allowed_catalog_response(request) {
            return response;
        }
        assert!(request.contains("/content/apps/allowed/icon"));
        response_calls.fetch_add(1, Ordering::SeqCst);
        icon_response(404, "")
    });
    let service = CatalogService::new(client(base));
    seed(&service);

    assert!(run(service.icon("token", "user", "allowed", 7, "en-US"))
        .expect("missing icon")
        .is_none());
    assert!(run(service.icon("token", "user", "allowed", 7, "en-US"))
        .expect("cached missing icon")
        .is_none());

    handle.join().expect("mock server");
    assert_eq!(icon_calls.load(Ordering::SeqCst), 1);
    assert_eq!(requests.load(Ordering::SeqCst), 5);
}
