//! Synthetic HTTP evidence for deployment admission and sign-out races.

use super::{
    test_support::{blocked_sign_out, cancel_after_admission, signed_in_state},
    AppState,
};
use crate::{
    application::{
        action_test_support::{catalog_response, DIRECT_PERMISSION, EMPTY_INVENTORY},
        catalog::CatalogService,
        test_support::{client, run, server, Response},
    },
    domain::{action::State, device::DeviceEvidence},
    infrastructure::{journal::ActionJournal, local::uuid_key},
};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;

struct JournalFixture {
    path: PathBuf,
    journal: ActionJournal,
}

impl JournalFixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("appport-deployment-{}", uuid_key()));
        std::fs::create_dir(&path).unwrap();
        Self {
            journal: ActionJournal::at_path(path.join("actions.sqlite3")),
            path,
        }
    }
}

impl Drop for JournalFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

async fn state(base: url::Url, journal: ActionJournal) -> Arc<AppState> {
    let client = client(base, true);
    let catalog = Arc::new(
        CatalogService::with_test_device_evidence(
            Arc::clone(&client),
            DeviceEvidence {
                version: 1,
                ent_dmid: Some("device-evidence".into()),
                smbios_uuid: None,
                bios_serial: None,
                hostname: "Device".into(),
            },
        )
        .using_journal(journal),
    );
    let state = signed_in_state(client, catalog).await;
    state
}

fn pause() -> (Pause, oneshot::Receiver<()>, mpsc::Sender<()>) {
    let (entered, started) = oneshot::channel();
    let (release, pending) = mpsc::channel();
    (
        Pause {
            entered: Mutex::new(Some(entered)),
            pending: Mutex::new(pending),
        },
        started,
        release,
    )
}

struct Pause {
    entered: Mutex<Option<oneshot::Sender<()>>>,
    pending: Mutex<mpsc::Receiver<()>>,
}

impl Pause {
    fn wait(&self) {
        self.entered
            .lock()
            .unwrap()
            .take()
            .unwrap()
            .send(())
            .unwrap();
        self.pending
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
    }
}

#[test]
fn sign_out_during_preflight_finishes_without_a_reservation_or_post() {
    let fixture = JournalFixture::new();
    let (preflight, started, release) = pause();
    let (base, requests, server) = server(6, move |request| {
        if let Some(response) = catalog_response(request, DIRECT_PERMISSION) {
            return response;
        }
        assert!(request.contains("/devices/device/actions"));
        preflight.wait();
        Response::json(200, EMPTY_INVENTORY)
    });
    run(async {
        let state = state(base, fixture.journal.clone()).await;
        let read_state = Arc::clone(&state);
        let read = tokio::spawn(async move { read_state.request_deployment("app".into()).await });
        started.await.unwrap();
        let outcome = tokio::time::timeout(Duration::from_secs(1), state.sign_out_current())
            .await
            .unwrap();
        assert!(outcome.credential_removed);
        release.send(()).unwrap();
        assert_eq!(read.await.unwrap().err().unwrap().code, "SESSION_EXPIRED");
        assert!(fixture
            .journal
            .active_actions("device")
            .await
            .unwrap()
            .is_empty());
    });
    server.join().unwrap();
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 6);
}

#[test]
fn dropping_an_admitted_waiter_preserves_one_post_and_durable_outcome() {
    let fixture = JournalFixture::new();
    let (preflight, preflight_started, release_preflight) = pause();
    let (submission, post_started, release_post) = pause();
    let observer = fixture.journal.clone();
    let (base, requests, server) = server(7, move |request| {
        if let Some(response) = catalog_response(request, DIRECT_PERMISSION) {
            return response;
        }
        if request.contains("/devices/device/actions") {
            preflight.wait();
            return Response::json(200, EMPTY_INVENTORY);
        }
        assert!(request
            .starts_with("POST /api/management/v1/content/apps/app/versions/version/deployments"));
        let saved = run(observer.active_actions("device")).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].state, State::Reserved);
        submission.wait();
        Response::json(200, r#"{"results":[{"successful":true}]}"#)
    });
    run(async {
        let state = state(base, fixture.journal.clone()).await;
        let request_state = Arc::clone(&state);
        let waiter =
            tokio::spawn(async move { request_state.request_deployment("app".into()).await });
        preflight_started.await.unwrap();
        let session = state.session.lock().await;
        release_preflight.send(()).unwrap();
        cancel_after_admission(&state, waiter).await;
        drop(session);
        tokio::time::timeout(Duration::from_secs(1), post_started)
            .await
            .unwrap()
            .unwrap();
        let sign_out = blocked_sign_out(&state).await;
        release_post.send(()).unwrap();
        assert!(sign_out.await.unwrap().credential_removed);
        let active = fixture.journal.active_actions("device").await.unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].state, State::Queued);
        assert_eq!(
            fixture
                .journal
                .action(&active[0].id)
                .await
                .unwrap()
                .unwrap()
                .app_id,
            "app"
        );
    });
    server.join().unwrap();
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 7);
}

#[test]
fn sign_out_during_authentication_prevents_late_registration() {
    let fixture = JournalFixture::new();
    let (authentication, started, release) = pause();
    let (base, _, server) = server(1, move |request| {
        assert!(request.contains("/security/users/baseInfo/query"));
        authentication.wait();
        Response::json(
            200,
            r#"{"results":[{"uuid":"user","name":"User","organizationUuid":"tenant","activated":true}]}"#,
        )
    });
    run(async {
        let state = state(base, fixture.journal.clone()).await;
        let auth_state = Arc::clone(&state);
        let authentication = tokio::spawn(async move {
            auth_state
                .connect_token("User".into(), "synthetic".into(), || {
                    panic!("superseded authentication cannot register a scheduled task")
                })
                .await
        });
        started.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), state.sign_out_current())
                .await
                .unwrap()
                .credential_removed
        );
        release.send(()).unwrap();
        assert_eq!(
            authentication.await.unwrap().err().unwrap().code,
            "SESSION_EXPIRED"
        );
        assert!(state.session.lock().await.credential().is_none());
    });
    server.join().unwrap();
}

#[test]
fn successful_sign_in_registration_precedes_sign_out_cleanup() {
    let fixture = JournalFixture::new();
    let (base, _, server) = server(1, |_| {
        Response::json(
            200,
            r#"{"results":[{"uuid":"user","name":"User","organizationUuid":"tenant","activated":true}]}"#,
        )
    });
    run(async {
        let state = state(base, fixture.journal.clone()).await;
        let order = Arc::new(Mutex::new(Vec::new()));
        let registered = Arc::clone(&order);
        assert!(
            state
                .connect_token("User".into(), "synthetic".into(), move || {
                    registered.lock().unwrap().push("register");
                    true
                })
                .await
                .ok()
                .unwrap()
                .background_check_registered
        );
        state
            .sign_out_with_cleanup(|| {
                order.lock().unwrap().push("remove");
                (true, true)
            })
            .await;
        assert_eq!(*order.lock().unwrap(), ["register", "remove"]);
    });
    server.join().unwrap();
}

#[test]
fn sign_out_during_support_reads_does_not_publish_stale_consent() {
    let fixture = JournalFixture::new();
    let (collection, started, release) = pause();
    let (base, _, server) = server(5, move |request| {
        if request.contains("/permissions/RELEASE") {
            collection.wait();
        }
        catalog_response(request, DIRECT_PERMISSION).expect("support catalog read")
    });
    run(async {
        let state = state(base, fixture.journal.clone()).await;
        let details_state = Arc::clone(&state);
        let details = tokio::spawn(async move { details_state.read_support_details().await });
        started.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(1), state.sign_out_current())
                .await
                .unwrap()
                .credential_removed
        );
        release.send(()).unwrap();
        assert!(details.await.unwrap().is_err());
        let mut session = state.session.lock().await;
        let current = session.generation();
        assert!(!session.consume_support_confirmation(current));
    });
    server.join().unwrap();
}
