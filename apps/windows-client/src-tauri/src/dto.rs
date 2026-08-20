//! Forward-compatible Relution response DTOs. Every HTTP boundary deserializes one of these.
use serde::Deserialize;
#[derive(Deserialize)]
pub struct Page<T> {
    #[serde(alias = "items")]
    pub results: Vec<T>,
    #[serde(default, alias = "nonpagedCount")]
    pub total: Option<u64>,
}
#[derive(Deserialize)]
pub struct User {
    pub uuid: String,
    pub name: String,
    #[serde(rename = "organizationUuid")]
    pub organization_uuid: String,
    pub activated: bool,
}
#[derive(Deserialize, Clone)]
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
pub struct Catalog {
    pub uuid: String,
    pub name: Option<String>,
    #[serde(rename = "defaultName")]
    pub default_name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "developerInformation")]
    pub developer: Option<Developer>,
    #[serde(rename = "subType")]
    pub subtype: Option<String>,
    pub platforms: Vec<String>,
    pub versions: Versions,
    pub icon: Option<String>,
    #[serde(rename = "internalName")]
    pub internal_name: Option<String>,
}
#[derive(Deserialize)]
pub struct Developer {
    pub name: Option<String>,
    #[serde(rename = "companyName")]
    pub company_name: Option<String>,
}
#[derive(Deserialize)]
pub struct Versions {
    #[serde(rename = "RELEASE")]
    pub release: Option<Release>,
}
#[derive(Deserialize)]
pub struct Release {
    pub uuid: String,
    #[serde(rename = "versionName")]
    pub version_name: Option<String>,
}
#[derive(Deserialize)]
pub struct Groups {
    pub groups: Vec<Group>,
}
#[derive(Deserialize)]
pub struct Group {
    pub uuid: String,
}
#[derive(Deserialize)]
pub struct Permission {
    pub read: bool,
    #[serde(rename = "userGroupInfo")]
    pub subject: Subject,
}
#[derive(Deserialize)]
pub struct Subject {
    pub uuid: String,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Deserialize)]
pub struct Deployment {
    pub successful: bool,
}
#[derive(Deserialize)]
pub struct Inventory {
    pub identifier: Option<String>,
    #[serde(rename = "name")]
    pub _name: Option<String>,
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
pub struct DeviceAction {
    pub uuid: String,
    pub state: String,
    #[serde(rename = "creationDate")]
    pub creation_date: i64,
    #[serde(default)]
    pub details: Option<ActionDetails>,
}
#[derive(Deserialize)]
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
    fn accepts_server_extensions_but_rejects_missing_or_wrong_required_identity_fields() {
        let user = r#"{"uuid":"u","name":"n","organizationUuid":"o","activated":true,"email":"n@example.test","status":"ACTIVE","message":"ok"}"#;
        assert!(serde_json::from_str::<User>(user).is_ok());
        assert!(
            serde_json::from_str::<User>(r#"{"uuid":"u","name":"n","organizationUuid":"o"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<User>(
            r#"{"uuid":"u","name":"n","organizationUuid":"o","activated":"true"}"#
        )
        .is_err());
    }

    #[test]
    fn page_accepts_relution_member_alias_and_server_metadata() {
        let page: Page<Group> = serde_json::from_str(
            r#"{"items":[{"uuid":"member"}],"nonpagedCount":1,"version":4,"errors":[],"status":"OK","message":"members"}"#,
        )
        .unwrap();
        assert_eq!(page.results.len(), 1);
        assert_eq!(page.total, Some(1));
    }

    #[test]
    fn device_page_accepts_relution_extensions() {
        let page: Page<Device> = serde_json::from_str(
            r#"{"results":[{"uuid":"30000000-0000-4000-8000-000000000003","deviceId":"ABCDEF0123456789ABCDEF0123456789","name":"TEST-WIN-042","serialNumber":"SYNTHETIC-42","userUuid":"40000000-0000-4000-8000-000000000004","organizationUuid":"10000000-0000-4000-8000-000000000001","platform":"WINDOWS","status":"COMPLIANT","manufacturer":"Example Vendor","windowsAvailableUpdateCount":0}],"total":1,"errors":[],"status":"OK","message":"devices"}"#,
        )
        .unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.results.len(), 1);
        assert_eq!(
            page.results[0].serial_number.as_deref(),
            Some("SYNTHETIC-42")
        );
    }
}
