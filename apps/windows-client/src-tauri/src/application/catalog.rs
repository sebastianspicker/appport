//! Catalog application workflow: generation-fenced cache, authorization, and icons.

use crate::{
    domain::{
        action::attach_active_actions,
        catalog::{
            app_from, bootstrap_catalog_summary, classify_catalog_inventory, filter_catalog_view,
            AvailableApp, CatalogBootstrap, CatalogEntry, CatalogInventoryClassification,
            CatalogView, DeviceSummary, InstalledApp,
        },
        device::{match_device, same_uuid},
    },
    infrastructure::{
        journal,
        relution::{dto, RelutionClient},
        windows::evidence,
    },
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex as StdMutex},
};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

#[derive(Default)]
struct CredentialCache {
    generation: Option<u64>,
    device: Option<DeviceSummary>,
    catalog: Option<AuthorizedCatalog>,
    // Kept as the icon authorization projection for the credential generation.
    apps: Option<Vec<AvailableApp>>,
    icons: HashMap<String, Option<String>>,
}
#[derive(Clone)]
struct AuthorizedCatalog {
    assigned_eligible_count: u32,
    rows: Vec<AvailableApp>,
}

/// Concrete application service. The cache belongs here, not in the HTTP adapter.
pub struct CatalogService {
    client: Arc<RelutionClient>,
    cache: StdMutex<CredentialCache>,
    device_refresh: AsyncMutex<()>,
    catalog_refresh: AsyncMutex<()>,
    icon_requests: Semaphore,
    #[cfg(test)]
    test_device_evidence: Option<crate::domain::device::DeviceEvidence>,
}

impl CatalogService {
    pub fn new(client: Arc<RelutionClient>) -> Self {
        Self {
            client,
            cache: StdMutex::new(CredentialCache::default()),
            device_refresh: AsyncMutex::new(()),
            catalog_refresh: AsyncMutex::new(()),
            icon_requests: Semaphore::new(4),
            #[cfg(test)]
            test_device_evidence: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_device_evidence(
        client: Arc<RelutionClient>,
        evidence: crate::domain::device::DeviceEvidence,
    ) -> Self {
        let mut service = Self::new(client);
        service.test_device_evidence = Some(evidence);
        service
    }

    pub async fn bootstrap(
        &self,
        token: &str,
        username: &str,
        user_uuid: &str,
        generation: u64,
        locale: &str,
    ) -> Result<CatalogBootstrap, String> {
        let device = self
            .cached_current_device(token, user_uuid, generation)
            .await?;
        let catalog = self
            .cached_authorized_catalog(token, user_uuid, &device, generation, locale)
            .await?;
        let (available_count, update_keys) = bootstrap_catalog_summary(&catalog.rows);
        Ok(CatalogBootstrap {
            username: username.into(),
            device,
            assigned_eligible_count: catalog.assigned_eligible_count,
            available_count,
            update_keys,
            writes_enabled: self.client.writes_enabled(),
        })
    }

    pub async fn list_apps(
        &self,
        token: &str,
        user_uuid: &str,
        generation: u64,
        view: CatalogView,
        locale: &str,
    ) -> Result<Vec<AvailableApp>, String> {
        let device = self
            .cached_current_device(token, user_uuid, generation)
            .await?;
        let mut apps = self
            .cached_authorized_catalog(token, user_uuid, &device, generation, locale)
            .await?
            .rows;
        attach_active_actions(&mut apps, journal::active_actions(&device.id)?);
        Ok(filter_catalog_view(apps, view))
    }

    pub async fn icon(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        generation: u64,
        locale: &str,
    ) -> Result<Option<String>, String> {
        if let Some(icon) = self.cached_icon(generation, app_id)? {
            return Ok(icon);
        }
        let _permit = self
            .icon_requests
            .acquire()
            .await
            .map_err(|_| "unknown: icon request limit is unavailable")?;
        if let Some(icon) = self.cached_icon(generation, app_id)? {
            return Ok(icon);
        }
        let cached_apps = { self.cache_for(generation)?.apps.clone() };
        let apps = match cached_apps {
            Some(apps) => apps,
            None => {
                let device = self
                    .cached_current_device(token, user_uuid, generation)
                    .await?;
                self.cached_authorized_catalog(token, user_uuid, &device, generation, locale)
                    .await?
                    .rows
            }
        };
        if !apps.iter().any(|app| app.id == app_id) {
            return Err("server: application is not permitted".into());
        }
        let icon = self.client.fetch_icon(token, app_id).await?;
        self.cache_for(generation)?
            .icons
            .insert(app_id.into(), icon.clone());
        Ok(icon)
    }

    pub(crate) async fn current_device_uncached(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<DeviceSummary, String> {
        self.resolve_current_device(token, user_uuid).await
    }
    pub(crate) async fn authorized_app_uncached(
        &self,
        token: &str,
        user_uuid: &str,
        device: &DeviceSummary,
        app_id: &str,
        locale: &str,
    ) -> Result<AvailableApp, String> {
        self.authorized_catalog(token, user_uuid, device, locale)
            .await?
            .rows
            .into_iter()
            .find(|app| app.id == app_id)
            .ok_or("server: application is not permitted".into())
    }
    pub(crate) async fn invalidate_apps(&self, generation: u64) -> Result<(), String> {
        let _refresh = self.catalog_refresh.lock().await;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "unknown: native cache is unavailable")?;
        if cache.generation == Some(generation) {
            cache.catalog = None;
            cache.apps = None;
        }
        Ok(())
    }

    async fn cached_current_device(
        &self,
        token: &str,
        user_uuid: &str,
        generation: u64,
    ) -> Result<DeviceSummary, String> {
        if let Some(device) = self.cache_for(generation)?.device.clone() {
            return Ok(device);
        }
        let _refresh = self.device_refresh.lock().await;
        if let Some(device) = self.cache_for(generation)?.device.clone() {
            return Ok(device);
        }
        let device = self.resolve_current_device(token, user_uuid).await?;
        self.cache_for(generation)?.device = Some(device.clone());
        Ok(device)
    }
    async fn cached_authorized_catalog(
        &self,
        token: &str,
        user_uuid: &str,
        device: &DeviceSummary,
        generation: u64,
        locale: &str,
    ) -> Result<AuthorizedCatalog, String> {
        if let Some(catalog) = self.cache_for(generation)?.catalog.clone() {
            return Ok(catalog);
        }
        let _refresh = self.catalog_refresh.lock().await;
        if let Some(catalog) = self.cache_for(generation)?.catalog.clone() {
            return Ok(catalog);
        }
        let catalog = self
            .authorized_catalog(token, user_uuid, device, locale)
            .await?;
        let cache = &mut *self.cache_for(generation)?;
        cache.apps = Some(catalog.rows.clone());
        cache.catalog = Some(catalog.clone());
        Ok(catalog)
    }
    fn cache_for(
        &self,
        generation: u64,
    ) -> Result<std::sync::MutexGuard<'_, CredentialCache>, String> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "unknown: native cache is unavailable")?;
        if cache.generation.is_some_and(|cached| generation < cached) {
            return Err("session-expired: stale cache generation".into());
        }
        if cache.generation != Some(generation) {
            *cache = CredentialCache {
                generation: Some(generation),
                ..CredentialCache::default()
            };
        }
        Ok(cache)
    }
    fn cached_icon(&self, generation: u64, app_id: &str) -> Result<Option<Option<String>>, String> {
        Ok(self.cache_for(generation)?.icons.get(app_id).cloned())
    }

    async fn resolve_current_device(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<DeviceSummary, String> {
        #[cfg(test)]
        let evidence = match &self.test_device_evidence {
            Some(evidence) => evidence.clone(),
            None => evidence::collect()?,
        };
        #[cfg(not(test))]
        let evidence = evidence::collect()?;
        let devices = self
            .client
            .assigned_devices(token, user_uuid)
            .await?
            .into_iter()
            .filter(|device| {
                same_uuid(&device.user_uuid, user_uuid)
                    && same_uuid(&device.organization_uuid, self.client.organization_uuid())
                    && device.platform.eq_ignore_ascii_case("WINDOWS")
                    && ["COMPLIANT", "NONCOMPLIANT", "INACTIVE"]
                        .iter()
                        .any(|status| device.status.eq_ignore_ascii_case(status))
            })
            .map(dto::Device::into_assigned_device)
            .collect::<Vec<_>>();
        let device = match_device(&evidence, &devices)?;
        Ok(DeviceSummary {
            id: device.uuid,
            name: device.name,
            status: device.status,
        })
    }
    async fn authorized_catalog(
        &self,
        token: &str,
        user_uuid: &str,
        device: &DeviceSummary,
        locale: &str,
    ) -> Result<AuthorizedCatalog, String> {
        let entries = self.client.catalog(token, locale).await?;
        let group_ids = self
            .client
            .user_groups(token, user_uuid)
            .await?
            .groups
            .into_iter()
            .map(|group| group.uuid)
            .collect::<Vec<_>>();
        let inventory = self
            .client
            .installed_apps(token, &device.id)
            .await?
            .iter()
            .map(installed_app)
            .collect::<Vec<_>>();
        let mut rows = Vec::new();
        let mut assigned_eligible_count = 0;
        for entry in entries {
            let Some(app) = app_from(catalog_entry(entry), self.client.native_app_uuid()) else {
                continue;
            };
            if !self.allowed(token, user_uuid, &group_ids, &app.id).await? {
                continue;
            }
            assigned_eligible_count += 1;
            let installed = inventory.iter().find(|item| {
                item.app_id
                    .as_deref()
                    .is_some_and(|id| same_uuid(id, &app.id))
            });
            if let CatalogInventoryClassification::Visible(app) =
                classify_catalog_inventory(app, installed)?
            {
                rows.push(*app);
            }
        }
        rows.sort_by_key(|app| app.name.to_lowercase());
        Ok(AuthorizedCatalog {
            assigned_eligible_count,
            rows,
        })
    }
    async fn allowed(
        &self,
        token: &str,
        user_uuid: &str,
        group_ids: &[String],
        app_id: &str,
    ) -> Result<bool, String> {
        let permissions = self.client.app_permissions(token, app_id).await?;
        for permission in permissions.results {
            if permission.read
                && permission.subject.kind.eq_ignore_ascii_case("USER")
                && same_uuid(&permission.subject.uuid, user_uuid)
            {
                return Ok(true);
            }
            if permission.read && permission.subject.kind.eq_ignore_ascii_case("GROUP") {
                if group_ids
                    .iter()
                    .any(|group| same_uuid(group, &permission.subject.uuid))
                {
                    return Ok(true);
                }
                let members = self
                    .client
                    .group_members(token, &permission.subject.uuid)
                    .await?;
                if members
                    .into_iter()
                    .any(|member| same_uuid(&member.uuid, user_uuid))
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
}

fn catalog_entry(value: dto::Catalog) -> CatalogEntry {
    let release = value.versions.release;
    let developer = value.developer;
    CatalogEntry {
        id: value.uuid,
        name: value.name,
        default_name: value.default_name,
        description: value.description,
        developer_name: developer.as_ref().and_then(|value| value.name.clone()),
        developer_company_name: developer.and_then(|value| value.company_name),
        subtype: value.subtype,
        platforms: value.platforms,
        release_id: release.as_ref().map(|value| value.uuid.clone()),
        release_label: release.and_then(|value| value.version_name),
        has_icon: value.icon.is_some(),
        package_identifier: value.internal_name,
    }
}
pub(crate) fn installed_app(value: &dto::Inventory) -> InstalledApp {
    InstalledApp {
        identifier: value.identifier.clone(),
        app_id: value.app_uuid.clone(),
        version_id: value.version_uuid.clone(),
        version_label: value.version_to_show.clone().or(value.version_name.clone()),
        has_update: value.update,
    }
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod catalog_tests;
