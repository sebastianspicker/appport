#![cfg_attr(not(windows), allow(dead_code))]

mod callbacks;
mod client;
mod evidence;
mod logging;
mod platform;
mod runtime;
mod session;

use std::sync::Arc;
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
    client: client::BrokerClient,
    session: Mutex<session::SessionStore>,
    initial_view: String,
}

#[tauri::command]
async fn begin_connect(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<client::ConnectStarted, NativeError> {
    let result = state
        .client
        .begin_connect(&mut *state.session.lock().await)
        .await
        .map_err(native_error)?;
    if let Ok(executable) = std::env::current_exe() {
        runtime::register_background_check(&executable).map_err(native_error)?;
    }
    Ok(result)
}

#[tauri::command]
async fn bootstrap(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<client::NativeBootstrap, NativeError> {
    state
        .client
        .bootstrap(&*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn list_apps(
    view: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<client::AvailableApp>, NativeError> {
    state
        .client
        .apps(&view, &*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn list_installed(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<client::InstalledApplication>, NativeError> {
    state
        .client
        .installed(&*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn request_action(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<client::AppAction, NativeError> {
    state
        .client
        .action(&app_id, &*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn get_action(
    action_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<client::AppAction, NativeError> {
    state
        .client
        .get_action(&action_id, &*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn load_app_icon(
    app_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, NativeError> {
    state
        .client
        .icon(&app_id, &*state.session.lock().await)
        .await
        .map_err(native_error)
}

#[tauri::command]
async fn sign_out(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<client::SignOutOutcome, NativeError> {
    let task_result = runtime::remove_background_check();
    Ok(state
        .client
        .sign_out_with_task(&mut *state.session.lock().await, task_result)
        .await)
}

#[tauri::command]
fn initial_view(state: tauri::State<'_, Arc<AppState>>) -> String {
    state.initial_view.clone()
}

fn broker_endpoint() -> Result<String, String> {
    if cfg!(debug_assertions) {
        if let Ok(value) = std::env::var("RELUTION_BROKER_URL") {
            return Ok(value);
        }
    }
    option_env!("APPPORT_BROKER_URL")
        .map(str::to_owned)
        .ok_or_else(|| {
            "configuration: APPPORT_BROKER_URL was not embedded in this build".to_owned()
        })
}

fn run_background_check(endpoint: &str) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "unknown: background runtime unavailable")?;
    let client = client::BrokerClient::new(endpoint)?;
    let session = session::SessionStore::load();
    let update_count = runtime
        .block_on(async { client.bootstrap(&session).await })?
        .update_count;
    runtime::notify_updates(update_count)
}

#[cfg(windows)]
pub fn run() {
    let arguments: Vec<String> = std::env::args().collect();
    let Ok(endpoint) = broker_endpoint().inspect_err(|error| logging::write(error)) else {
        return;
    };
    if run_background_mode(&arguments, &endpoint) {
        return;
    }
    let Some(client) = foreground_client(&endpoint) else {
        return;
    };
    launch_tauri(client, arguments);
}

#[cfg(windows)]
fn run_background_mode(arguments: &[String], endpoint: &str) -> bool {
    if !matches!(
        runtime::launch_mode(arguments),
        runtime::LaunchMode::BackgroundCheck
    ) {
        return false;
    }
    if let Err(error) = run_background_check(endpoint) {
        logging::write(&error);
    }
    true
}

#[cfg(windows)]
fn foreground_client(endpoint: &str) -> Option<client::BrokerClient> {
    if let Err(error) = runtime::acquire_singleton() {
        logging::write(&error);
        return None;
    }
    register_protocol();
    client::BrokerClient::new(endpoint)
        .inspect_err(|error| logging::write(error))
        .ok()
}

#[cfg(windows)]
fn register_protocol() {
    if let Ok(executable) = std::env::current_exe() {
        if let Err(error) = runtime::register_protocol(&executable) {
            logging::write(&error);
        }
    }
}

#[cfg(windows)]
fn launch_tauri(client: client::BrokerClient, arguments: Vec<String>) {
    let state = Arc::new(AppState {
        client,
        session: Mutex::new(session::SessionStore::load()),
        initial_view: if runtime::opens_updates(&arguments) {
            "updates".into()
        } else {
            "apps".into()
        },
    });
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            begin_connect,
            bootstrap,
            list_apps,
            list_installed,
            request_action,
            get_action,
            load_app_icon,
            sign_out,
            initial_view
        ])
        .run(tauri::generate_context!())
        .expect("Tauri runtime failed");
}

#[cfg(not(windows))]
pub fn run() {
    let _ = broker_endpoint();
    logging::write("Windows-only client launched on an unsupported platform");
}
