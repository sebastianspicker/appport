//! Tauri command decoding, serialization, and native error mapping.

use crate::{
    application::{
        catalog::LoadedCatalog,
        desktop::{self, DesktopService},
    },
    domain::catalog::CatalogView,
    error::{Error, ErrorKind},
    interface::wire,
};
use std::sync::Arc;
use tauri::Manager;

/// Lists each native command once; expands to `COMMAND_NAMES` and `invoke_handler()`.
macro_rules! native_commands {
    ($($command:ident),+ $(,)?) => {
        pub(crate) const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),+];

        /// Registers the commands of `COMMAND_NAMES`, in the same order, with the Tauri runtime.
        pub(crate) fn invoke_handler(
        ) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$($command),+]
        }
    };
}

native_commands![
    connect,
    load_catalog,
    request_action,
    get_action,
    load_app_icon,
    support_details,
    generate_support_bundle,
    open_support_folder,
    sign_out,
    initial_view,
    open_relution_portal,
];

#[derive(serde::Serialize)]
pub(crate) struct NativeError {
    code: &'static str,
    message: String,
}

fn native_error(error: Error) -> NativeError {
    let code = match error.kind() {
        ErrorKind::Offline => "OFFLINE",
        ErrorKind::SessionExpired => "SESSION_EXPIRED",
        ErrorKind::Authorization => "AUTHORIZATION_DENIED",
        ErrorKind::DeviceMatchFailed => "DEVICE_MATCH_FAILED",
        ErrorKind::Server => "SERVER",
        ErrorKind::Support => "SUPPORT",
        ErrorKind::Configuration | ErrorKind::Unknown => "UNKNOWN",
    };
    NativeError {
        code,
        message: error.to_string(),
    }
}

impl From<wire::CatalogView> for CatalogView {
    fn from(value: wire::CatalogView) -> Self {
        match value {
            wire::CatalogView::Apps => Self::Apps,
            wire::CatalogView::Updates => Self::Updates,
        }
    }
}

impl From<CatalogView> for wire::CatalogView {
    fn from(value: CatalogView) -> Self {
        match value {
            CatalogView::Apps => Self::Apps,
            CatalogView::Updates => Self::Updates,
        }
    }
}

impl From<LoadedCatalog> for wire::CatalogSnapshot {
    fn from(value: LoadedCatalog) -> Self {
        Self {
            bootstrap: value.bootstrap.into(),
            apps: value.rows.into_iter().map(Into::into).collect(),
            catalog_revision: value.revision,
        }
    }
}

impl From<desktop::ConnectStarted> for wire::ConnectStarted {
    fn from(value: desktop::ConnectStarted) -> Self {
        Self {
            background_check_registered: value.background_check_registered,
        }
    }
}

impl From<desktop::SignOutOutcome> for wire::SignOutOutcome {
    fn from(value: desktop::SignOutOutcome) -> Self {
        Self {
            token_revocation_required: value.token_revocation_required,
            credential_removed: value.credential_removed,
            scheduled_task_removed: value.scheduled_task_removed,
            notification_state_cleared: value.notification_state_cleared,
        }
    }
}

#[tauri::command]
pub(crate) async fn connect(
    request: wire::ConnectRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::ConnectStarted, NativeError> {
    match request {
        wire::ConnectRequest::PersonalToken {
            relution_username,
            access_token,
        } => connect_personal_token(relution_username, access_token, app, state).await,
    }
}

async fn connect_personal_token(
    relution_username: String,
    access_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::ConnectStarted, NativeError> {
    let executable = tauri::process::current_binary(&app.env()).ok();
    state
        .inner()
        .connect_token(relution_username, access_token, executable)
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn load_catalog(
    request: wire::LoadCatalogRequest,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::CatalogSnapshot, NativeError> {
    state
        .load_catalog(request.view.into(), request.force_refresh)
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn request_action(
    app_id: String,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::AppAction, NativeError> {
    state
        .inner()
        .request_deployment(app_id)
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn get_action(
    action_id: String,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::AppAction, NativeError> {
    state
        .get_action(action_id)
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn load_app_icon(
    app_id: String,
    catalog_revision: Option<String>,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<Option<String>, NativeError> {
    state
        .load_app_icon(app_id, catalog_revision)
        .await
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn support_details(
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::SupportDetails, NativeError> {
    state
        .read_support_details()
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn generate_support_bundle(
    confirmed_support_identifiers: bool,
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::SupportBundleResult, NativeError> {
    state
        .inner()
        .write_support_bundle(confirmed_support_identifiers)
        .await
        .map(Into::into)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn open_support_folder(
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<(), NativeError> {
    state.open_support_folder().await.map_err(native_error)
}

#[tauri::command]
pub(crate) async fn sign_out(
    state: tauri::State<'_, Arc<DesktopService>>,
) -> Result<wire::SignOutOutcome, NativeError> {
    Ok(state.sign_out_current().await.into())
}

#[tauri::command]
pub(crate) fn initial_view(state: tauri::State<'_, Arc<DesktopService>>) -> wire::CatalogView {
    state.initial_view().into()
}

#[tauri::command]
pub(crate) fn open_relution_portal() -> Result<(), NativeError> {
    desktop::open_relution_portal().map_err(native_error)
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "wire_fixture_tests.rs"]
mod wire_fixture_tests;
