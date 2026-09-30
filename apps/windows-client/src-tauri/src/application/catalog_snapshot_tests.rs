use super::{
    assigned_device_response, catalog, catalog_body_response, concurrent_server,
    direct_user_permission, join2, run, snapshot_catalog_response, snapshot_service, Response,
};
use crate::{error::ErrorKind, infrastructure::journal::ActionJournal};
use std::{
    fs,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn journal_fixture(label: &str) -> (ActionJournal, std::path::PathBuf) {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "appport-catalog-{label}-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).expect("journal directory");
    (
        ActionJournal::at_path(directory.join("actions.sqlite3")),
        directory,
    )
}

#[test]
fn loaded_snapshot_keeps_device_inventory_rows_and_counts_consistent() {
    let device_reads = Arc::new(AtomicUsize::new(0));
    let response_reads = Arc::clone(&device_reads);
    let body = catalog(&[("current", "1"), ("available", "1")]);
    let (base, requests, handle) = concurrent_server(12, move |request| {
        if request.contains("/devices/baseInfo/query") {
            let suffix = if response_reads.fetch_add(1, Ordering::SeqCst) == 0 {
                "a"
            } else {
                "b"
            };
            return assigned_device_response(
                &format!("device-{suffix}"),
                &format!("Device {suffix}"),
            );
        }
        let inventory = if request.contains("/device-a/installedApps/baseInfo/query") {
            r#"{"results":[{"identifier":"current.package","name":"current","appUuid":"current","versionUuid":"current-1","versionToShow":"1","versionName":null,"hasUpdateAvailable":false}]}"#
        } else {
            r#"{"results":[]}"#
        };
        if let Some(response) = catalog_body_response(request, &body, r#"{"groups":[]}"#, inventory)
        {
            return response;
        }
        direct_user_permission()
    });
    let (journal, directory) = journal_fixture("snapshot");
    let service = snapshot_service(base).using_journal(journal);

    let first = run(service.load_catalog("token", "User", "user", 7, "en-US", true))
        .expect("first catalog");
    let second = run(service.load_catalog("token", "User", "user", 7, "en-US", true))
        .expect("second catalog");

    handle.join().expect("mock server");
    assert_eq!(first.bootstrap.device.id, "device-a");
    assert_eq!(first.bootstrap.assigned_eligible_count, 2);
    assert_eq!(first.bootstrap.available_count, 1);
    assert_eq!(first.rows.len(), 1);
    assert_eq!(first.rows[0].id, "available");
    assert_eq!(second.bootstrap.device.id, "device-b");
    assert_eq!(second.bootstrap.assigned_eligible_count, 2);
    assert_eq!(second.bootstrap.available_count, 2);
    assert_eq!(second.rows.len(), 2);
    assert_eq!(requests.load(Ordering::SeqCst), 12);
    drop(service);
    fs::remove_dir_all(directory).expect("remove journal fixture");
}

#[test]
fn forced_refresh_failure_is_coalesced_and_removes_the_expired_snapshot() {
    let catalog_reads = Arc::new(AtomicUsize::new(0));
    let response_reads = Arc::clone(&catalog_reads);
    let body = catalog(&[("allowed", "1")]);
    let (base, requests, handle) = concurrent_server(8, move |request| {
        if request.contains("/devices/baseInfo/query") {
            return assigned_device_response("device", "Device");
        }
        if request.contains("/content/apps/baseInfo") {
            if response_reads.fetch_add(1, Ordering::SeqCst) == 0 {
                return Response::json(200, body.clone());
            }
            return Response::json(503, r#"{"message":"catalog unavailable"}"#);
        }
        if let Some(response) =
            catalog_body_response(request, &body, r#"{"groups":[]}"#, r#"{"results":[]}"#)
        {
            return response;
        }
        direct_user_permission()
    });
    let service = snapshot_service(base).with_cache_ttl(Duration::ZERO);
    run(service.authorized_snapshot("token", "user", 7, "en-US", false)).expect("initial catalog");

    let (first, second) = run(join2(
        service.authorized_snapshot("token", "user", 7, "en-US", true),
        service.authorized_snapshot("token", "user", 7, "en-US", true),
    ));

    handle.join().expect("mock server");
    assert!(matches!((&first, &second), (Err(a), Err(b)) if a == b));
    assert!(service
        .cache
        .catalog(7, "en-US", Duration::from_secs(60))
        .expect("catalog cache")
        .is_none());
    assert_eq!(catalog_reads.load(Ordering::SeqCst), 2);
    assert_eq!(requests.load(Ordering::SeqCst), 8);
}

#[test]
fn generation_invalidation_during_refresh_rejects_the_completion() {
    let body = catalog(&[("allowed", "1")]);
    let (base, requests, handle) = concurrent_server(5, move |request| {
        if let Some(response) = snapshot_catalog_response(request, &body) {
            return response;
        }
        std::thread::sleep(Duration::from_millis(40));
        direct_user_permission()
    });
    let service = snapshot_service(base);

    let (refresh, invalidation) = run(join2(
        service.authorized_snapshot("token", "user", 7, "en-US", false),
        async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            service.invalidate_session(8)
        },
    ));

    handle.join().expect("mock server");
    invalidation.expect("session invalidation");
    assert!(matches!(refresh, Err(error) if error.kind() == ErrorKind::SessionExpired));
    assert_eq!(requests.load(Ordering::SeqCst), 5);
}
