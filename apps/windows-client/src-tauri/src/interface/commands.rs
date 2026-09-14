//! Tauri command decoding, serialization, and session-generation fencing.

use crate::{
    application::{
        actions::ActionService,
        catalog::CatalogService,
        session::{self, SessionCoordinator},
        session_gate::SessionGate,
        support::{SupportService, SupportWorkflowError},
    },
    domain::catalog::CatalogView,
    infrastructure::{
        logging, relution,
        windows::{platform, support, task},
    },
    interface::wire,
};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub(crate) const COMMAND_NAMES: [&str; 13] = [
    "connect",
    "bootstrap",
    "list_apps",
    "load_catalog",
    "request_action",
    "get_action",
    "load_app_icon",
    "support_details",
    "generate_support_bundle",
    "open_support_folder",
    "sign_out",
    "initial_view",
    "open_relution_portal",
];

#[derive(serde::Serialize)]
pub(crate) struct NativeError {
    code: &'static str,
    message: String,
}

pub(crate) struct AppState {
    client: Arc<relution::RelutionClient>,
    catalog: Arc<CatalogService>,
    actions: Arc<ActionService>,
    support: Arc<SupportService>,
    session: Mutex<SessionCoordinator>,
    session_gate: SessionGate,
    action_workflow: Arc<Mutex<()>>,
    initial_view: String,
}

impl AppState {
    pub(crate) fn new(
        client: Arc<relution::RelutionClient>,
        catalog: Arc<CatalogService>,
        initial_view: String,
    ) -> Self {
        let actions = Arc::new(ActionService::new(
            Arc::clone(&client),
            Arc::clone(&catalog),
        ));
        let support = Arc::new(SupportService::new(Arc::clone(&catalog)));
        Self {
            client,
            catalog,
            actions,
            support,
            session: Mutex::new(SessionCoordinator::load()),
            session_gate: SessionGate::default(),
            action_workflow: Arc::new(Mutex::new(())),
            initial_view,
        }
    }
}

type GeneratedSessionCredential = (String, String, String, u64);

fn native_error(message: String) -> NativeError {
    let code = if message.starts_with("offline:") {
        "OFFLINE"
    } else if message.starts_with("session-expired:") {
        "SESSION_EXPIRED"
    } else if message.starts_with("authorization:") || message.starts_with("forbidden:") {
        "AUTHORIZATION_DENIED"
    } else if message.starts_with("device_match_failed:") {
        "DEVICE_MATCH_FAILED"
    } else if message.starts_with("server:") {
        "SERVER"
    } else if message.starts_with("support:") {
        "SUPPORT"
    } else {
        "UNKNOWN"
    };
    NativeError { code, message }
}

fn sign_in_completion_error(error: session::SignInCompletionError) -> NativeError {
    match error {
        session::SignInCompletionError::StaleCredential => {
            native_error("session-expired: sign-in was superseded".into())
        }
        session::SignInCompletionError::Credential(error) => native_error(error),
    }
}

fn support_error(error: support::SupportError) -> NativeError {
    logging::write(error.code());
    native_error(error.client_message().into())
}

fn support_workflow_error(error: SupportWorkflowError) -> NativeError {
    match error {
        SupportWorkflowError::Client(error) => native_error(error),
        SupportWorkflowError::Support(error) => support_error(error),
    }
}

async fn generated_session_credential(
    state: &AppState,
) -> Result<GeneratedSessionCredential, NativeError> {
    let session = state.session.lock().await;
    session
        .credential_with_generation()
        .ok_or_else(|| native_error("session-expired: no stored session".into()))
}

async fn ensure_session_generation(
    state: &AppState,
    user_uuid: &str,
    generation: u64,
) -> Result<(), NativeError> {
    state
        .session
        .lock()
        .await
        .ensure_current(user_uuid, generation)
        .map_err(native_error)
}

#[tauri::command]
pub(crate) async fn connect(
    request: wire::ConnectRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
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
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::ConnectStarted, NativeError> {
    let executable = tauri::process::current_binary(&app.env()).ok();
    state
        .inner()
        .connect_token(relution_username, access_token, move || {
            executable
                .and_then(|path| task::register_background_check(&path).ok())
                .is_some()
        })
        .await
}

fn connect_started(background_check_registered: bool) -> wire::ConnectStarted {
    wire::ConnectStarted {
        background_check_registered,
    }
}

#[tauri::command]
pub(crate) async fn bootstrap(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::NativeBootstrap, NativeError> {
    let (token, username, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .catalog
        .bootstrap(
            &token,
            &username,
            &user_uuid,
            generation,
            &platform::current_locale(),
        )
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn list_apps(
    view: wire::CatalogView,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<wire::AvailableApp>, NativeError> {
    let (token, _, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .catalog
        .list_apps(
            &token,
            &user_uuid,
            generation,
            match view {
                wire::CatalogView::Apps => CatalogView::Apps,
                wire::CatalogView::Updates => CatalogView::Updates,
            },
            &platform::current_locale(),
        )
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub(crate) async fn load_catalog(
    request: wire::LoadCatalogRequest,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::CatalogSnapshot, NativeError> {
    let (token, username, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .catalog
        .load_catalog(
            &token,
            &username,
            &user_uuid,
            generation,
            &platform::current_locale(),
            request.force_refresh,
        )
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    let view = match request.view {
        wire::CatalogView::Apps => CatalogView::Apps,
        wire::CatalogView::Updates => CatalogView::Updates,
    };
    Ok(wire::CatalogSnapshot {
        bootstrap: result.bootstrap.into(),
        apps: crate::domain::catalog::filter_catalog_view(result.rows, view)
            .into_iter()
            .map(Into::into)
            .collect(),
        catalog_revision: result.revision,
    })
}

#[tauri::command]
pub(crate) async fn request_action(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    state
        .inner()
        .request_deployment(app_id)
        .await
        .map(Into::into)
}

#[tauri::command]
pub(crate) async fn get_action(
    action_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    let _workflow = state.action_workflow.lock().await;
    let (token, _, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .actions
        .get_action(&token, &user_uuid, &action_id, generation)
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn load_app_icon(
    app_id: String,
    catalog_revision: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, NativeError> {
    let (token, _, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .catalog
        .icon_for_revision(
            &token,
            &user_uuid,
            &app_id,
            generation,
            &platform::current_locale(),
            catalog_revision.as_deref(),
        )
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn support_details(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SupportDetails, NativeError> {
    state.inner().read_support_details().await.map(Into::into)
}

#[tauri::command]
pub(crate) async fn generate_support_bundle(
    confirmed_support_identifiers: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SupportBundleResult, NativeError> {
    state
        .inner()
        .write_support_bundle(confirmed_support_identifiers)
        .await
        .map(Into::into)
}

#[tauri::command]
pub(crate) async fn open_support_folder(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), NativeError> {
    let _ = generated_session_credential(state.inner().as_ref()).await?;
    support::open_support_folder().map_err(support_error)
}

#[tauri::command]
pub(crate) async fn sign_out(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SignOutOutcome, NativeError> {
    Ok(state.inner().sign_out_current().await)
}

#[tauri::command]
pub(crate) fn initial_view(state: tauri::State<'_, Arc<AppState>>) -> String {
    state.initial_view.clone()
}

#[tauri::command]
pub(crate) fn open_relution_portal() -> Result<(), NativeError> {
    platform::open_relution_portal().map_err(native_error)
}

#[path = "command_session.rs"]
mod session_commands;

#[path = "command_workflows.rs"]
mod workflows;

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;

#[cfg(all(test, not(windows)))]
#[path = "coordination_tests.rs"]
mod coordination_tests;

#[cfg(all(test, not(windows)))]
#[path = "deployment_tests.rs"]
mod deployment_tests;

#[cfg(all(test, not(windows)))]
#[path = "command_test_support.rs"]
mod test_support;
