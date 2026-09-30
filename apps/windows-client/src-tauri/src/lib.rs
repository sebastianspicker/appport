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
mod error;
mod infrastructure;
mod interface;
pub mod qualification;
mod self_check;

#[cfg(windows)]
use crate::infrastructure::journal;
use crate::infrastructure::logging;
#[cfg(windows)]
use crate::{
    application::{background, catalog::CatalogService, desktop::DesktopService},
    domain::catalog::CatalogView,
    infrastructure::{
        relution,
        windows::{platform, task},
    },
    interface::{commands, runtime},
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
    let journal = journal::ActionJournal::new();
    let Ok(config) =
        relution::RelutionConfig::embedded().inspect_err(|error| logging::write(error))
    else {
        return;
    };
    if run_background_mode(&arguments, config.clone(), journal.clone()) {
        return;
    }
    let Some(client) = foreground_client(config) else {
        return;
    };
    if let Err(error) = journal.recover_interrupted_reservations() {
        logging::write(error);
    }
    launch_tauri(client, arguments, journal);
}

#[cfg(windows)]
fn run_background_mode(
    arguments: &[String],
    config: relution::RelutionConfig,
    journal: journal::ActionJournal,
) -> bool {
    if !matches!(
        runtime::launch_mode(arguments),
        runtime::LaunchMode::BackgroundCheck
    ) {
        return false;
    }
    let Ok(client) = relution::RelutionClient::new(config).map(Arc::new) else {
        return true;
    };
    let catalog = Arc::new(CatalogService::with_journal(client, journal));
    if let Err(error) = background::run_background_check(catalog) {
        logging::write(error);
    }
    true
}

#[cfg(windows)]
fn foreground_client(config: relution::RelutionConfig) -> Option<Arc<relution::RelutionClient>> {
    if let Err(error) = platform::acquire_singleton() {
        logging::write(error);
        return None;
    }
    relution::RelutionClient::new(config)
        .map(Arc::new)
        .inspect_err(|error| logging::write(error))
        .ok()
}

#[cfg(windows)]
fn launch_tauri(
    client: Arc<relution::RelutionClient>,
    arguments: Vec<String>,
    journal: journal::ActionJournal,
) {
    if let Ok(executable) = std::env::current_exe() {
        if let Err(error) = task::register_protocol(&executable) {
            logging::write(error);
        }
    }
    let catalog = Arc::new(CatalogService::with_journal(Arc::clone(&client), journal));
    let state = Arc::new(DesktopService::new(
        client,
        catalog,
        if runtime::opens_updates(&arguments) {
            CatalogView::Updates
        } else {
            CatalogView::Apps
        },
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(commands::invoke_handler())
        .run(tauri::generate_context!())
        .expect("Tauri runtime failed");
}

#[cfg(not(windows))]
pub fn run() {
    logging::write("Windows-only client launched on an unsupported platform");
}
