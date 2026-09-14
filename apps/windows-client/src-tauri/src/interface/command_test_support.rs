//! Shared native session fixtures and deterministic admission observation.

use super::AppState;
use crate::{application::catalog::CatalogService, infrastructure::relution::RelutionClient};
use std::{sync::Arc, time::Duration};

pub(super) async fn signed_in_state(
    client: Arc<RelutionClient>,
    catalog: Arc<CatalogService>,
) -> Arc<AppState> {
    let state = Arc::new(AppState::new(client, catalog, "apps".into()));
    let mut session = state.session.lock().await;
    let operation = session.begin_sign_in();
    session
        .finish_sign_in(operation, "synthetic".into(), "User".into(), "user".into())
        .unwrap();
    drop(session);
    state
}

pub(super) async fn cancel_after_admission<T>(
    state: &AppState,
    waiter: tokio::task::JoinHandle<T>,
) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while !state.session_gate.has_admitted_write() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    waiter.abort();
    assert!(waiter.await.err().expect("cancelled waiter").is_cancelled());
}

/// Sign-out must remain pending while an admitted durable write is paused.
pub(super) async fn blocked_sign_out(
    state: &Arc<AppState>,
) -> tokio::task::JoinHandle<crate::interface::wire::SignOutOutcome> {
    let state = Arc::clone(state);
    let mut task = tokio::spawn(async move { state.sign_out_current().await });
    assert!(tokio::time::timeout(Duration::from_millis(20), &mut task)
        .await
        .is_err());
    task
}
