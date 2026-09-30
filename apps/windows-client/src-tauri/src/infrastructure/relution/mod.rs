//! Fixed-origin Relution HTTP adapter. It owns endpoint operations and DTO-to-domain conversion only.

use crate::build_config::is_fixed_https_origin;
use crate::domain::device::same_uuid;
use crate::error::Error;
use serde_json::json;
use std::time::Duration;
use url::Url;

mod dto;
mod response;

use transport::{encode, network, status};

const MAX_JSON_BYTES: usize = 10 * 1024 * 1024;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
        && value
            .chars()
            .any(|character| character != '0' && character != '-')
}

#[derive(Clone)]
pub struct RelutionConfig {
    pub base: Url,
    pub organization_uuid: String,
    pub native_app_uuid: String,
    pub writes_enabled: bool,
}

pub struct RelutionClient {
    pub(super) config: RelutionConfig,
    pub(super) http: reqwest::Client,
}

pub struct ConnectedIdentity {
    pub username: String,
    pub user_uuid: String,
}

impl RelutionConfig {
    pub fn embedded() -> Result<Self, Error> {
        let base = Url::parse(option_env!("APPPORT_RELUTION_API_BASE_URL").ok_or_else(|| {
            Error::configuration("APPPORT_RELUTION_API_BASE_URL was not embedded in this build")
        })?)
        .map_err(|_| Error::configuration("invalid Relution API URL"))?;
        if !is_fixed_https_origin(&base) {
            return Err(Error::configuration(
                "Relution API URL must be a fixed HTTPS origin",
            ));
        }
        let organization_uuid = option_env!("APPPORT_RELUTION_ORGANIZATION_UUID")
            .filter(|value| valid_id(value))
            .ok_or_else(|| {
                Error::configuration(
                    "APPPORT_RELUTION_ORGANIZATION_UUID was not embedded in this build",
                )
            })?
            .into();
        let native_app_uuid = option_env!("APPPORT_NATIVE_APP_UUID")
            .filter(|value| valid_id(value))
            .ok_or_else(|| {
                Error::configuration("APPPORT_NATIVE_APP_UUID was not embedded in this build")
            })?
            .into();
        let writes_enabled = match option_env!("APPPORT_RELUTION_WRITES_ENABLED") {
            Some("true") => true,
            Some("false") => false,
            _ => return Err(Error::configuration("invalid embedded write flag")),
        };
        Ok(Self {
            base,
            organization_uuid,
            native_app_uuid,
            writes_enabled,
        })
    }
}

impl RelutionClient {
    pub fn new(config: RelutionConfig) -> Result<Self, Error> {
        Self::with_timeout(config, Duration::from_secs(20))
    }

    pub(crate) fn with_timeout(config: RelutionConfig, timeout: Duration) -> Result<Self, Error> {
        Ok(Self {
            config,
            http: reqwest::Client::builder()
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| Error::configuration("HTTP client unavailable"))?,
        })
    }
    pub(crate) fn native_app_uuid(&self) -> &str {
        &self.config.native_app_uuid
    }
    pub(crate) fn organization_uuid(&self) -> &str {
        &self.config.organization_uuid
    }
    pub(crate) fn writes_enabled(&self) -> bool {
        self.config.writes_enabled
    }

    pub async fn connect(&self, username: &str, token: &str) -> Result<ConnectedIdentity, Error> {
        if username.trim().is_empty() || token.trim().is_empty() {
            return Err(Error::session_expired("invalid Relution credentials"));
        }
        let users: Vec<dto::User> = self
            .post_pages(
                "/api/management/v1/security/users/baseInfo/query",
                token,
                json!({"searches":[username.trim()],"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        let matches: Vec<_> = users
            .into_iter()
            .filter(|user| {
                user.name.eq_ignore_ascii_case(username.trim())
                    && same_uuid(&user.organization_uuid, &self.config.organization_uuid)
                    && user.activated
            })
            .collect();
        if matches.len() != 1 {
            return Err(Error::device_match_failed(
                "Relution identity is not a single active organization user",
            ));
        }
        Ok(ConnectedIdentity {
            username: username.trim().into(),
            user_uuid: matches[0].uuid.clone(),
        })
    }
}

mod actions;
mod icons;
mod transport;
