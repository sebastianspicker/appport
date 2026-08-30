//! Support-detail and privacy-bounded bundle workflows.

use crate::{
    application::catalog::CatalogService,
    infrastructure::{
        local, logging,
        windows::{platform, support, support_collectors},
    },
};
use std::sync::Arc;
use tokio::sync::Mutex;

pub(crate) enum SupportWorkflowError {
    Client(String),
    Support(support::SupportError),
}

pub(crate) struct SupportService {
    catalog: Arc<CatalogService>,
    confirmation_generation: Mutex<Option<u64>>,
}

impl SupportService {
    pub(crate) fn new(catalog: Arc<CatalogService>) -> Self {
        Self {
            catalog,
            confirmation_generation: Mutex::new(None),
        }
    }

    pub(crate) async fn details(
        &self,
        token: &str,
        username: &str,
        user_uuid: &str,
        generation: u64,
    ) -> Result<support::SupportDetails, String> {
        let (details, _) = self
            .collect_details(token, username, user_uuid, generation)
            .await?;
        *self.confirmation_generation.lock().await = Some(generation);
        Ok(details)
    }

    pub(crate) async fn generate_bundle(
        &self,
        confirmed_support_identifiers: bool,
        token: &str,
        username: &str,
        user_uuid: &str,
        generation: u64,
    ) -> Result<support::SupportBundleResult, SupportWorkflowError> {
        if !confirmed_support_identifiers {
            return Err(SupportWorkflowError::Support(
                support::SupportError::ConsentRequired,
            ));
        }
        let (details, collector_warnings) = self
            .collect_details(token, username, user_uuid, generation)
            .await
            .map_err(SupportWorkflowError::Client)?;
        if self.confirmation_generation.lock().await.take() != Some(generation) {
            return Err(SupportWorkflowError::Support(
                support::SupportError::ConsentRequired,
            ));
        }
        let catalog_summary = support::SupportCatalogSummary {
            assigned_eligible_count: details.assigned_eligible_count,
            available_count: details.available_count,
            update_count: details.update_count,
        };
        let (client_log, client_log_1) = logging::support_log_paths();
        let request = support::SupportBundleRequest {
            consent: true,
            created_at: local::epoch().to_string(),
            details,
            catalog_summary,
            network_summary: support_collectors::collect_network_summary(),
            collector_warnings,
            client_log,
            client_log_1,
        };
        tokio::task::spawn_blocking(move || support::generate_support_bundle(&request))
            .await
            .map_err(|_| SupportWorkflowError::Support(support::SupportError::AssemblyFailed))?
            .map_err(SupportWorkflowError::Support)
    }

    pub(crate) async fn clear_confirmation(&self) {
        *self.confirmation_generation.lock().await = None;
    }

    async fn collect_details(
        &self,
        token: &str,
        username: &str,
        user_uuid: &str,
        generation: u64,
    ) -> Result<(support::SupportDetails, Vec<String>), String> {
        let bootstrap = self
            .catalog
            .bootstrap(
                token,
                username,
                user_uuid,
                generation,
                &platform::current_locale(),
            )
            .await?;
        let platform = support_collectors::collect_platform_data();
        Ok((
            support::SupportDetails {
                app_version: env!("CARGO_PKG_VERSION").into(),
                source_revision: option_env!("APPPORT_SOURCE_REVISION")
                    .unwrap_or("unavailable")
                    .into(),
                username: username.into(),
                device_name: bootstrap.device.name,
                device_status: bootstrap.device.status,
                windows_display: platform.windows_display,
                manufacturer: platform.manufacturer,
                model: platform.model,
                smbios_serial: platform.smbios_serial,
                // The qualification tenant has not yet supplied a fixture that confirms
                // the last-connection and last-IP response field names. Do not infer
                // either value from local network interfaces.
                matched_relution_last_ip: None,
                matched_relution_last_connection_at: None,
                assigned_eligible_count: bootstrap.assigned_eligible_count,
                available_count: bootstrap.available_count,
                update_count: bootstrap.update_keys.len() as u32,
            },
            platform.warnings,
        ))
    }
}
