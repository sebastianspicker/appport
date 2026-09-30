//! Support records shared by the support workflow, bundle archive, and native wire.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportDetails {
    pub app_version: String,
    pub source_revision: String,
    pub username: String,
    pub device_name: String,
    pub device_status: String,
    pub windows_display: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub smbios_serial: Option<String>,
    pub matched_relution_last_ip: Option<String>,
    pub matched_relution_last_connection_at: Option<String>,
    pub assigned_eligible_count: u32,
    pub available_count: u32,
    pub update_count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportBundleResult {
    pub bundle_file_name: String,
    pub bytes: u64,
    pub warnings: Vec<String>,
}
