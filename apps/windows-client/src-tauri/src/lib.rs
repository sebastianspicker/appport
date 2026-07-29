#![cfg_attr(not(windows), allow(dead_code))]

mod client;
mod client_support;
mod dto;
mod evidence;
mod journal;
mod logging;
mod notifications;
mod platform;
mod runtime;
mod session;
mod task;
mod wire;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(serde::Serialize)]
struct NativeError {
    code: &'static str,
    message: String,
}

fn native_error(message: String) -> NativeError {
    let code = if message.starts_with("offline:") {
        "OFFLINE"
    } else if message.starts_with("session-expired:") {
        "SESSION_EXPIRED"
    } else if message.starts_with("device_match_failed:") {
        "DEVICE_MATCH_FAILED"
    } else if message.starts_with("server:") {
        "SERVER"
    } else {
        "UNKNOWN"
    };
    NativeError { code, message }
}

pub struct AppState {
    client: client::RelutionClient,
    session: Mutex<session::SessionCoordinator>,
    initial_view: String,
}

#[tauri::command]
async fn connect(
    relution_username: String,
    access_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::ConnectStarted, NativeError> {
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
    match completion {
        Ok(()) => {}
        Err(session::SignInCompletionError::StaleCredential(_token)) => {
            return Err(native_error(
                "session-expired: sign-in was superseded".into(),
            ));
        }
        Err(session::SignInCompletionError::Credential(error)) => return Err(native_error(error)),
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
async fn bootstrap(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::NativeBootstrap, NativeError> {
    let credential = {
        let session = state.session.lock().await;
        session.credential_with_generation()
    };
    let (token, username, user_uuid, generation) =
        credential.ok_or_else(|| native_error("session-expired: no stored session".into()))?;
    state
        .client
        .bootstrap(&token, &username, &user_uuid, generation)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn list_apps(
    _view: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<wire::AvailableApp>, NativeError> {
    let credential = {
        let session = state.session.lock().await;
        session.credential_with_generation()
    };
    let (token, _, user_uuid, generation) =
        credential.ok_or_else(|| native_error("session-expired: no stored session".into()))?;
    state
        .client
        .list_apps(&token, &user_uuid, generation)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn request_action(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    let credential = {
        let session = state.session.lock().await;
        session.credential()
    };
    let (token, _, user_uuid) =
        credential.ok_or_else(|| native_error("session-expired: no stored session".into()))?;
    state
        .client
        .request_action(&token, &user_uuid, &app_id)
        .await
        .map_err(native_error)
        .and_then(|action| {
            journal::record(&action.id, &action.app_id, "queued").map_err(native_error)?;
            Ok(action)
        })
}

#[tauri::command]
async fn get_action(
    action_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::AppAction, NativeError> {
    let credential = {
        let session = state.session.lock().await;
        session.credential()
    };
    let (token, _, user_uuid) =
        credential.ok_or_else(|| native_error("session-expired: no stored session".into()))?;
    state
        .client
        .get_action(&token, &user_uuid, &action_id)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn load_app_icon(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, NativeError> {
    let credential = {
        let session = state.session.lock().await;
        session.credential_with_generation()
    };
    let (token, _, user_uuid, generation) =
        credential.ok_or_else(|| native_error("session-expired: no stored session".into()))?;
    state
        .client
        .icon(&token, &user_uuid, &app_id, generation)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn sign_out(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wire::SignOutOutcome, NativeError> {
    let invalidated = {
        let mut session = state.session.lock().await;
        session.sign_out()
    };
    let task_result = task::remove_background_check();
    let notification_state_cleared = notifications::clear_state().is_ok();
    let token_revocation_required = invalidated.access_token.is_some();
    Ok(wire::SignOutOutcome {
        token_revocation_required,
        credential_removed: invalidated.credential_removed,
        scheduled_task_removed: task_result.is_ok(),
        notification_state_cleared,
    })
}

#[tauri::command]
fn initial_view(state: tauri::State<'_, Arc<AppState>>) -> String {
    state.initial_view.clone()
}

#[tauri::command]
fn open_relution_portal() -> Result<(), NativeError> {
    platform::open_relution_portal().map_err(native_error)
}

fn run_background_check(client: client::RelutionClient) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "unknown: background runtime unavailable")?;
    let session = session::SessionCoordinator::load();
    let credential = session
        .credential_with_generation()
        .ok_or("session-expired: no stored session")?;
    let updates = runtime
        .block_on(async {
            client
                .bootstrap(&credential.0, &credential.1, &credential.2, credential.3)
                .await
        })?
        .updates;
    notifications::notify_updates(&updates.keys)
}

#[cfg(windows)]
pub fn run() {
    let arguments: Vec<String> = std::env::args().collect();
    let Ok(config) = client::RelutionConfig::embedded().inspect_err(|error| logging::write(error))
    else {
        return;
    };
    if run_background_mode(&arguments, config.clone()) {
        return;
    }
    let Some(client) = foreground_client(config) else {
        return;
    };
    launch_tauri(client, arguments);
}

#[cfg(windows)]
fn run_background_mode(arguments: &[String], config: client::RelutionConfig) -> bool {
    if !matches!(
        runtime::launch_mode(arguments),
        runtime::LaunchMode::BackgroundCheck
    ) {
        return false;
    }
    let Ok(client) = client::RelutionClient::new(config) else {
        return true;
    };
    if let Err(error) = run_background_check(client) {
        logging::write(&error);
    }
    true
}

#[cfg(windows)]
fn foreground_client(config: client::RelutionConfig) -> Option<client::RelutionClient> {
    if let Err(error) = runtime::acquire_singleton() {
        logging::write(&error);
        return None;
    }
    client::RelutionClient::new(config)
        .inspect_err(|error| logging::write(error))
        .ok()
}

#[cfg(windows)]
fn launch_tauri(client: client::RelutionClient, arguments: Vec<String>) {
    let state = Arc::new(AppState {
        client,
        session: Mutex::new(session::SessionCoordinator::load()),
        initial_view: if runtime::opens_updates(&arguments) {
            "updates".into()
        } else {
            "apps".into()
        },
    });
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            connect,
            bootstrap,
            list_apps,
            request_action,
            get_action,
            load_app_icon,
            sign_out,
            initial_view,
            open_relution_portal
        ])
        .run(tauri::generate_context!())
        .expect("Tauri runtime failed");
}

#[cfg(not(windows))]
pub fn run() {
    logging::write("Windows-only client launched on an unsupported platform");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_registration_is_an_additive_partial_outcome() {
        let started = connect_started(false);
        assert!(!started.background_check_registered);
    }
}
