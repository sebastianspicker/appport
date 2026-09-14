//! Synthetic Relution responses shared by action and admission tests.

use super::test_support::Response;

pub(crate) const ASSIGNED_DEVICE: &str = r#"{"results":[{"uuid":"device","deviceId":"device-evidence","name":"Device","status":"COMPLIANT","platform":"WINDOWS","userUuid":"user","organizationUuid":"tenant","serialNumber":null}]}"#;
pub(crate) const CATALOG: &str = r#"{"results":[{"uuid":"app","name":"App","defaultName":null,"description":null,"developerInformation":null,"subType":"WINGET","platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"version","versionName":"2"}},"icon":"icon","internalName":"app.package"}]}"#;
pub(crate) const GROUPS: &str = r#"{"groups":[]}"#;
pub(crate) const EMPTY_INVENTORY: &str = r#"{"results":[]}"#;
pub(crate) const DIRECT_PERMISSION: &str =
    r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#;

pub(crate) fn catalog_response(request: &str, permission: &'static str) -> Option<Response> {
    if request.contains("/api/management/v2/devices/baseInfo/query") {
        return Some(Response::json(200, ASSIGNED_DEVICE));
    }
    if request.contains("/api/management/v1/content/apps/baseInfo") {
        return Some(Response::json(200, CATALOG));
    }
    if request.contains("/api/management/v1/security/users/user/groups") {
        return Some(Response::json(200, GROUPS));
    }
    if request.contains("/api/management/v2/devices/device/installedApps/baseInfo/query") {
        return Some(Response::json(200, EMPTY_INVENTORY));
    }
    if request.contains("/api/management/v1/content/apps/app/permissions/RELEASE") {
        return Some(Response::json(200, permission));
    }
    None
}
