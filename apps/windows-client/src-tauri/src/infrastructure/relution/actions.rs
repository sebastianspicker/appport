//! Raw Relution deployment and device-action endpoint operations.

use super::{dto, encode, RelutionClient};
use serde_json::json;

impl RelutionClient {
    pub(crate) async fn device_actions(
        &self,
        token: &str,
        device_id: &str,
    ) -> Result<Vec<dto::DeviceAction>, String> {
        self.get_pages(
            &format!("/api/management/v1/devices/{}/actions", encode(device_id)),
            token,
            vec![],
        )
        .await
    }

    pub(crate) async fn deploy(
        &self,
        token: &str,
        app_id: &str,
        version_id: &str,
        device_id: &str,
    ) -> Result<dto::Page<dto::Deployment>, String> {
        self.post_once(
            &format!(
                "/api/management/v1/content/apps/{}/versions/{}/deployments",
                encode(app_id),
                encode(version_id)
            ),
            token,
            json!({"appUuid":app_id,"versionUuid":version_id,"deviceUuid":device_id}),
        )
        .await
    }
}
