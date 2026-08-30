//! Tauri command decoding, serialization, and session-generation fencing.

use crate::{
    application::{
        actions::ActionService,
        catalog::CatalogService,
        session::{self, SessionCoordinator},
        support::{SupportService, SupportWorkflowError},
    },
    domain::catalog::CatalogView,
    infrastructure::{
        logging, relution,
        windows::{notifications, platform, support, task},
    },
    interface::wire,
};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub(crate) const COMMAND_NAMES: [&str; 12] = [
    "connect",
    "bootstrap",
    "list_apps",
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
    session_transition: Mutex<()>,
    initial_view: String,
}

impl AppState {
    pub(crate) fn new(
        client: Arc<relution::RelutionClient>,
        catalog: Arc<CatalogService>,
        actions: Arc<ActionService>,
        support: Arc<SupportService>,
        initial_view: String,
    ) -> Self {
        Self {
            client,
            catalog,
            actions,
            support,
            session: Mutex::new(SessionCoordinator::load()),
            session_transition: Mutex::new(()),
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
    let current = generated_session_credential(state).await?;
    if current.2 == user_uuid && current.3 == generation {
        Ok(())
    } else {
        Err(native_error(
            "session-expired: session changed while the request was running".into(),
        ))
    }
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
    let _transition = state.session_transition.lock().await;
    state.support.clear_confirmation().await;
    let operation = {
        let mut session = state.session.lock().await;
        session.begin_sign_in()
    };
    let identity = state
        .client
        .connect(&relution_username, &access_token)
        .await
        .map_err(native_error)?;
    let completion = {
        let mut session = state.session.lock().await;
        session.finish_sign_in(
            operation,
            access_token,
            identity.username,
            identity.user_uuid,
        )
    };
    if let Err(error) = completion {
        return Err(sign_in_completion_error(error));
    }
    let background_check_registered = tauri::process::current_binary(&app.env())
        .ok()
        .and_then(|executable| task::register_background_check(&executable).ok())
        .is_some();
    Ok(connect_started(background_check_registered))
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
pub(crate) async fn request_action(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    let _transition = state.session_transition.lock().await;
    let (token, _, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .actions
        .request_action(&token, &user_uuid, &app_id, &platform::current_locale())
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn get_action(
    action_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    let _transition = state.session_transition.lock().await;
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
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, NativeError> {
    let (token, _, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .catalog
        .icon(
            &token,
            &user_uuid,
            &app_id,
            generation,
            &platform::current_locale(),
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
    let _transition = state.session_transition.lock().await;
    let (token, username, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .support
        .details(&token, &username, &user_uuid, generation)
        .await
        .map_err(native_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn generate_support_bundle(
    confirmed_support_identifiers: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SupportBundleResult, NativeError> {
    let _transition = state.session_transition.lock().await;
    let (token, username, user_uuid, generation) =
        generated_session_credential(state.inner().as_ref()).await?;
    let result = state
        .support
        .generate_bundle(
            confirmed_support_identifiers,
            &token,
            &username,
            &user_uuid,
            generation,
        )
        .await
        .map_err(support_workflow_error)?;
    ensure_session_generation(state.inner().as_ref(), &user_uuid, generation).await?;
    Ok(result.into())
}

#[tauri::command]
pub(crate) async fn open_support_folder(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), NativeError> {
    let _transition = state.session_transition.lock().await;
    let _ = generated_session_credential(state.inner().as_ref()).await?;
    support::open_support_folder().map_err(support_error)
}

#[tauri::command]
pub(crate) async fn sign_out(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SignOutOutcome, NativeError> {
    let _transition = state.session_transition.lock().await;
    state.support.clear_confirmation().await;
    let invalidated = {
        let mut session = state.session.lock().await;
        session.sign_out()
    };
    let task_result = task::remove_background_check();
    let notification_state_cleared = notifications::clear_state().is_ok();
    Ok(wire::SignOutOutcome {
        token_revocation_required: invalidated.token_revocation_required,
        credential_removed: invalidated.credential_removed,
        scheduled_task_removed: task_result.is_ok(),
        notification_state_cleared,
    })
}

#[tauri::command]
pub(crate) fn initial_view(state: tauri::State<'_, Arc<AppState>>) -> String {
    state.initial_view.clone()
}

#[tauri::command]
pub(crate) fn open_relution_portal() -> Result<(), NativeError> {
    platform::open_relution_portal().map_err(native_error)
}

#[cfg(test)]
mod tests {
    use super::{connect_started, native_error, sign_in_completion_error, COMMAND_NAMES};
    use crate::application::session;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct NativeContract {
        commands: Vec<String>,
        #[serde(rename = "nativeErrorCodes")]
        native_error_codes: Vec<String>,
    }

    #[test]
    fn registered_commands_match_the_shared_manifest() {
        let manifest: NativeContract =
            serde_json::from_str(include_str!("../../../native-contract.json")).unwrap();
        assert_eq!(
            manifest.commands,
            COMMAND_NAMES
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            manifest.native_error_codes,
            [
                "OFFLINE",
                "SESSION_EXPIRED",
                "AUTHORIZATION_DENIED",
                "DEVICE_MATCH_FAILED",
                "SERVER",
                "SUPPORT",
                "UNKNOWN",
            ]
        );
    }

    #[test]
    fn task_registration_is_an_additive_partial_outcome() {
        let started = connect_started(false);
        assert!(!started.background_check_registered);
    }

    #[test]
    fn stale_sign_in_completion_preserves_the_public_session_expired_error() {
        let error = sign_in_completion_error(session::SignInCompletionError::StaleCredential);
        assert_eq!(error.code, "SESSION_EXPIRED");
        assert_eq!(error.message, "session-expired: sign-in was superseded");
    }

    #[test]
    fn authorization_error_has_a_distinct_public_code() {
        let error = native_error("authorization: account lacks required access".into());
        assert_eq!(error.code, "AUTHORIZATION_DENIED");
    }

    #[test]
    fn support_errors_have_a_distinct_public_code() {
        let error = native_error("support: unable to create support bundle".into());
        assert_eq!(error.code, "SUPPORT");
    }
}
