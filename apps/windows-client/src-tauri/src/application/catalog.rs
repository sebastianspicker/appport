//! Catalog application workflow: generation-fenced cache, authorization, and icons.

#[path = "catalog_reads.rs"]
mod reads;
use reads::{join2, join3};

use super::catalog_cache::{AuthorizedCatalog, CatalogCache, CATALOG_TTL};
use crate::{
    domain::{
        action::attach_active_actions,
        catalog::{
            app_from, bootstrap_catalog_summary, classify_catalog_inventory, filter_catalog_view,
            AvailableApp, CatalogBootstrap, CatalogInventoryClassification, CatalogView,
            DeviceSummary,
        },
        device::{match_device, same_uuid},
    },
    error::Error,
    infrastructure::{journal::ActionJournal, relution::RelutionClient, windows::evidence},
};
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

#[path = "catalog_authorization.rs"]
mod authorization;

#[derive(Clone)]
pub struct LoadedCatalog {
    pub bootstrap: CatalogBootstrap,
    pub rows: Vec<AvailableApp>,
    pub revision: String,
}

/// Concrete application service. The cache belongs here, not in the HTTP adapter.
pub struct CatalogService {
    client: Arc<RelutionClient>,
    journal: ActionJournal,
    cache: CatalogCache,
    catalog_refresh: AsyncMutex<()>,
    icon_requests: Semaphore,
    icon_refresh: [AsyncMutex<()>; 16],
    catalog_ttl: Duration,
    #[cfg(test)]
    test_device_evidence: Option<crate::domain::device::DeviceEvidence>,
}

impl CatalogService {
    pub fn new(client: Arc<RelutionClient>) -> Self {
        Self::with_journal(client, ActionJournal::new())
    }

    pub(crate) fn with_journal(client: Arc<RelutionClient>, journal: ActionJournal) -> Self {
        Self {
            client,
            journal,
            cache: CatalogCache::default(),
            catalog_refresh: AsyncMutex::new(()),
            icon_requests: Semaphore::new(4),
            icon_refresh: std::array::from_fn(|_| AsyncMutex::new(())),
            catalog_ttl: CATALOG_TTL,
            #[cfg(test)]
            test_device_evidence: None,
        }
    }

    pub(crate) fn journal(&self) -> ActionJournal {
        self.journal.clone()
    }

    #[cfg(test)]
    pub(crate) fn using_journal(mut self, journal: ActionJournal) -> Self {
        self.journal = journal;
        self
    }

    #[cfg(test)]
    fn with_cache_ttl(mut self, ttl: Duration) -> Self {
        self.catalog_ttl = ttl;
        self
    }

    pub async fn load_catalog(
        &self,
        token: &str,
        username: &str,
        user_uuid: &str,
        generation: u64,
        locale: &str,
        force_refresh: bool,
    ) -> Result<LoadedCatalog, Error> {
        let catalog = self
            .authorized_snapshot(token, user_uuid, generation, locale, force_refresh)
            .await?;
        let mut rows = catalog.rows;
        attach_active_actions(
            &mut rows,
            self.journal.active_actions(&catalog.device.id).await?,
        );
        self.cache
            .validate_revision(generation, locale, &catalog.revision)?;
        let (available_count, update_keys) = bootstrap_catalog_summary(&rows);
        Ok(LoadedCatalog {
            bootstrap: CatalogBootstrap {
                username: username.into(),
                device: catalog.device,
                assigned_eligible_count: catalog.assigned_eligible_count,
                available_count,
                update_keys,
                writes_enabled: self.client.writes_enabled(),
            },
            rows,
            revision: catalog.revision,
        })
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
    ) -> Result<CatalogBootstrap, Error> {
        Ok(self
            .load_catalog(token, username, user_uuid, generation, locale, false)
            .await?
            .bootstrap)
    }

    pub async fn list_apps(
        &self,
        token: &str,
        user_uuid: &str,
        generation: u64,
        view: CatalogView,
        locale: &str,
    ) -> Result<Vec<AvailableApp>, Error> {
        let loaded = self
            .load_catalog(token, "", user_uuid, generation, locale, false)
            .await?;
        Ok(filter_catalog_view(loaded.rows, view))
    }

    pub async fn icon(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        generation: u64,
        locale: &str,
    ) -> Result<Option<String>, Error> {
        self.icon_for_revision(token, user_uuid, app_id, generation, locale, None)
            .await
    }

    pub async fn icon_for_revision(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        generation: u64,
        locale: &str,
        catalog_revision: Option<&str>,
    ) -> Result<Option<String>, Error> {
        let authorization = self
            .icon_authorization(
                token,
                user_uuid,
                app_id,
                generation,
                locale,
                catalog_revision,
            )
            .await?;
        if let Some(icon) = self
            .cache
            .icon(generation, &authorization.revision, app_id)?
        {
            return Ok(icon);
        }
        let _permit = self
            .icon_requests
            .acquire()
            .await
            .map_err(|_| Error::unknown("icon request limit is unavailable"))?;
        let stripe = icon_stripe(&authorization.revision, app_id);
        let _refresh = self.icon_refresh[stripe].lock().await;
        if let Some(icon) = self
            .cache
            .icon(generation, &authorization.revision, app_id)?
        {
            return Ok(icon);
        }
        let icon = self.client.fetch_icon(token, app_id).await?;
        let current = self.cache.authorize_icon(
            generation,
            locale,
            Some(&authorization.revision),
            app_id,
            self.catalog_ttl,
        )?;
        if current.is_none() {
            return Err(Error::session_expired("icon authorization was invalidated"));
        }
        self.cache
            .store_icon(generation, &authorization.revision, app_id, icon.clone())?;
        Ok(icon)
    }

    async fn icon_authorization(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        generation: u64,
        locale: &str,
        revision: Option<&str>,
    ) -> Result<super::catalog_cache::IconAuthorization, Error> {
        if let Some(authorization) =
            self.cache
                .authorize_icon(generation, locale, revision, app_id, self.catalog_ttl)?
        {
            return Ok(authorization);
        }
        let catalog = self
            .authorized_snapshot(token, user_uuid, generation, locale, false)
            .await?;
        if revision.is_some_and(|revision| revision != catalog.revision) {
            return Err(Error::server("catalog revision is no longer current"));
        }
        self.cache
            .authorize_icon(generation, locale, revision, app_id, self.catalog_ttl)?
            .ok_or_else(|| Error::session_expired("icon authorization was invalidated"))
    }

    pub(crate) async fn current_device_uncached(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<DeviceSummary, Error> {
        self.resolve_current_device(token, user_uuid).await
    }
    pub(crate) async fn action_target(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        locale: &str,
    ) -> Result<(DeviceSummary, AvailableApp), Error> {
        let (device, entries, groups) = join3(
            self.resolve_current_device(token, user_uuid),
            self.client.catalog(token, locale),
            self.client.user_groups(token, user_uuid),
        )
        .await;
        let device = device?;
        let app = entries?
            .into_iter()
            .find(|entry| same_uuid(&entry.id, app_id))
            .and_then(|entry| app_from(entry, self.client.native_app_uuid()))
            .ok_or_else(|| Error::server("application is not permitted"))?;
        let group_ids = groups?;
        let (allowed, inventory) = join2(
            authorization::allowed(&self.client, token, user_uuid, &group_ids, &app.id),
            self.client.installed_apps(token, &device.id),
        )
        .await;
        if !allowed? {
            return Err(Error::server("application is not permitted"));
        }
        let inventory = inventory?;
        let installed = inventory.iter().find(|item| {
            item.app_id
                .as_deref()
                .is_some_and(|id| same_uuid(id, &app.id))
        });
        match classify_catalog_inventory(app, installed)? {
            CatalogInventoryClassification::Visible(app) => Ok((device, *app)),
            CatalogInventoryClassification::InstalledCurrent => Err(Error::server(
                "application is already current or update is not approved",
            )),
        }
    }

    pub fn invalidate_session(&self, generation: u64) -> Result<(), Error> {
        self.cache.invalidate_session(generation)
    }

    pub(crate) async fn invalidate_apps(&self, generation: u64) -> Result<(), Error> {
        self.cache.invalidate_apps(generation)
    }

    async fn authorized_snapshot(
        &self,
        token: &str,
        user_uuid: &str,
        generation: u64,
        locale: &str,
        force_refresh: bool,
    ) -> Result<AuthorizedCatalog, Error> {
        let context = self.cache.context(generation, locale)?;
        if !force_refresh {
            if let Some(catalog) = self.cache.catalog(generation, locale, self.catalog_ttl)? {
                return Ok(catalog);
            }
        }
        let _refresh = self.catalog_refresh.lock().await;
        if let Some(catalog) = self.cache.refreshed_since(&context, self.catalog_ttl)? {
            return Ok(catalog);
        }
        if !force_refresh {
            if let Some(catalog) = self.cache.catalog(generation, locale, self.catalog_ttl)? {
                return Ok(catalog);
            }
        }
        let catalog = match self.refresh_catalog(token, user_uuid, locale).await {
            Ok(catalog) => catalog,
            Err(error) => {
                self.cache.record_failure(&context, error.clone())?;
                return Err(error);
            }
        };
        self.cache.store_catalog(&context, catalog.clone())?;
        Ok(catalog)
    }

    async fn resolve_current_device(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<DeviceSummary, Error> {
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
            .collect::<Vec<_>>();
        let device = match_device(&evidence, &devices)?;
        Ok(DeviceSummary {
            id: device.uuid,
            name: device.name,
            status: device.status,
        })
    }
    #[cfg(test)]
    async fn authorized_catalog(
        &self,
        token: &str,
        user_uuid: &str,
        device: &DeviceSummary,
        locale: &str,
    ) -> Result<AuthorizedCatalog, Error> {
        let (entries, groups) = join2(
            self.client.catalog(token, locale),
            self.client.user_groups(token, user_uuid),
        )
        .await;
        authorization::authorize_catalog_inputs(
            &self.client,
            token,
            user_uuid,
            device.clone(),
            locale,
            entries?,
            groups?,
        )
        .await
    }

    async fn refresh_catalog(
        &self,
        token: &str,
        user_uuid: &str,
        locale: &str,
    ) -> Result<AuthorizedCatalog, Error> {
        let (device, entries, groups) = join3(
            self.resolve_current_device(token, user_uuid),
            self.client.catalog(token, locale),
            self.client.user_groups(token, user_uuid),
        )
        .await;
        authorization::authorize_catalog_inputs(
            &self.client,
            token,
            user_uuid,
            device?,
            locale,
            entries?,
            groups?,
        )
        .await
    }
}

fn icon_stripe(revision: &str, app_id: &str) -> usize {
    let mut hasher = DefaultHasher::new();
    revision.hash(&mut hasher);
    app_id.hash(&mut hasher);
    hasher.finish() as usize % 16
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod catalog_tests;
