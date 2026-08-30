//! Raw Relution icon retrieval with bounded response parsing.

use super::{encode, network, status, RelutionClient};
use crate::infrastructure::logging;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::header;

const MAX_ICON_BYTES: usize = 1024 * 1024;

impl RelutionClient {
    pub(crate) async fn fetch_icon(
        &self,
        token: &str,
        app_id: &str,
    ) -> Result<Option<String>, String> {
        let path = format!("/api/management/v1/content/apps/{}/icon", encode(app_id));
        let response = self
            .http
            .get(self.url(&path)?)
            .header("X-User-Access-Token", token)
            .header("tenantOrganizationUuid", &self.config.organization_uuid)
            .send()
            .await
            .map_err(network)?;
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        logging::write_relution_icon_response(
            &path,
            response.status().as_u16(),
            content_type,
            response.content_length(),
        );
        icon_data_url(response).await
    }
}

async fn icon_data_url(response: reqwest::Response) -> Result<Option<String>, String> {
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(status(response.status()));
    }
    if response.content_length().unwrap_or(0) > MAX_ICON_BYTES as u64 {
        return Err("server: icon response is too large".into());
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| matches!(*value, "image/png" | "image/jpeg" | "image/webp"))
        .ok_or("server: unsupported icon type")?
        .to_owned();
    let bytes = read_icon_at_most(response, MAX_ICON_BYTES).await?;
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(bytes)
    )))
}
async fn read_icon_at_most(
    mut response: reqwest::Response,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let mut body = Vec::with_capacity(maximum.saturating_add(1).min(64 * 1024));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "server: icon response failed")?
    {
        let remaining = maximum.saturating_add(1).saturating_sub(body.len());
        if chunk.len() > remaining {
            body.extend_from_slice(&chunk[..remaining]);
            return Err("server: icon response is too large".into());
        }
        body.extend_from_slice(&chunk);
        if body.len() > maximum {
            return Err("server: icon response is too large".into());
        }
    }
    Ok(body)
}
