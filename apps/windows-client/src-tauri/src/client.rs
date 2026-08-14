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
use std::{
    collections::HashMap,
    future::{poll_fn, Future},
    sync::Mutex as StdMutex,
    task::Poll,
    time::Duration,
};
#[cfg(test)]
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};
use tokio::sync::{watch, Mutex as AsyncMutex, Semaphore};
use url::Url;
const MAX_JSON_BYTES: usize = 10 * 1024 * 1024;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;
const MAX_CONCURRENT_CATALOG_AUTHORIZATIONS: usize = 4;
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
        let writes_enabled = match option_env!("APPPORT_RELUTION_WRITES_ENABLED") {
            Some("true") => true,
            Some("false") => false,
            _ => return Err("configuration: invalid embedded write flag".into()),
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

    pub(crate) fn native_app_uuid(&self) -> &str {
        &self.config.native_app_uuid
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
        let mut apps = self.cached_apps(t, u, &d, generation).await?;
        attach_active_actions(&mut apps, crate::journal::active_actions(&d.id)?);
        Ok(filter_catalog_view(apps, view))
    }

    pub async fn current_device_id(&self, token: &str, user_uuid: &str) -> Result<String, String> {
        Ok(self.current_device(token, user_uuid).await?.id)
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

    pub(super) async fn invalidate_cached_apps(&self, generation: u64) -> Result<(), String> {
        let _refresh = self.catalog_refresh.lock().await;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "unknown: native cache is unavailable")?;
        if cache.generation == Some(generation) {
            cache.apps = None;
        }
        Ok(())
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
        let context = CatalogContext {
            token: t,
            user: u,
            groups: &group_ids,
            inventory: &inventory,
            group_memberships: AsyncMutex::new(HashMap::new()),
        };
        let mut out = Vec::new();
        let mut entries = catalog.into_iter();
        loop {
            let batch = std::array::from_fn(|_| entries.next());
            if batch.iter().all(Option::is_none) {
                break;
            }
            out.extend(
                self.allowed_app_batch(batch, &context)
                    .await?
                    .into_iter()
                    .flatten(),
            );
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
    }
    async fn allowed_app_batch(
        &self,
        entries: [Option<dto::Catalog>; MAX_CONCURRENT_CATALOG_AUTHORIZATIONS],
        context: &CatalogContext<'_>,
    ) -> Result<[Option<AvailableApp>; MAX_CONCURRENT_CATALOG_AUTHORIZATIONS], String> {
        let mut futures = entries.map(|entry| Box::pin(self.allowed_catalog_entry(entry, context)));
        let mut results = std::array::from_fn(|_| None);
        let results = poll_fn(|task| {
            let mut pending = false;
            for (future, result) in futures.iter_mut().zip(results.iter_mut()) {
                if result.is_none() {
                    match future.as_mut().poll(task) {
                        Poll::Ready(value) => *result = Some(value),
                        Poll::Pending => pending = true,
                    }
                }
            }
            if pending {
                Poll::Pending
            } else {
                Poll::Ready(std::mem::take(&mut results))
            }
        })
        .await;
        let [first, second, third, fourth] = results;
        Ok([
            first.expect("authorization future completed")?,
            second.expect("authorization future completed")?,
            third.expect("authorization future completed")?,
            fourth.expect("authorization future completed")?,
        ])
    }
    async fn allowed_catalog_entry(
        &self,
        catalog: Option<dto::Catalog>,
        context: &CatalogContext<'_>,
    ) -> Result<Option<AvailableApp>, String> {
        match catalog {
            Some(catalog) => self.allowed_app(catalog, context).await,
            None => Ok(None),
        }
    }
    async fn allowed_app(
        &self,
        catalog: dto::Catalog,
        context: &CatalogContext<'_>,
    ) -> Result<Option<AvailableApp>, String> {
        let Some(mut app) = app_from(catalog, &self.config.native_app_uuid) else {
            return Ok(None);
        };
        if !self.allowed(&app.id, context).await? {
            return Ok(None);
        }
        let app_id = app.id.clone();
        let installed = context
            .inventory
            .iter()
            .find(|item| item.app_uuid.as_deref() == Some(&app_id));
        apply_inventory(&mut app, installed);
        Ok(Some(app))
    }
    async fn allowed(&self, app: &str, context: &CatalogContext<'_>) -> Result<bool, String> {
        let p: dto::Page<dto::Permission> = self
            .get(
                &format!(
                    "/api/management/v1/content/apps/{}/permissions/RELEASE",
                    encode(app)
                ),
                context.token,
                vec![],
            )
            .await?;
        for permission in p.results {
            if self.permission_allows(context, &permission).await? {
                return Ok(true);
            }
        }
        Ok(false)
    }
    async fn permission_allows(
        &self,
        context: &CatalogContext<'_>,
        permission: &dto::Permission,
    ) -> Result<bool, String> {
        if !permission.read {
            return Ok(false);
        }
        if permission.subject.kind == "USER" {
            return Ok(permission.subject.uuid == context.user);
        }
        Ok(permission.subject.kind == "GROUP"
            && (context.groups.contains(&permission.subject.uuid)
                || self
                    .group_contains(context, &permission.subject.uuid)
                    .await?))
    }
    async fn group_contains(
        &self,
        context: &CatalogContext<'_>,
        group: &str,
    ) -> Result<bool, String> {
        let lookup = {
            let mut memberships = context.group_memberships.lock().await;
            match memberships.get(group) {
                Some(GroupMembership::Ready(result)) => return result.clone(),
                Some(GroupMembership::Pending(receiver)) => GroupLookup::Wait(receiver.clone()),
                None => {
                    let (sender, receiver) = watch::channel(None);
                    memberships.insert(group.into(), GroupMembership::Pending(receiver));
                    GroupLookup::Fetch(sender)
                }
            }
        };
        match lookup {
            GroupLookup::Wait(mut receiver) => {
                receiver
                    .changed()
                    .await
                    .map_err(|_| "server: group membership request failed")?;
                receiver
                    .borrow()
                    .clone()
                    .ok_or("server: group membership request failed")?
            }
            GroupLookup::Fetch(sender) => {
                let result = self.fetch_group_membership(context, group).await;
                context
                    .group_memberships
                    .lock()
                    .await
                    .insert(group.into(), GroupMembership::Ready(result.clone()));
                sender.send_replace(Some(result.clone()));
                result
            }
        }
    }
    async fn fetch_group_membership(
        &self,
        context: &CatalogContext<'_>,
        group: &str,
    ) -> Result<bool, String> {
        let members: Vec<dto::Group> = self
            .get_pages(
                &format!(
                    "/api/management/v1/security/groups/{}/members",
                    encode(group)
                ),
                context.token,
                vec![("recursive", "true")],
            )
            .await?;
        Ok(members
            .into_iter()
            .any(|member| member.uuid == context.user))
    }
}

struct CatalogContext<'a> {
    token: &'a str,
    user: &'a str,
    groups: &'a [String],
    inventory: &'a [dto::Inventory],
    group_memberships: AsyncMutex<HashMap<String, GroupMembership>>,
}

enum GroupMembership {
    Pending(watch::Receiver<Option<Result<bool, String>>>),
    Ready(Result<bool, String>),
}

enum GroupLookup {
    Wait(watch::Receiver<Option<Result<bool, String>>>),
    Fetch(watch::Sender<Option<Result<bool, String>>>),
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

#[cfg(test)]
pub(super) struct CatalogMockResponse {
    pub(super) status: u16,
    pub(super) content_type: &'static str,
    pub(super) body: String,
}

#[cfg(test)]
pub(super) fn mock_catalog_server<F>(
    expected_requests: usize,
    handler: F,
) -> (Url, Arc<AtomicUsize>, thread::JoinHandle<()>)
where
    F: Fn(&str) -> CatalogMockResponse + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let request_count = Arc::clone(&requests);
    let handler = Arc::new(handler);
    let server = thread::spawn(move || {
        let mut workers = Vec::with_capacity(expected_requests);
        for _ in 0..expected_requests {
            let (mut stream, _) = listener.accept().unwrap();
            let handler = Arc::clone(&handler);
            let request_count = Arc::clone(&request_count);
            workers.push(thread::spawn(move || {
                let mut request = [0_u8; 16 * 1024];
                let read = stream.read(&mut request).unwrap();
                let response = handler(std::str::from_utf8(&request[..read]).unwrap());
                request_count.fetch_add(1, Ordering::SeqCst);
                write!(
                    stream,
                    "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.content_type,
                    response.body.len(),
                    response.body
                )
                .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
    });
    (
        Url::parse(&format!("http://{address}/")).unwrap(),
        requests,
        server,
    )
}

#[cfg(test)]
pub(super) fn request_path(request: &str) -> &str {
    request
        .split_whitespace()
        .nth(1)
        .unwrap()
        .split('?')
        .next()
        .unwrap()
}

#[path = "client_actions.rs"]
mod actions;
#[path = "client_icons.rs"]
mod icons;
#[path = "client_transport.rs"]
mod transport;

#[cfg(test)]
#[path = "client_action_tests.rs"]
mod action_tests;
#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
