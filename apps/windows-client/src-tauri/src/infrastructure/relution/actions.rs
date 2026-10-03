//! Relution deployment and device-action endpoint operations.

use super::{dto, encode, RelutionClient};
use crate::domain::action::{DeploymentResponse, RemoteAction};
use crate::error::Error;
use serde_json::json;

impl RelutionClient {
    pub(crate) async fn device_actions(
        &self,
        token: &str,
        device_id: &str,
    ) -> Result<Vec<RemoteAction>, Error> {
        let actions: Vec<dto::DeviceAction> = self
            .get_pages(
                &format!("/api/management/v1/devices/{}/actions", encode(device_id)),
                token,
                vec![],
            )
            .await?;
        Ok(actions
            .into_iter()
            .map(dto::DeviceAction::into_remote_action)
            .collect())
    }

    pub(crate) async fn deploy(
        &self,
        token: &str,
        app_id: &str,
        version_id: &str,
        device_id: &str,
    ) -> Result<DeploymentResponse, Error> {
        let response: dto::Page<dto::Deployment> = self
            .post_once(
                &format!(
                    "/api/management/v1/content/apps/{}/versions/{}/deployments",
                    encode(app_id),
                    encode(version_id)
                ),
                token,
                json!({"appUuid":app_id,"versionUuid":version_id,"deviceUuid":device_id}),
            )
            .await?;
        response.into_deployment_response()
    }
}
