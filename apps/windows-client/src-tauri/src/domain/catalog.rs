//! Side-effect-free catalog models and classification policy.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppSource {
    Winget,
    WindowsMsi,
    WindowsExe,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppInstallState {
    Available,
    UpdateAvailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogView {
    Apps,
    Updates,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
    pub active_action_state: Option<crate::domain::action::ActionState>,
    pub has_icon: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSummary {
    pub id: String,
    pub name: String,
    pub status: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogBootstrap {
    pub username: String,
    pub device: DeviceSummary,
    pub assigned_eligible_count: u32,
    pub available_count: u32,
    pub update_keys: Vec<String>,
    pub writes_enabled: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogEntry {
    pub id: String,
    pub name: Option<String>,
    pub default_name: Option<String>,
    pub description: Option<String>,
    pub developer_name: Option<String>,
    pub developer_company_name: Option<String>,
    pub subtype: Option<String>,
    pub platforms: Vec<String>,
    pub release_id: Option<String>,
    pub release_label: Option<String>,
    pub has_icon: bool,
    pub package_identifier: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledApp {
    pub identifier: Option<String>,
    pub app_id: Option<String>,
    pub version_id: Option<String>,
    pub version_label: Option<String>,
    pub has_update: Option<bool>,
}

pub fn app_from(catalog: CatalogEntry, native_app_id: &str) -> Option<AvailableApp> {
    if same_uuid(&catalog.id, native_app_id)
        || !catalog
            .platforms
            .iter()
            .any(|value| value.eq_ignore_ascii_case("WINDOWS"))
    {
        return None;
    }
    let source = match catalog.subtype.as_deref() {
        Some("WINGET") => AppSource::Winget,
        Some("WINDOWS_MSI") => AppSource::WindowsMsi,
        Some("WINDOWS_EXE") => AppSource::WindowsExe,
        _ => return None,
    };
    Some(AvailableApp {
        id: catalog.id,
        name: catalog.name.or(catalog.default_name)?,
        description: catalog.description,
        publisher: catalog.developer_name.or(catalog.developer_company_name),
        source,
        package_identifier: catalog.package_identifier,
        released_version_id: catalog.release_id?,
        released_version_label: catalog.release_label,
        installed_version_id: None,
        installed_version_label: None,
        install_state: AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: catalog.has_icon,
    })
}
pub fn classify_catalog_inventory(
    mut app: AvailableApp,
    inventory: Option<&InstalledApp>,
) -> Result<CatalogInventoryClassification, String> {
    let Some(inventory) = inventory else {
        return Ok(CatalogInventoryClassification::Visible(Box::new(app)));
    };
    let labels_are_comparable = match (
        app.released_version_label.as_deref(),
        inventory.version_label.as_deref(),
    ) {
        (Some(released), Some(installed)) => {
            compare_dotted_numeric_versions(released, installed).is_some()
        }
        _ => false,
    };
    let matching_release = inventory
        .version_id
        .as_deref()
        .is_some_and(|installed| same_uuid(installed, &app.released_version_id));
    apply_inventory(&mut app, Some(inventory));
    if app.install_state == AppInstallState::UpdateAvailable {
        return Ok(CatalogInventoryClassification::Visible(Box::new(app)));
    }
    if labels_are_comparable || matching_release || inventory.has_update == Some(false) {
        Ok(CatalogInventoryClassification::InstalledCurrent)
    } else {
        Err("server: installed application version cannot be classified".into())
    }
}
pub enum CatalogInventoryClassification {
    Visible(Box<AvailableApp>),
    InstalledCurrent,
}
pub fn apply_inventory(app: &mut AvailableApp, inventory: Option<&InstalledApp>) {
    let Some(inventory) = inventory else { return };
    app.installed_version_id = inventory.version_id.clone();
    app.installed_version_label = inventory.version_label.clone();
    if let (Some(released), Some(installed)) = (
        app.released_version_label.as_deref(),
        app.installed_version_label.as_deref(),
    ) {
        if let Some(ordering) = compare_dotted_numeric_versions(released, installed) {
            app.install_state = if ordering == Ordering::Greater {
                AppInstallState::UpdateAvailable
            } else {
                AppInstallState::Available
            };
            return;
        }
    }
    if inventory
        .version_id
        .as_deref()
        .is_some_and(|installed| !same_uuid(installed, &app.released_version_id))
        || inventory.has_update == Some(true)
    {
        app.install_state = AppInstallState::UpdateAvailable;
    }
}
pub fn bootstrap_catalog_summary(apps: &[AvailableApp]) -> (u32, Vec<String>) {
    let available = apps
        .iter()
        .filter(|app| app.install_state == AppInstallState::Available)
        .count() as u32;
    let keys = apps
        .iter()
        .filter(|app| app.install_state == AppInstallState::UpdateAvailable)
        .map(update_notification_key)
        .collect();
    (available, keys)
}
pub fn filter_catalog_view(apps: Vec<AvailableApp>, view: CatalogView) -> Vec<AvailableApp> {
    let expected = match view {
        CatalogView::Apps => AppInstallState::Available,
        CatalogView::Updates => AppInstallState::UpdateAvailable,
    };
    apps.into_iter()
        .filter(|app| app.install_state == expected)
        .collect()
}
fn update_notification_key(app: &AvailableApp) -> String {
    let mut digest = Sha256::new();
    digest.update(b"relution-appport:update:v1\\0");
    digest.update(app.id.as_bytes());
    digest.update([0]);
    digest.update(app.released_version_id.as_bytes());
    format!("sha256:{:x}", digest.finalize())
}
fn compare_dotted_numeric_versions(released: &str, installed: &str) -> Option<Ordering> {
    let mut released = dotted_numeric_components(released)?;
    let mut installed = dotted_numeric_components(installed)?;
    while released
        .last()
        .is_some_and(|part| part.bytes().all(|byte| byte == b'0'))
    {
        released.pop();
    }
    while installed
        .last()
        .is_some_and(|part| part.bytes().all(|byte| byte == b'0'))
    {
        installed.pop();
    }
    for index in 0..released.len().max(installed.len()) {
        let ordering = compare_numeric_component(
            released.get(index).copied().unwrap_or("0"),
            installed.get(index).copied().unwrap_or("0"),
        );
        if ordering != Ordering::Equal {
            return Some(ordering);
        }
    }
    Some(Ordering::Equal)
}
fn dotted_numeric_components(value: &str) -> Option<Vec<&str>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let components: Vec<_> = value.split('.').collect();
    components
        .iter()
        .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some(components)
}
fn compare_numeric_component(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    match left.len().cmp(&right.len()) {
        Ordering::Equal => left.cmp(right),
        ordering => ordering,
    }
}
fn same_uuid(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

#[cfg(test)]
mod tests {
    use super::{bootstrap_catalog_summary, AppInstallState, AppSource, AvailableApp};
    #[test]
    fn update_keys_are_opaque_deterministic_hashes() {
        let app = AvailableApp {
            id: "update".into(),
            name: "Secret Label".into(),
            description: None,
            publisher: None,
            source: AppSource::Winget,
            package_identifier: None,
            released_version_id: "version".into(),
            released_version_label: Some("24215.1007.3146.2020".into()),
            installed_version_id: None,
            installed_version_label: None,
            install_state: AppInstallState::UpdateAvailable,
            active_action_id: None,
            active_action_state: None,
            has_icon: false,
        };
        let (_, keys) = bootstrap_catalog_summary(&[app]);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].len(), "sha256:".len() + 64);
        assert!(!keys[0].contains("update"));
    }
}
