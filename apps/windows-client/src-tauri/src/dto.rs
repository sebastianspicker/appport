//! Strict Relution response DTOs. Every HTTP boundary deserializes one of these.
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page<T> {
    pub results: Vec<T>,
    #[serde(default)]
    pub total: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct User {
    pub uuid: String,
    pub name: String,
    #[serde(rename = "organizationUuid")]
    pub organization_uuid: String,
    pub activated: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Device {
    pub uuid: String,
    #[serde(rename = "deviceId")]
    pub device_id: Option<String>,
    pub name: String,
    pub status: String,
    pub platform: String,
    #[serde(rename = "userUuid")]
    pub user_uuid: String,
    #[serde(rename = "organizationUuid")]
    pub organization_uuid: String,
    #[serde(rename = "serialNumber")]
    pub serial_number: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub uuid: String,
    pub name: Option<String>,
    #[serde(rename = "defaultName")]
    pub default_name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "developerInformation")]
    pub developer: Option<Developer>,
    #[serde(rename = "subType")]
    pub subtype: String,
    pub platforms: Vec<String>,
    pub versions: Versions,
    pub icon: Option<String>,
    #[serde(rename = "internalName")]
    pub internal_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Developer {
    pub name: Option<String>,
    #[serde(rename = "companyName")]
    pub company_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Versions {
    #[serde(rename = "RELEASE")]
    pub release: Option<Release>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub uuid: String,
    #[serde(rename = "versionName")]
    pub version_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Groups {
    pub groups: Vec<Group>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub uuid: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Permission {
    pub read: bool,
    #[serde(rename = "userGroupInfo")]
    pub subject: Subject,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Subject {
    pub uuid: String,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Deployment {
    pub successful: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inventory {
    pub identifier: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "appUuid")]
    pub app_uuid: Option<String>,
    #[serde(rename = "versionUuid")]
    pub version_uuid: Option<String>,
    #[serde(rename = "versionToShow")]
    pub version_to_show: Option<String>,
    #[serde(rename = "versionName")]
    pub version_name: Option<String>,
    #[serde(rename = "hasUpdateAvailable")]
    pub update: Option<bool>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceAction {
    pub uuid: String,
    pub state: String,
    #[serde(rename = "creationDate")]
    pub creation_date: i64,
    #[serde(default)]
    pub details: Option<ActionDetails>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionDetails {
    #[serde(rename = "appUuid")]
    pub app_uuid: Option<String>,
    #[serde(rename = "versionUuid")]
    pub version_uuid: Option<String>,
    #[serde(rename = "appInternalName")]
    pub package: Option<String>,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_identity_fields() {
        assert!(serde_json::from_str::<User>(
            r#"{"uuid":"u","name":"n","organizationUuid":"o","activated":true,"surprise":1}"#
        )
        .is_err())
    }
}
