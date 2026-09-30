//! Forward-compatible Relution response DTOs. Every HTTP boundary deserializes one of these,
//! and each DTO converts into the domain value that application policy consumes.

use crate::domain::{
    action::{DeploymentResponse, RemoteAction, RemoteActionDetails},
    catalog::{AppPermission, CatalogEntry, InstalledApp, PermissionSubject},
    device::AssignedDevice,
};
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

impl Device {
    pub(crate) fn into_assigned_device(self) -> AssignedDevice {
        AssignedDevice {
            uuid: self.uuid,
            device_id: self.device_id,
            name: self.name,
            status: self.status,
            platform: self.platform,
            user_uuid: self.user_uuid,
            organization_uuid: self.organization_uuid,
            serial_number: self.serial_number,
        }
    }
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

impl Catalog {
    pub(crate) fn into_catalog_entry(self) -> CatalogEntry {
        let release = self.versions.release;
        let developer = self.developer;
        CatalogEntry {
            id: self.uuid,
            name: self.name,
            default_name: self.default_name,
            description: self.description,
            developer_name: developer.as_ref().and_then(|value| value.name.clone()),
            developer_company_name: developer.and_then(|value| value.company_name),
            subtype: self.subtype,
            platforms: self.platforms,
            release_id: release.as_ref().map(|value| value.uuid.clone()),
            release_label: release.and_then(|value| value.version_name),
            has_icon: self.icon.is_some(),
            package_identifier: self.internal_name,
        }
    }
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

impl Permission {
    pub(crate) fn into_app_permission(self) -> AppPermission {
        let Subject { uuid, kind } = self.subject;
        AppPermission {
            read: self.read,
            subject: if kind.eq_ignore_ascii_case("USER") {
                PermissionSubject::User(uuid)
            } else if kind.eq_ignore_ascii_case("GROUP") {
                PermissionSubject::Group(uuid)
            } else {
                PermissionSubject::Other
            },
        }
    }
}
#[derive(Deserialize)]
pub struct Deployment {
    pub successful: bool,
}

impl Page<Deployment> {
    pub(crate) fn into_deployment_response(self) -> DeploymentResponse {
        if self.results.len() == 1 && self.results[0].successful {
            DeploymentResponse::Accepted
        } else {
            DeploymentResponse::NotAccepted
        }
    }
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

impl Inventory {
    pub(crate) fn into_installed_app(self) -> InstalledApp {
        InstalledApp {
            identifier: self.identifier,
            app_id: self.app_uuid,
            version_id: self.version_uuid,
            version_label: self.version_to_show.or(self.version_name),
            has_update: self.update,
        }
    }
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
#[derive(Clone, Deserialize)]
pub struct ActionDetails {
    #[serde(rename = "appUuid")]
    pub app_uuid: Option<String>,
    #[serde(rename = "versionUuid")]
    pub version_uuid: Option<String>,
    #[serde(rename = "appInternalName")]
    pub package: Option<String>,
}

impl DeviceAction {
    pub(crate) fn into_remote_action(self) -> RemoteAction {
        RemoteAction {
            id: self.uuid,
            state: self.state,
            created_at: self.creation_date,
            details: self.details.map(|details| RemoteActionDetails {
                app_id: details.app_uuid,
                version_id: details.version_uuid,
                package_id: details.package,
            }),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{
        Catalog, Deployment, Device, DeviceAction, Group, Inventory, Page, Permission, User,
    };
    use crate::domain::{
        action::{DeploymentResponse, RemoteAction, RemoteActionDetails},
        catalog::{AppPermission, CatalogEntry, InstalledApp, PermissionSubject},
    };
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

    #[test]
    fn catalog_converts_into_the_domain_entry() {
        let catalog: Catalog = serde_json::from_str(
            r#"{"uuid":"app","name":null,"defaultName":"Default","description":"About","developerInformation":{"name":null,"companyName":"Company"},"subType":"WINGET","platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"version","versionName":"2.0"}},"icon":"icon","internalName":"Pkg.Id"}"#,
        )
        .unwrap();
        assert_eq!(
            catalog.into_catalog_entry(),
            CatalogEntry {
                id: "app".into(),
                name: None,
                default_name: Some("Default".into()),
                description: Some("About".into()),
                developer_name: None,
                developer_company_name: Some("Company".into()),
                subtype: Some("WINGET".into()),
                platforms: vec!["WINDOWS".into()],
                release_id: Some("version".into()),
                release_label: Some("2.0".into()),
                has_icon: true,
                package_identifier: Some("Pkg.Id".into()),
            }
        );
        let bare: Catalog =
            serde_json::from_str(r#"{"uuid":"app","platforms":[],"versions":{}}"#).unwrap();
        let entry = bare.into_catalog_entry();
        assert_eq!((entry.release_id, entry.release_label), (None, None));
        assert!(!entry.has_icon);
    }

    #[test]
    fn inventory_prefers_the_displayed_version_label() {
        let inventory = |json: &str| {
            serde_json::from_str::<Inventory>(json)
                .unwrap()
                .into_installed_app()
        };
        assert_eq!(
            inventory(
                r#"{"identifier":"pkg","name":"App","appUuid":"app","versionUuid":"version","versionToShow":"2","versionName":"2.0.1","hasUpdateAvailable":true}"#
            ),
            InstalledApp {
                identifier: Some("pkg".into()),
                app_id: Some("app".into()),
                version_id: Some("version".into()),
                version_label: Some("2".into()),
                has_update: Some(true),
            }
        );
        assert_eq!(
            inventory(r#"{"versionName":"2.0.1"}"#)
                .version_label
                .as_deref(),
            Some("2.0.1")
        );
    }

    #[test]
    fn permission_subject_kinds_convert_case_insensitively() {
        let permission = |read: bool, kind: &str| {
            serde_json::from_str::<Permission>(&format!(
                r#"{{"read":{read},"userGroupInfo":{{"uuid":"subject","type":"{kind}"}}}}"#
            ))
            .unwrap()
            .into_app_permission()
        };
        assert_eq!(
            permission(true, "user"),
            AppPermission {
                read: true,
                subject: PermissionSubject::User("subject".into()),
            }
        );
        assert_eq!(
            permission(false, "Group").subject,
            PermissionSubject::Group("subject".into())
        );
        assert!(!permission(false, "Group").read);
        assert_eq!(permission(true, "ROLE").subject, PermissionSubject::Other);
    }

    #[test]
    fn device_actions_convert_into_remote_actions() {
        let actions: Page<DeviceAction> = serde_json::from_str(
            r#"{"results":[{"uuid":"a","state":"PENDING","creationDate":7,"details":{"appUuid":"app","versionUuid":"version","appInternalName":"pkg"}},{"uuid":"b","state":"ERROR","creationDate":8}]}"#,
        )
        .unwrap();
        let actions = actions
            .results
            .into_iter()
            .map(DeviceAction::into_remote_action)
            .collect::<Vec<_>>();
        assert_eq!(
            actions,
            [
                RemoteAction {
                    id: "a".into(),
                    state: "PENDING".into(),
                    created_at: 7,
                    details: Some(RemoteActionDetails {
                        app_id: Some("app".into()),
                        version_id: Some("version".into()),
                        package_id: Some("pkg".into()),
                    }),
                },
                RemoteAction {
                    id: "b".into(),
                    state: "ERROR".into(),
                    created_at: 8,
                    details: None,
                },
            ]
        );
    }

    #[test]
    fn only_one_successful_deployment_result_is_acceptance() {
        let response = |results: &[bool]| {
            Page {
                results: results
                    .iter()
                    .map(|&successful| Deployment { successful })
                    .collect(),
                total: None,
            }
            .into_deployment_response()
        };
        assert_eq!(response(&[true]), DeploymentResponse::Accepted);
        assert_eq!(response(&[false]), DeploymentResponse::NotAccepted);
        assert_eq!(response(&[true, true]), DeploymentResponse::NotAccepted);
        assert_eq!(response(&[]), DeploymentResponse::NotAccepted);
    }
}
