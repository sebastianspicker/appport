use crate::{
    dto, evidence,
    wire::{AppAction, AvailableApp, NativeBootstrap, NativeDevice, NativeUpdates, NativeUser},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;
use reqwest::{header, Method};
use serde::de::DeserializeOwned;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::Mutex as StdMutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;
use url::Url;
const MAX_JSON_BYTES: usize = 10 * 1024 * 1024;
const MAX_ICON_BYTES: usize = 1024 * 1024;
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
        })
    }
    pub async fn list_apps(
        &self,
        t: &str,
        u: &str,
        generation: u64,
    ) -> Result<Vec<AvailableApp>, String> {
        let d = self.current_device(t, u).await?;
        self.cached_apps(t, u, &d, generation).await
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
        let catalog: Vec<dto::Catalog> = self
            .get_pages(
                "/api/management/v1/content/apps/baseInfo",
                t,
                vec![("extend", "versions"), ("locale", "en")],
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
        for c in catalog {
            if let Some(mut app) = app_from(c, &self.config.native_app_uuid) {
                if self.allowed(t, u, &group_ids, &app.id).await? {
                    let installed = inventory
                        .iter()
                        .find(|i| i.app_uuid.as_deref() == Some(&app.id));
                    if let Some(i) = installed {
                        app.installed_version_id = i.version_uuid.clone();
                        app.installed_version_label =
                            i.version_to_show.clone().or(i.version_name.clone());
                        if i.update == Some(true) {
                            app.install_state = crate::wire::AppInstallState::UpdateAvailable
                        }
                    }
                    out.push(app)
                }
            }
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
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
            if !permission.read {
                continue;
            }
            if permission.subject.kind == "USER" && permission.subject.uuid == u {
                return Ok(true);
            }
            if permission.subject.kind == "GROUP"
                && (groups.contains(&permission.subject.uuid)
                    || self.group_contains(t, &permission.subject.uuid, u).await?)
            {
                return Ok(true);
            }
        }
        Ok(false)
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
    pub async fn request_action(
        &self,
        t: &str,
        u: &str,
        app_id: &str,
    ) -> Result<AppAction, String> {
        if !self.config.writes_enabled {
            return Err("server: Relution writes are disabled for this build".into());
        }
        let d = self.current_device(t, u).await?;
        let apps = self.list_apps_for(t, u, &d).await?;
        let app = apps
            .into_iter()
            .find(|a| a.id == app_id)
            .ok_or("server: application is not permitted")?;
        let intent = if app.installed_version_id.is_some() {
            crate::wire::ActionIntent::Update
        } else {
            crate::wire::ActionIntent::Install
        };
        if app.installed_version_id.as_deref() == Some(&app.released_version_id)
            || (app.installed_version_id.is_some()
                && app.install_state != crate::wire::AppInstallState::UpdateAvailable)
        {
            return Err("server: application is already current or update is not approved".into());
        }
        let id = uuid_key();
        let baseline = self
            .device_actions(t, &d.id)
            .await?
            .into_iter()
            .map(|a| a.uuid)
            .collect::<Vec<_>>()
            .join(",");
        crate::journal::reserve(
            &id,
            &self.config.organization_uuid,
            &d.id,
            &app.id,
            &app.released_version_id,
            app.package_identifier.as_deref(),
            if intent == crate::wire::ActionIntent::Install {
                "install"
            } else {
                "update"
            },
            &baseline,
        )?;
        let r: Result<dto::Page<dto::Deployment>, String> = self
            .post_once(
                &format!(
                    "/api/management/v1/content/apps/{}/versions/{}/deployments",
                    encode(&app.id),
                    encode(&app.released_version_id)
                ),
                t,
                json!({"appUuid":app.id,"versionUuid":app.released_version_id,"deviceUuid":d.id}),
            )
            .await;
        if let Ok(r) = r {
            if r.results.len() == 1 && r.results[0].successful {
                crate::journal::update(&id, "queued", None, None, None)?;
            } else {
                crate::journal::update(
                    &id,
                    "failed",
                    None,
                    Some("SUBMISSION_REJECTED"),
                    Some("Relution rejected the application request."),
                )?;
                return Err("server: Relution did not accept the deployment".into());
            }
        } else if let Err(e) = r {
            let failed = e.starts_with("session-expired:")
                || e.starts_with("device_match_failed:")
                || e.contains("rejected");
            crate::journal::update(
                &id,
                if failed { "failed" } else { "unknown" },
                None,
                Some(if failed {
                    "SUBMISSION_REJECTED"
                } else {
                    "SUBMISSION_UNCERTAIN"
                }),
                Some("The submission status could not be confirmed. Do not retry."),
            )?;
            return Err(e);
        };
        Ok(to_action(crate::journal::action(&id)?.unwrap()))
    }
    pub async fn get_action(&self, t: &str, u: &str, id: &str) -> Result<AppAction, String> {
        let mut a =
            crate::journal::action(id)?.ok_or("server: application action was not found")?;
        if matches!(
            a.state.as_str(),
            "succeeded" | "failed" | "cancelled" | "unknown"
        ) {
            return Ok(to_action(a));
        }
        let device = self.current_device(t, u).await?;
        if device.id != a.device_id {
            return Err("device_match_failed: device not assigned".into());
        }
        let actions = self.device_actions(t, &a.device_id).await?;
        let baseline: std::collections::HashSet<_> =
            a.baseline.split(',').filter(|x| !x.is_empty()).collect();
        let candidates = correlation_candidates(actions, &baseline, &a);
        let remote = if let Some(correlation) = a.correlation.as_deref() {
            candidates.into_iter().find(|x| x.uuid == correlation)
        } else if candidates.len() == 1 {
            let c = &candidates[0].uuid;
            crate::journal::update(id, &a.state, Some(c), None, None)?;
            Some(candidates.into_iter().next().unwrap())
        } else {
            None
        };
        if let Some(remote) = remote {
            let mapped = remote_state(&remote.state);
            crate::journal::update(
                id,
                mapped,
                Some(&remote.uuid),
                if mapped == "unknown" {
                    Some("UNMAPPED_RELUTION_ACTION")
                } else {
                    None
                },
                None,
            )?;
            if mapped == "verifying" && self.target_installed(t, &a).await? {
                crate::journal::update(id, "succeeded", Some(&remote.uuid), None, None)?;
            }
        } else if a.created_at + 300 < epoch() {
            crate::journal::update(
                id,
                "unknown",
                None,
                Some(if a.correlation.is_some() {
                    "RELUTION_ACTION_NOT_FOUND"
                } else {
                    "AMBIGUOUS_RELUTION_ACTION"
                }),
                Some("The submission status could not be confirmed. Do not retry."),
            )?;
        }
        a = crate::journal::action(id)?.unwrap();
        if a.state == "verifying" && a.created_at + 900 < epoch() {
            crate::journal::update(
                id,
                "unknown",
                None,
                Some("INVENTORY_VERIFICATION_TIMEOUT"),
                Some("The installed version could not be confirmed. Do not retry."),
            )?;
            a = crate::journal::action(id)?.unwrap();
        }
        Ok(to_action(a))
    }
    async fn target_installed(&self, t: &str, a: &crate::journal::Action) -> Result<bool, String> {
        let items: Vec<dto::Inventory> = self
            .post_pages(
                &format!(
                    "/api/management/v2/devices/{}/installedApps/baseInfo/query",
                    encode(&a.device_id)
                ),
                t,
                json!({"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        Ok(items
            .iter()
            .any(|x| inventory_matches(x, &a.app_id, &a.version_id, a.package_id.as_deref())))
    }
    pub async fn icon(
        &self,
        t: &str,
        u: &str,
        app: &str,
        generation: u64,
    ) -> Result<Option<String>, String> {
        if let Some(icon) = self.cache_for(generation)?.icons.get(app).cloned() {
            return Ok(icon);
        }
        let _permit = self
            .icon_requests
            .acquire()
            .await
            .map_err(|_| "unknown: icon request limit is unavailable")?;
        if let Some(icon) = self.cache_for(generation)?.icons.get(app).cloned() {
            return Ok(icon);
        }
        let d = self.current_device(t, u).await?;
        if !self
            .list_apps_for(t, u, &d)
            .await?
            .iter()
            .any(|a| a.id == app)
        {
            return Err("server: application is not permitted".into());
        }
        let icon = self.fetch_icon(t, app).await?;
        self.cache_for(generation)?
            .icons
            .insert(app.into(), icon.clone());
        Ok(icon)
    }

    async fn fetch_icon(&self, t: &str, app: &str) -> Result<Option<String>, String> {
        let r = self
            .http
            .get(self.url(&format!(
                "/api/management/v1/content/apps/{}/icon",
                encode(app)
            ))?)
            .header("X-User-Access-Token", t)
            .header("tenantOrganizationUuid", &self.config.organization_uuid)
            .send()
            .await
            .map_err(network)?;
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !r.status().is_success() {
            return Err(status(r.status()));
        }
        if r.content_length().unwrap_or(0) > MAX_ICON_BYTES as u64 {
            return Err("server: icon response is too large".into());
        }
        let ct = r
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|x| x.to_str().ok())
            .and_then(|x| x.split(';').next())
            .filter(|x| matches!(*x, "image/png" | "image/jpeg" | "image/webp"))
            .ok_or("server: unsupported icon type")?
            .to_owned();
        let b = r
            .bytes()
            .await
            .map_err(|_| "server: icon response failed")?;
        if b.len() > MAX_ICON_BYTES {
            return Err("server: icon response is too large".into());
        }
        Ok(Some(format!("data:{ct};base64,{}", STANDARD.encode(b))))
    }

    fn cache_for(
        &self,
        generation: u64,
    ) -> Result<std::sync::MutexGuard<'_, CredentialCache>, String> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "unknown: native cache is unavailable")?;
        if cache.generation != Some(generation) {
            *cache = CredentialCache {
                generation: Some(generation),
                ..CredentialCache::default()
            };
        }
        Ok(cache)
    }
    async fn current_device(&self, t: &str, u: &str) -> Result<CurrentDevice, String> {
        let ev = evidence::collect()?;
        let ds:Vec<dto::Device>=self.post_pages("/api/management/v2/devices/baseInfo/query",t,json!({"filter":{"type":"logOp","operation":"AND","filters":[{"type":"string","fieldName":"userUuid","value":u},{"type":"stringEnum","fieldName":"platform","values":["WINDOWS"]}]},"getItems":true,"getNonpagedCount":true})).await?;
        let valid: Vec<_> = ds
            .into_iter()
            .filter(|x| {
                x.user_uuid == u
                    && x.organization_uuid == self.config.organization_uuid
                    && x.platform == "WINDOWS"
                    && matches!(x.status.as_str(), "COMPLIANT" | "NONCOMPLIANT" | "INACTIVE")
            })
            .collect();
        let d = match_device(&ev, &valid)?;
        Ok(CurrentDevice {
            id: d.uuid.clone(),
            wire: NativeDevice {
                name: d.name.clone(),
                status: d.status.clone(),
                last_seen_at: None,
            },
        })
    }
    async fn device_actions(&self, t: &str, d: &str) -> Result<Vec<dto::DeviceAction>, String> {
        self.get_pages(
            &format!("/api/management/v1/devices/{}/actions", encode(d)),
            t,
            vec![],
        )
        .await
    }
    async fn get_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<Vec<T>, String> {
        let mut out = vec![];
        for n in 0..MAX_PAGES {
            let mut x = q.clone();
            x.extend([("getItems", "true"), ("getNonpagedCount", "true")]);
            let page: dto::Page<T> = self
                .get(
                    p,
                    t,
                    x.into_iter()
                        .chain([
                            ("limit", &PAGE_SIZE.to_string()[..]),
                            ("offset", &(n * PAGE_SIZE).to_string()[..]),
                        ])
                        .collect(),
                )
                .await?;
            let len = page.results.len();
            out.extend(page.results);
            if len < PAGE_SIZE {
                return Ok(out);
            }
        }
        Err("server: Relution pagination exceeded the configured limit".into())
    }
    async fn post_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<Vec<T>, String> {
        let mut out = vec![];
        for n in 0..MAX_PAGES {
            let mut b = b.clone();
            b["limit"] = json!(PAGE_SIZE);
            b["offset"] = json!(n * PAGE_SIZE);
            let page: dto::Page<T> = self.post_once(p, t, b).await?;
            let l = page.results.len();
            out.extend(page.results);
            if l < PAGE_SIZE {
                return Ok(out);
            }
        }
        Err("server: Relution pagination exceeded the configured limit".into())
    }
    async fn get<T: DeserializeOwned>(
        &self,
        p: impl AsRef<str>,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<T, String> {
        self.request(Method::GET, p.as_ref(), t, None, q).await
    }
    async fn post_once<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<T, String> {
        self.request(Method::POST, p, t, Some(b), vec![]).await
    }
    async fn request<T: DeserializeOwned>(
        &self,
        m: Method,
        p: &str,
        t: &str,
        b: Option<serde_json::Value>,
        q: Vec<(&str, &str)>,
    ) -> Result<T, String> {
        let read = m == Method::GET;
        for attempt in 0..if read { 3 } else { 1 } {
            let mut url = self.url(p)?;
            {
                let mut pairs = url.query_pairs_mut();
                for (k, v) in &q {
                    pairs.append_pair(k, v);
                }
                pairs.append_pair("tenantOrganizationUuid", &self.config.organization_uuid);
            }
            let mut r = self
                .http
                .request(m.clone(), url)
                .header("X-User-Access-Token", t)
                .header(header::ACCEPT, "application/json")
                .header("tenantOrganizationUuid", &self.config.organization_uuid);
            if let Some(x) = b.clone() {
                r = r.json(&x)
            }
            match r.send().await {
                Ok(resp) if resp.status().is_success() => {
                    if resp.content_length().unwrap_or(0) > MAX_JSON_BYTES as u64 {
                        return Err("server: response is too large".into());
                    }
                    let bytes = resp
                        .bytes()
                        .await
                        .map_err(|_| "server: response could not be read")?;
                    if bytes.len() > MAX_JSON_BYTES {
                        return Err("server: response is too large".into());
                    }
                    return serde_json::from_slice(&bytes)
                        .map_err(|_| "server: invalid Relution response".into());
                }
                Ok(resp)
                    if read
                        && attempt < 2
                        && matches!(resp.status().as_u16(), 429 | 502 | 503 | 504) =>
                {
                    tokio::time::sleep(Duration::from_millis(150 * (1 << attempt))).await
                }
                Ok(resp) => return Err(status(resp.status())),
                Err(e) if read && attempt < 2 => {
                    let _ = e;
                    tokio::time::sleep(Duration::from_millis(150 * (1 << attempt))).await
                }
                Err(e) => return Err(network(e)),
            }
        }
        Err("offline: Relution is unreachable".into())
    }
    fn url(&self, p: &str) -> Result<Url, String> {
        if !p.starts_with("/api/") {
            return Err("server: invalid Relution API path".into());
        }
        let u = self
            .config
            .base
            .join(p)
            .map_err(|_| "server: invalid Relution API path")?;
        if u.origin() != self.config.base.origin() {
            return Err("server: Relution origin changed".into());
        }
        Ok(u)
    }
}
fn app_from(c: dto::Catalog, native: &str) -> Option<AvailableApp> {
    if c.uuid == native || !c.platforms.iter().any(|p| p == "WINDOWS") {
        return None;
    }
    let source = match c.subtype.as_str() {
        "WINGET" => crate::wire::AppSource::Winget,
        "WINDOWS_MSI" => crate::wire::AppSource::WindowsMsi,
        "WINDOWS_EXE" => crate::wire::AppSource::WindowsExe,
        _ => return None,
    };
    let r = c.versions.release?;
    Some(AvailableApp {
        id: c.uuid,
        name: c.name.or(c.default_name)?,
        description: c.description,
        publisher: c.developer.and_then(|d| d.name.or(d.company_name)),
        source,
        package_identifier: c.internal_name,
        released_version_id: r.uuid,
        released_version_label: r.version_name,
        installed_version_id: None,
        installed_version_label: None,
        install_state: crate::wire::AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: c.icon.is_some(),
    })
}
fn match_device(
    e: &evidence::NativeDeviceEvidenceV1,
    items: &[dto::Device],
) -> Result<dto::Device, String> {
    let sig = e.ent_dmid.as_deref().or(e.smbios_uuid.as_deref());
    let m: Vec<_> = items
        .iter()
        .filter(|d| {
            sig.map(|s| d.device_id.as_deref() == Some(s))
                .unwrap_or(false)
                || e.bios_serial
                    .as_deref()
                    .map(|s| {
                        d.serial_number.as_deref() == Some(s)
                            && d.name.eq_ignore_ascii_case(&e.hostname)
                    })
                    .unwrap_or(false)
        })
        .collect();
    if m.len() != 1 {
        Err("device_match_failed: device evidence did not identify exactly one assigned Windows device".into())
    } else {
        Ok((*m[0]).clone())
    }
}
impl Clone for dto::Device {
    fn clone(&self) -> Self {
        Self {
            uuid: self.uuid.clone(),
            device_id: self.device_id.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            platform: self.platform.clone(),
            user_uuid: self.user_uuid.clone(),
            organization_uuid: self.organization_uuid.clone(),
            serial_number: self.serial_number.clone(),
        }
    }
}
fn to_action(a: crate::journal::Action) -> AppAction {
    let state = match a.state.as_str() {
        "queued" | "reserved" => crate::wire::ActionState::Queued,
        "sent" => crate::wire::ActionState::Sent,
        "deferred" => crate::wire::ActionState::Deferred,
        "verifying" => crate::wire::ActionState::Verifying,
        "succeeded" => crate::wire::ActionState::Succeeded,
        "failed" => crate::wire::ActionState::Failed,
        "cancelled" => crate::wire::ActionState::Cancelled,
        _ => crate::wire::ActionState::Unknown,
    };
    AppAction {
        id: a.id,
        device_id: a.device_id,
        app_id: a.app_id,
        intent: if a.intent == "update" {
            crate::wire::ActionIntent::Update
        } else {
            crate::wire::ActionIntent::Install
        },
        state,
        error_code: a.error_code,
        error_message: a.error_message,
        created_at: stamp(a.created_at),
        updated_at: stamp(a.updated_at),
    }
}
fn stamp(s: i64) -> String {
    format!("{s}")
}
fn fixed_https(u: &Url) -> bool {
    u.scheme() == "https"
        && u.host_str().is_some()
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none()
        && u.fragment().is_none()
        && u.path() == "/"
}
fn valid_id(v: &str) -> bool {
    let bytes = v.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
        && v.chars()
            .any(|character| character != '0' && character != '-')
}
fn encode(v: &str) -> String {
    url::form_urlencoded::byte_serialize(v.as_bytes()).collect()
}
fn network(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "offline: Relution is unreachable".into()
    } else {
        "server: Relution request failed".into()
    }
}
fn status(s: reqwest::StatusCode) -> String {
    match s.as_u16() {
        401 => "session-expired: authorization required".into(),
        403 => "device_match_failed: device not assigned".into(),
        _ => "server: Relution request rejected".into(),
    }
}
fn uuid_key() -> String {
    format!("{:x}", rand::rng().random::<u128>())
}
fn epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn remote_state(value: &str) -> &'static str {
    match value {
        "NEW" | "PENDING" | "PUSH_SENT" => "queued",
        "DELIVERED_CANCELABLE" | "DELIVERED" | "DELIVERY_CONFIRMED" => "sent",
        "NOT_NOW" => "deferred",
        "EXECUTED" => "verifying",
        "ERROR" => "failed",
        "CANCELLED" => "cancelled",
        _ => "unknown",
    }
}
fn inventory_matches(
    item: &dto::Inventory,
    app: &str,
    version: &str,
    package: Option<&str>,
) -> bool {
    item.app_uuid.as_deref() == Some(app)
        && item.version_uuid.as_deref() == Some(version)
        && (package.is_none() || item.identifier.as_deref() == package)
}
fn correlation_candidates(
    actions: Vec<dto::DeviceAction>,
    baseline: &std::collections::HashSet<&str>,
    action: &crate::journal::Action,
) -> Vec<dto::DeviceAction> {
    actions
        .into_iter()
        .filter(|candidate| {
            !baseline.contains(candidate.uuid.as_str())
                && candidate.creation_date >= action.created_at - 5
                && candidate
                    .details
                    .as_ref()
                    .map(|details| {
                        details.app_uuid.as_deref() == Some(&action.app_id)
                            || details.version_uuid.as_deref() == Some(&action.version_id)
                            || details.package.as_deref() == action.package_id.as_deref()
                    })
                    .unwrap_or(false)
        })
        .collect()
}
#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
