//! Native command and frontend serialization contract.

use serde::{Deserialize, Serialize};

use crate::{
    domain::{action, catalog},
    infrastructure::windows::support,
};

#[derive(Deserialize)]
#[serde(tag = "authMethod", rename_all = "snake_case", deny_unknown_fields)]
pub enum ConnectRequest {
    PersonalToken {
        #[serde(rename = "relutionUsername")]
        relution_username: String,
        #[serde(rename = "accessToken")]
        access_token: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppSource {
    Winget,
    WindowsMsi,
    WindowsExe,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppInstallState {
    Available,
    UpdateAvailable,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogView {
    Apps,
    Updates,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionIntent {
    Install,
    Update,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionState {
    Queued,
    Sent,
    Deferred,
    Verifying,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignOutOutcome {
    pub token_revocation_required: bool,
    pub credential_removed: bool,
    pub scheduled_task_removed: bool,
    pub notification_state_cleared: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectStarted {
    pub background_check_registered: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBootstrap {
    pub user: NativeUser,
    pub device: NativeDevice,
    pub assigned_eligible_count: u32,
    pub available_count: u32,
    pub updates: NativeUpdates,
    pub writes_enabled: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdates {
    pub count: u32,
    pub keys: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUser {
    pub display_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDevice {
    pub name: String,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableApp {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub source: AppSource,
    pub package_identifier: Option<String>,
    pub released_version_id: String,
    pub released_version_label: Option<String>,
    pub installed_version_id: Option<String>,
    pub installed_version_label: Option<String>,
    pub install_state: AppInstallState,
    pub active_action_id: Option<String>,
    pub active_action_state: Option<ActionState>,
    pub has_icon: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAction {
    pub id: String,
    pub device_id: String,
    pub app_id: String,
    pub intent: ActionIntent,
    pub state: ActionState,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportDetails {
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportBundleResult {
    pub bundle_file_name: String,
    pub bytes: u64,
    pub warnings: Vec<String>,
}

impl From<support::SupportDetails> for SupportDetails {
    fn from(value: support::SupportDetails) -> Self {
        Self {
            app_version: value.app_version,
            source_revision: value.source_revision,
            username: value.username,
            device_name: value.device_name,
            device_status: value.device_status,
            windows_display: value.windows_display,
            manufacturer: value.manufacturer,
            model: value.model,
            smbios_serial: value.smbios_serial,
            matched_relution_last_ip: value.matched_relution_last_ip,
            matched_relution_last_connection_at: value.matched_relution_last_connection_at,
            assigned_eligible_count: value.assigned_eligible_count,
            available_count: value.available_count,
            update_count: value.update_count,
        }
    }
}

impl From<support::SupportBundleResult> for SupportBundleResult {
    fn from(value: support::SupportBundleResult) -> Self {
        Self {
            bundle_file_name: value.bundle_file_name,
            bytes: value.bytes,
            warnings: value.warnings,
        }
    }
}

impl From<catalog::CatalogBootstrap> for NativeBootstrap {
    fn from(value: catalog::CatalogBootstrap) -> Self {
        Self {
            user: NativeUser {
                display_name: value.username,
            },
            device: NativeDevice {
                name: value.device.name,
                status: value.device.status,
                last_seen_at: None,
            },
            assigned_eligible_count: value.assigned_eligible_count,
            available_count: value.available_count,
            updates: NativeUpdates {
                count: value.update_keys.len() as u32,
                keys: value.update_keys,
            },
            writes_enabled: value.writes_enabled,
        }
    }
}

impl From<catalog::AvailableApp> for AvailableApp {
    fn from(value: catalog::AvailableApp) -> Self {
        Self {
            id: value.id,
            name: value.name,
            description: value.description,
            publisher: value.publisher,
            source: value.source.into(),
            package_identifier: value.package_identifier,
            released_version_id: value.released_version_id,
            released_version_label: value.released_version_label,
            installed_version_id: value.installed_version_id,
            installed_version_label: value.installed_version_label,
            install_state: value.install_state.into(),
            active_action_id: value.active_action_id,
            active_action_state: value.active_action_state.map(Into::into),
            has_icon: value.has_icon,
        }
    }
}

impl From<action::AppAction> for AppAction {
    fn from(value: action::AppAction) -> Self {
        Self {
            id: value.id,
            device_id: value.device_id,
            app_id: value.app_id,
            intent: value.intent.into(),
            state: value.state.into(),
            error_code: value.error_code,
            error_message: value.error_message,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<catalog::AppSource> for AppSource {
    fn from(value: catalog::AppSource) -> Self {
        match value {
            catalog::AppSource::Winget => Self::Winget,
            catalog::AppSource::WindowsMsi => Self::WindowsMsi,
            catalog::AppSource::WindowsExe => Self::WindowsExe,
        }
    }
}

impl From<catalog::AppInstallState> for AppInstallState {
    fn from(value: catalog::AppInstallState) -> Self {
        match value {
            catalog::AppInstallState::Available => Self::Available,
            catalog::AppInstallState::UpdateAvailable => Self::UpdateAvailable,
        }
    }
}

impl From<action::Intent> for ActionIntent {
    fn from(value: action::Intent) -> Self {
        match value {
            action::Intent::Install => Self::Install,
            action::Intent::Update => Self::Update,
        }
    }
}

impl From<action::ActionState> for ActionState {
    fn from(value: action::ActionState) -> Self {
        match value {
            action::ActionState::Queued => Self::Queued,
            action::ActionState::Sent => Self::Sent,
            action::ActionState::Deferred => Self::Deferred,
            action::ActionState::Verifying => Self::Verifying,
            action::ActionState::Succeeded => Self::Succeeded,
            action::ActionState::Failed => Self::Failed,
            action::ActionState::Cancelled => Self::Cancelled,
            action::ActionState::Unknown => Self::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActionIntent, ActionState, AppInstallState, AppSource, AvailableApp, CatalogView,
        ConnectRequest, NativeBootstrap, NativeDevice, NativeUpdates, NativeUser,
    };
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct NativeContract {
        #[serde(rename = "installStates")]
        install_states: Vec<String>,
    }

    #[test]
    fn enums_keep_the_snake_case_wire_contract() {
        assert_eq!(
            serde_json::to_string(&AppSource::WindowsMsi).unwrap(),
            "\"windows_msi\""
        );
        assert_eq!(
            serde_json::to_string(&AppInstallState::UpdateAvailable).unwrap(),
            "\"update_available\""
        );
        assert_eq!(
            serde_json::to_string(&CatalogView::Updates).unwrap(),
            "\"updates\""
        );
        assert_eq!(
            serde_json::to_string(&ActionIntent::Install).unwrap(),
            "\"install\""
        );
        assert_eq!(
            serde_json::to_string(&ActionState::Succeeded).unwrap(),
            "\"succeeded\""
        );
    }

    #[test]
    fn install_states_match_the_shared_native_contract() {
        let contract: NativeContract =
            serde_json::from_str(include_str!("../../../native-contract.json")).unwrap();
        assert_eq!(contract.install_states, ["available", "update_available"]);
    }

    #[test]
    fn enums_reject_unknown_wire_values() {
        assert!(serde_json::from_str::<AppSource>("\"msix\"").is_err());
        assert!(serde_json::from_str::<AppInstallState>("\"installed\"").is_err());
        assert!(serde_json::from_str::<CatalogView>("\"installed\"").is_err());
        assert!(serde_json::from_str::<ActionIntent>("\"remove\"").is_err());
        assert!(serde_json::from_str::<ActionState>("\"running\"").is_err());
    }

    #[test]
    fn standalone_contracts_serialize_without_expired_session_or_icon_url() {
        let app = AvailableApp {
            id: "app".into(),
            name: "App".into(),
            description: None,
            publisher: None,
            source: AppSource::Winget,
            package_identifier: None,
            released_version_id: "version".into(),
            released_version_label: None,
            installed_version_id: None,
            installed_version_label: None,
            install_state: AppInstallState::Available,
            active_action_id: None,
            active_action_state: None,
            has_icon: true,
        };
        let value = serde_json::to_value(app).unwrap();
        assert_eq!(value["hasIcon"], true);
        assert!(value.get("iconUrl").is_none());
        let bootstrap = NativeBootstrap {
            user: NativeUser {
                display_name: "User".into(),
            },
            device: NativeDevice {
                name: "Device".into(),
                status: "COMPLIANT".into(),
                last_seen_at: None,
            },
            assigned_eligible_count: 2,
            available_count: 2,
            updates: NativeUpdates {
                count: 0,
                keys: vec![],
            },
            writes_enabled: false,
        };
        let bootstrap = serde_json::to_value(bootstrap).unwrap();
        assert!(bootstrap.get("sessionExpiresAt").is_none());
        assert_eq!(bootstrap["assignedEligibleCount"], 2);
        assert_eq!(bootstrap["availableCount"], 2);
        assert_eq!(bootstrap["writesEnabled"], false);
    }

    #[test]
    fn connect_request_accepts_only_known_tagged_authentication_methods() {
        let personal_token = serde_json::from_str::<ConnectRequest>(
            r#"{"authMethod":"personal_token","relutionUsername":"user","accessToken":"token"}"#,
        )
        .unwrap();
        assert!(matches!(
            personal_token,
            ConnectRequest::PersonalToken { .. }
        ));

        assert!(serde_json::from_str::<ConnectRequest>(
            r#"{"authMethod":"unknown","relutionUsername":"user"}"#,
        )
        .is_err());
    }

    #[test]
    fn connect_request_rejects_mixed_duplicate_and_unknown_fields() {
        for json in [
            r#"{"authMethod":"personal_token","relutionUsername":"user","accessToken":"token","unexpected":"value"}"#,
            r#"{"authMethod":"personal_token","relutionUsername":"user","accessToken":"first","accessToken":"second"}"#,
        ] {
            assert!(
                serde_json::from_str::<ConnectRequest>(json).is_err(),
                "{json}"
            );
        }
    }
}
