use serde::{Deserialize, Serialize};

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
    ActionActive,
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

#[cfg(test)]
mod tests {
    use super::*;

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
            updates: NativeUpdates {
                count: 0,
                keys: vec![],
            },
            writes_enabled: false,
        };
        let bootstrap = serde_json::to_value(bootstrap).unwrap();
        assert!(bootstrap.get("sessionExpiresAt").is_none());
        assert_eq!(bootstrap["writesEnabled"], false);
    }
}
