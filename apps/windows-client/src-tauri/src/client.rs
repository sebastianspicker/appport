use crate::{
    client_support::*,
    dto, evidence,
    wire::{
        AppAction, AppInstallState, AvailableApp, CatalogView, NativeBootstrap, NativeDevice,
        NativeUpdates, NativeUser,
    },
};
use reqwest::{header, Method};
use serde::de::DeserializeOwned;
use serde_json::json;
use std::{collections::HashMap, sync::Mutex as StdMutex, time::Duration};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;
const MAX_JSON_BYTES: usize = 10 * 1024 * 1024;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;
#[derive(Clone)]
pub struct RelutionConfig {
    pub base: Url,
    pub organization_uuid: String,
    pub native_app_uuid: String,
    pub writes_enabled: bool,
}
pub struct RelutionClient {
    config: RelutionConfig,
    http: reqwest::Client,
    cache: StdMutex<CredentialCache>,
    catalog_refresh: AsyncMutex<()>,
    icon_requests: Semaphore,
}
pub struct ConnectedIdentity {
    pub username: String,
    pub user_uuid: String,
}
struct CurrentDevice {
    id: String,
    wire: NativeDevice,
}
#[derive(Default)]
struct CredentialCache {
    generation: Option<u64>,
    apps: Option<Vec<AvailableApp>>,
    icons: HashMap<String, Option<String>>,
}
impl RelutionConfig {
    pub fn embedded() -> Result<Self, String> {
        let base = Url::parse(option_env!("APPPORT_RELUTION_API_BASE_URL").ok_or(
            "configuration: APPPORT_RELUTION_API_BASE_URL was not embedded in this build",
        )?)
        .map_err(|_| "configuration: invalid Relution API URL")?;
        if !fixed_https(&base) {
            return Err("configuration: Relution API URL must be a fixed HTTPS origin".into());
        }
        let organization_uuid = option_env!("APPPORT_RELUTION_ORGANIZATION_UUID")
            .filter(|x| valid_id(x))
            .ok_or(
                "configuration: APPPORT_RELUTION_ORGANIZATION_UUID was not embedded in this build",
            )?
            .into();
        let native_app_uuid = option_env!("APPPORT_NATIVE_APP_UUID")
            .filter(|x| valid_id(x))
            .ok_or("configuration: APPPORT_NATIVE_APP_UUID was not embedded in this build")?
            .into();
        Ok(Self {
            base,
            organization_uuid,
            native_app_uuid,
            writes_enabled: false,
        })
    }
}
impl RelutionClient {
    pub fn new(config: RelutionConfig) -> Result<Self, String> {
        Ok(Self {
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "configuration: HTTP client unavailable")?,
            cache: StdMutex::new(CredentialCache::default()),
            catalog_refresh: AsyncMutex::new(()),
            icon_requests: Semaphore::new(4),
        })
    }
    pub async fn connect(&self, username: &str, token: &str) -> Result<ConnectedIdentity, String> {
        if username.trim().is_empty() || token.trim().is_empty() {
            return Err("session-expired: invalid Relution credentials".into());
        }
        let users: Vec<dto::User> = self
            .post_pages(
                "/api/management/v1/security/users/baseInfo/query",
                token,
                json!({"searches":[username.trim()],"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        let m: Vec<_> = users
            .into_iter()
            .filter(|u| {
                u.name.eq_ignore_ascii_case(username.trim())
                    && u.organization_uuid == self.config.organization_uuid
                    && u.activated
            })
            .collect();
        if m.len() != 1 {
            return Err(
                "device_match_failed: Relution identity is not a single active organization user"
                    .into(),
            );
        }
        Ok(ConnectedIdentity {
            username: username.trim().into(),
            user_uuid: m[0].uuid.clone(),
        })
    }
    pub async fn bootstrap(
        &self,
        t: &str,
        u: &str,
        id: &str,
        generation: u64,
    ) -> Result<NativeBootstrap, String> {
        let d = self.current_device(t, id).await?;
        let a = self.cached_apps(t, id, &d, generation).await?;
        let keys = a
            .iter()
            .filter(|x| x.install_state == crate::wire::AppInstallState::UpdateAvailable)
            .map(|x| format!("{}:{}", x.id, x.released_version_id))
            .collect::<Vec<_>>();
        Ok(NativeBootstrap {
            user: NativeUser {
                display_name: u.into(),
            },
            device: d.wire,
            updates: NativeUpdates {
                count: keys.len() as u32,
                keys,
            },
            writes_enabled: self.config.writes_enabled,
        })
    }
    pub async fn list_apps(
        &self,
        t: &str,
        u: &str,
        generation: u64,
        view: CatalogView,
    ) -> Result<Vec<AvailableApp>, String> {
        let d = self.current_device(t, u).await?;
        Ok(filter_catalog_view(
            self.cached_apps(t, u, &d, generation).await?,
            view,
        ))
    }
    async fn cached_apps(
        &self,
        t: &str,
        u: &str,
        d: &CurrentDevice,
        generation: u64,
    ) -> Result<Vec<AvailableApp>, String> {
        if let Some(apps) = self.cache_for(generation)?.apps.clone() {
            return Ok(apps);
        }
        let _refresh = self.catalog_refresh.lock().await;
        if let Some(apps) = self.cache_for(generation)?.apps.clone() {
            return Ok(apps);
        }
        let apps = self.list_apps_for(t, u, d).await?;
        self.cache_for(generation)?.apps = Some(apps.clone());
        Ok(apps)
    }
    async fn list_apps_for(
        &self,
        t: &str,
        u: &str,
        d: &CurrentDevice,
    ) -> Result<Vec<AvailableApp>, String> {
        let locale = crate::platform::current_locale();
        let catalog: Vec<dto::Catalog> = self
            .get_pages(
                "/api/management/v1/content/apps/baseInfo",
                t,
                vec![("extend", "versions"), ("locale", locale.as_str())],
            )
            .await?;
        let groups: dto::Groups = self
            .get(
                "/api/management/v1/security/users/".to_string() + &encode(u) + "/groups",
                t,
                vec![],
            )
            .await?;
        let group_ids: Vec<String> = groups.groups.into_iter().map(|g| g.uuid).collect();
        let inventory: Vec<dto::Inventory> = self
            .post_pages(
                &format!(
                    "/api/management/v2/devices/{}/installedApps/baseInfo/query",
                    encode(&d.id)
                ),
                t,
                json!({"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        let mut out = Vec::new();
        for catalog_entry in catalog {
            self.add_allowed_app(&mut out, catalog_entry, t, u, &group_ids, &inventory)
                .await?;
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
    }
    async fn add_allowed_app(
        &self,
        out: &mut Vec<AvailableApp>,
        catalog: dto::Catalog,
        token: &str,
        user: &str,
        groups: &[String],
        inventory: &[dto::Inventory],
    ) -> Result<(), String> {
        let Some(mut app) = app_from(catalog, &self.config.native_app_uuid) else {
            return Ok(());
        };
        if !self.allowed(token, user, groups, &app.id).await? {
            return Ok(());
        }
        let app_id = app.id.clone();
        let installed = inventory
            .iter()
            .find(|item| item.app_uuid.as_deref() == Some(&app_id));
        apply_inventory(&mut app, installed);
        out.push(app);
        Ok(())
    }
    async fn allowed(
        &self,
        t: &str,
        u: &str,
        groups: &[String],
        app: &str,
    ) -> Result<bool, String> {
        let p: dto::Page<dto::Permission> = self
            .get(
                &format!(
                    "/api/management/v1/content/apps/{}/permissions/RELEASE",
                    encode(app)
                ),
                t,
                vec![],
            )
            .await?;
        for permission in p.results {
            if self.permission_allows(t, u, groups, &permission).await? {
                return Ok(true);
            }
        }
        Ok(false)
    }
    async fn permission_allows(
        &self,
        token: &str,
        user: &str,
        groups: &[String],
        permission: &dto::Permission,
    ) -> Result<bool, String> {
        if !permission.read {
            return Ok(false);
        }
        if permission.subject.kind == "USER" {
            return Ok(permission.subject.uuid == user);
        }
        Ok(permission.subject.kind == "GROUP"
            && (groups.contains(&permission.subject.uuid)
                || self
                    .group_contains(token, &permission.subject.uuid, user)
                    .await?))
    }
    async fn group_contains(&self, t: &str, group: &str, user: &str) -> Result<bool, String> {
        let members: Vec<dto::Group> = self
            .get_pages(
                &format!(
                    "/api/management/v1/security/groups/{}/members",
                    encode(group)
                ),
                t,
                vec![("recursive", "true")],
            )
            .await?;
        Ok(members.into_iter().any(|member| member.uuid == user))
    }
}

fn filter_catalog_view(apps: Vec<AvailableApp>, view: CatalogView) -> Vec<AvailableApp> {
    let expected_state = match view {
        CatalogView::Apps => AppInstallState::Available,
        CatalogView::Updates => AppInstallState::UpdateAvailable,
    };
    apps.into_iter()
        .filter(|app| app.install_state == expected_state)
        .collect()
}

#[path = "client_actions.rs"]
mod actions;
#[path = "client_icons.rs"]
mod icons;
#[path = "client_transport.rs"]
mod transport;

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
