//! Session races exercised through the same admission and archive workflow as IPC.

use super::{
    test_support::{blocked_sign_out, cancel_after_admission, signed_in_state},
    AppState,
};
use crate::{
    application::{
        catalog::CatalogService,
        test_support::{client, run},
    },
    infrastructure::{
        local::uuid_key,
        windows::{support, support_collectors},
    },
};
use std::{sync::Arc, time::Duration};
use tokio::sync::oneshot;

async fn state() -> Arc<AppState> {
    let client = client(url::Url::parse("http://127.0.0.1:9/").unwrap(), false);
    let catalog = Arc::new(CatalogService::new(Arc::clone(&client)));
    let state = signed_in_state(client, catalog).await;
    {
        let mut session = state.session.lock().await;
        let generation = session.generation();
        session.confirm_support("user", generation).unwrap();
    }
    state
}

fn request() -> support::SupportBundleRequest {
    support::SupportBundleRequest {
        consent: true,
        created_at: "2026-09-06T00:00:00Z".into(),
        details: serde_json::from_str(r#"{"appVersion":"test","sourceRevision":"test","username":"User","deviceName":"Device","deviceStatus":"COMPLIANT","windowsDisplay":"test","manufacturer":null,"model":null,"smbiosSerial":null,"matchedRelutionLastIp":null,"matchedRelutionLastConnectionAt":null,"assignedEligibleCount":0,"availableCount":0,"updateCount":0}"#).unwrap(),
        catalog_summary: support::SupportCatalogSummary { assigned_eligible_count: 0, available_count: 0, update_count: 0 },
        network_summary: support_collectors::bounded_network_summary([]),
        collector_warnings: vec![],
        client_log: None,
        client_log_1: None,
    }
}

#[test]
fn archive_admission_survives_waiter_cancellation_before_session_recheck() {
    run(async {
        let state = state().await;
        let session = state.session.lock().await;
        let generation = session.generation();
        let (entered, started) = oneshot::channel();
        let (release, pending) = std::sync::mpsc::channel();
        let path = std::env::temp_dir().join(format!("appport-admission-{}", uuid_key()));
        let output = path.clone();
        let writer_state = Arc::clone(&state);
        let waiter = tokio::spawn(async move {
            writer_state
                .write_confirmed_bundle("user", generation, request(), move |_| {
                    entered.send(()).unwrap();
                    pending.recv_timeout(Duration::from_secs(5)).unwrap();
                    std::fs::write(output, b"synthetic archive").unwrap();
                    Ok(support::SupportBundleResult {
                        bundle_file_name: "test.zip".into(),
                        bytes: 17,
                        warnings: vec![],
                    })
                })
                .await
        });
        cancel_after_admission(&state, waiter).await;
        drop(session);
        tokio::time::timeout(Duration::from_secs(1), started)
            .await
            .unwrap()
            .unwrap();
        let sign_out = blocked_sign_out(&state).await;
        release.send(()).unwrap();
        assert!(sign_out.await.unwrap().credential_removed);
        assert_eq!(std::fs::read(&path).unwrap(), b"synthetic archive");
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
fn stale_bundle_collection_cannot_consume_new_session_confirmation() {
    run(async {
        let state = state().await;
        let old_generation = state.session.lock().await.generation();
        state.sign_out_current().await;
        let current_generation = {
            let mut session = state.session.lock().await;
            let operation = session.begin_sign_in();
            session
                .finish_sign_in(
                    operation,
                    "replacement".into(),
                    "User".into(),
                    "user".into(),
                )
                .unwrap();
            let current = session.generation();
            session.confirm_support("user", current).unwrap();
            current
        };
        let result = state
            .write_confirmed_bundle("user", old_generation, request(), |_| {
                panic!("stale collection must never reach the archive writer")
            })
            .await;
        assert_eq!(result.err().unwrap().code, "SESSION_EXPIRED");
        assert!(state
            .session
            .lock()
            .await
            .consume_support_confirmation(current_generation));
    });
}
