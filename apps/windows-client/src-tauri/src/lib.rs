#![cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "non-Windows source verification cannot reach Windows-only Tauri commands and modules; Windows CI runs real-target Clippy"
    )
)]

#[allow(
    dead_code,
    reason = "build.rs consumes the full module; the library uses only shared qualification types and validators"
)]
mod build_config;

mod application;
mod domain;
mod infrastructure;
mod interface;
pub mod qualification;
mod self_check;

#[cfg(windows)]
use crate::infrastructure::journal;
use crate::infrastructure::logging;
#[cfg(windows)]
use crate::{
    application::{
        actions::ActionService, background, catalog::CatalogService, support::SupportService,
    },
    infrastructure::{
        relution,
        windows::{platform, task},
    },
    interface::{
        commands::{self, AppState},
        runtime,
    },
};
#[cfg(windows)]
use std::sync::Arc;

/// Starts the process after selecting the self-check, background, or foreground mode.
#[cfg(windows)]
pub fn run() {
    let arguments: Vec<String> = std::env::args().collect();
    if matches!(
        runtime::launch_mode(&arguments),
        runtime::LaunchMode::QualificationSelfCheck
    ) {
        let report = self_check::run();
        println!(
            "{}",
            serde_json::to_string(&report)
                .unwrap_or_else(|_| "{\"schemaVersion\":1,\"qualified\":false}".into())
        );
        std::process::exit(if report.qualified { 0 } else { 1 });
    }
    if let Err(error) = journal::recover_interrupted_reservations() {
        logging::write(&error);
    }
    let Ok(config) =
        relution::RelutionConfig::embedded().inspect_err(|error| logging::write(error))
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
fn run_background_mode(arguments: &[String], config: relution::RelutionConfig) -> bool {
    if !matches!(
        runtime::launch_mode(arguments),
        runtime::LaunchMode::BackgroundCheck
    ) {
        return false;
    }
    let Ok(client) = relution::RelutionClient::new(config).map(Arc::new) else {
        return true;
    };
    let catalog = Arc::new(CatalogService::new(client));
    if let Err(error) = background::run_background_check(catalog) {
        logging::write(&error);
    }
    true
}

#[cfg(windows)]
fn foreground_client(config: relution::RelutionConfig) -> Option<Arc<relution::RelutionClient>> {
    if let Err(error) = runtime::acquire_singleton() {
        logging::write(&error);
        return None;
    }
    relution::RelutionClient::new(config)
        .map(Arc::new)
        .inspect_err(|error| logging::write(error))
        .ok()
}

#[cfg(windows)]
fn launch_tauri(client: Arc<relution::RelutionClient>, arguments: Vec<String>) {
    if let Ok(executable) = std::env::current_exe() {
        if let Err(error) = task::register_protocol(&executable) {
            logging::write(&error);
        }
    }
    let catalog = Arc::new(CatalogService::new(Arc::clone(&client)));
    let actions = Arc::new(ActionService::new(
        Arc::clone(&client),
        Arc::clone(&catalog),
    ));
    let support = Arc::new(SupportService::new(Arc::clone(&catalog)));
    let state = Arc::new(AppState::new(
        client,
        catalog,
        actions,
        support,
        if runtime::opens_updates(&arguments) {
            "updates".into()
        } else {
            "apps".into()
        },
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::bootstrap,
            commands::list_apps,
            commands::request_action,
            commands::get_action,
            commands::load_app_icon,
            commands::support_details,
            commands::generate_support_bundle,
            commands::open_support_folder,
            commands::sign_out,
            commands::initial_view,
            commands::open_relution_portal
        ])
        .run(tauri::generate_context!())
        .expect("Tauri runtime failed");
}

#[cfg(not(windows))]
pub fn run() {
    logging::write("Windows-only client launched on an unsupported platform");
}
