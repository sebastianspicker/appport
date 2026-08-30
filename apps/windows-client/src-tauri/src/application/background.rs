//! Background catalog refresh and update notification workflow.

use crate::{
    application::{catalog::CatalogService, session::SessionCoordinator},
    infrastructure::windows::{notifications, platform},
};
use std::sync::Arc;

/// Loads the stored session, refreshes its catalog, and publishes only new updates.
pub(crate) fn run_background_check(catalog: Arc<CatalogService>) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "unknown: background runtime unavailable")?;
    let session = SessionCoordinator::load();
    let credential = session
        .credential_with_generation()
        .ok_or("session-expired: no stored session")?;
    let updates = runtime
        .block_on(async {
            catalog
                .bootstrap(
                    &credential.0,
                    &credential.1,
                    &credential.2,
                    credential.3,
                    &platform::current_locale(),
                )
                .await
        })?
        .update_keys;
    notifications::notify_updates(&updates)
}
