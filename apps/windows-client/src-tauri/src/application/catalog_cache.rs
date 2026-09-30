//! Monotonic, generation-fenced catalog and icon caches.

use crate::domain::catalog::{AvailableApp, DeviceSummary};
use crate::error::Error;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub(super) const CATALOG_TTL: Duration = Duration::from_secs(60);
const MAX_ICON_ENTRIES: usize = 256;
const MAX_ICON_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct AuthorizedCatalog {
    pub(super) device: DeviceSummary,
    pub(super) assigned_eligible_count: u32,
    pub(super) rows: Vec<AvailableApp>,
    pub(super) revision: String,
}

#[derive(Clone)]
struct CachedCatalog {
    value: AuthorizedCatalog,
    authorized_ids: HashSet<String>,
    loaded_at: Instant,
}

struct RefreshAttempt {
    marker: u64,
    error: Option<Error>,
}

struct CachedIcon {
    revision: String,
    app_id: String,
    value: Option<String>,
    bytes: usize,
}

#[derive(Default)]
struct CredentialCache {
    generation: Option<u64>,
    invalidation: u64,
    next_marker: u64,
    catalogs: HashMap<String, CachedCatalog>,
    attempts: HashMap<String, RefreshAttempt>,
    icons: VecDeque<CachedIcon>,
    icon_bytes: usize,
}

#[derive(Clone)]
pub(super) struct RefreshContext {
    generation: u64,
    locale: String,
    invalidation: u64,
    marker: u64,
}

#[derive(Clone)]
pub(super) struct IconAuthorization {
    pub(super) revision: String,
}

/// Entries belong to one credential generation. Cache age uses `Instant`, so
/// wall-clock changes cannot extend authorization lifetime.
#[derive(Default)]
pub(super) struct CatalogCache {
    state: Mutex<CredentialCache>,
}

impl CatalogCache {
    pub(super) fn context(&self, generation: u64, locale: &str) -> Result<RefreshContext, Error> {
        let cache = &mut *self.for_generation(generation)?;
        let locale = normalize_locale(locale);
        Ok(RefreshContext {
            generation,
            marker: cache
                .attempts
                .get(&locale)
                .map_or(0, |attempt| attempt.marker),
            locale,
            invalidation: cache.invalidation,
        })
    }

    pub(super) fn catalog(
        &self,
        generation: u64,
        locale: &str,
        ttl: Duration,
    ) -> Result<Option<AuthorizedCatalog>, Error> {
        let cache = &mut *self.for_generation(generation)?;
        Ok(cache
            .catalogs
            .get(&normalize_locale(locale))
            .filter(|catalog| catalog.loaded_at.elapsed() < ttl)
            .map(|catalog| catalog.value.clone()))
    }

    pub(super) fn refreshed_since(
        &self,
        context: &RefreshContext,
        ttl: Duration,
    ) -> Result<Option<AuthorizedCatalog>, Error> {
        let cache = &mut *self.for_refresh(context)?;
        let Some(attempt) = cache.attempts.get(&context.locale) else {
            return Ok(None);
        };
        if attempt.marker == context.marker {
            return Ok(None);
        }
        if let Some(error) = &attempt.error {
            return Err(error.clone());
        }
        Ok(cache
            .catalogs
            .get(&context.locale)
            .filter(|catalog| catalog.loaded_at.elapsed() < ttl)
            .map(|catalog| catalog.value.clone()))
    }

    pub(super) fn store_catalog(
        &self,
        context: &RefreshContext,
        catalog: AuthorizedCatalog,
    ) -> Result<(), Error> {
        let cache = &mut *self.for_refresh(context)?;
        record_attempt(cache, context, None);
        let authorized_ids = catalog
            .rows
            .iter()
            .map(|app| app.id.to_ascii_lowercase())
            .collect();
        cache.icons.clear();
        cache.icon_bytes = 0;
        cache.catalogs.insert(
            context.locale.clone(),
            CachedCatalog {
                value: catalog,
                authorized_ids,
                loaded_at: Instant::now(),
            },
        );
        Ok(())
    }

    pub(super) fn validate_revision(
        &self,
        generation: u64,
        locale: &str,
        revision: &str,
    ) -> Result<(), Error> {
        let cache = self.for_generation(generation)?;
        if cache
            .catalogs
            .get(&normalize_locale(locale))
            .is_some_and(|catalog| catalog.value.revision == revision)
        {
            Ok(())
        } else {
            Err(Error::server("catalog revision is no longer current"))
        }
    }

    pub(super) fn record_failure(
        &self,
        context: &RefreshContext,
        error: Error,
    ) -> Result<(), Error> {
        let cache = &mut *self.for_refresh(context)?;
        record_attempt(cache, context, Some(error));
        cache.catalogs.remove(&context.locale);
        cache.icons.clear();
        cache.icon_bytes = 0;
        Ok(())
    }

    pub(super) fn authorize_icon(
        &self,
        generation: u64,
        locale: &str,
        revision: Option<&str>,
        app_id: &str,
        ttl: Duration,
    ) -> Result<Option<IconAuthorization>, Error> {
        let cache = &mut *self.for_generation(generation)?;
        let Some(catalog) = cache.catalogs.get(&normalize_locale(locale)) else {
            return Ok(None);
        };
        if catalog.loaded_at.elapsed() >= ttl {
            return Ok(None);
        }
        if revision.is_some_and(|revision| revision != catalog.value.revision) {
            return Err(Error::server("catalog revision is no longer current"));
        }
        if !catalog
            .authorized_ids
            .contains(&app_id.to_ascii_lowercase())
        {
            return Err(Error::server("application is not permitted"));
        }
        Ok(Some(IconAuthorization {
            revision: catalog.value.revision.clone(),
        }))
    }

    pub(super) fn icon(
        &self,
        generation: u64,
        revision: &str,
        app_id: &str,
    ) -> Result<Option<Option<String>>, Error> {
        let cache = &mut *self.for_generation(generation)?;
        let Some(index) = cache
            .icons
            .iter()
            .position(|icon| icon.revision == revision && icon.app_id == app_id)
        else {
            return Ok(None);
        };
        let icon = cache.icons.remove(index).expect("located icon");
        let value = icon.value.clone();
        cache.icons.push_back(icon);
        Ok(Some(value))
    }

    pub(super) fn store_icon(
        &self,
        generation: u64,
        revision: &str,
        app_id: &str,
        value: Option<String>,
    ) -> Result<(), Error> {
        let cache = &mut *self.for_generation(generation)?;
        if !cache.catalogs.values().any(|catalog| {
            catalog.value.revision == revision
                && catalog
                    .authorized_ids
                    .contains(&app_id.to_ascii_lowercase())
        }) {
            return Err(Error::server("catalog revision is no longer current"));
        }

        if let Some(index) = cache
            .icons
            .iter()
            .position(|icon| icon.revision == revision && icon.app_id == app_id)
        {
            let previous = cache.icons.remove(index).expect("located icon");
            cache.icon_bytes = cache.icon_bytes.saturating_sub(previous.bytes);
        }
        let bytes = value.as_ref().map_or(0, String::len);
        if bytes > MAX_ICON_BYTES {
            return Ok(());
        }
        cache.icons.push_back(CachedIcon {
            revision: revision.into(),
            app_id: app_id.into(),
            value,
            bytes,
        });
        cache.icon_bytes += bytes;
        while cache.icons.len() > MAX_ICON_ENTRIES || cache.icon_bytes > MAX_ICON_BYTES {
            if let Some(icon) = cache.icons.pop_front() {
                cache.icon_bytes = cache.icon_bytes.saturating_sub(icon.bytes);
            }
        }
        Ok(())
    }

    pub(super) fn invalidate_apps(&self, generation: u64) -> Result<(), Error> {
        let cache = &mut *self.state()?;
        if cache.generation == Some(generation) {
            invalidate(cache);
        }
        Ok(())
    }

    pub(super) fn invalidate_session(&self, generation: u64) -> Result<(), Error> {
        let cache = &mut *self.state()?;
        if cache.generation.is_some_and(|cached| generation < cached) {
            return Err(Error::session_expired("stale cache generation"));
        }
        cache.generation = Some(generation);
        invalidate(cache);
        Ok(())
    }

    fn for_refresh(
        &self,
        context: &RefreshContext,
    ) -> Result<MutexGuard<'_, CredentialCache>, Error> {
        let cache = self.for_generation(context.generation)?;
        if cache.invalidation != context.invalidation {
            return Err(Error::session_expired("catalog refresh was invalidated"));
        }
        Ok(cache)
    }

    fn for_generation(&self, generation: u64) -> Result<MutexGuard<'_, CredentialCache>, Error> {
        let mut cache = self.state()?;
        if cache.generation.is_some_and(|cached| generation < cached) {
            return Err(Error::session_expired("stale cache generation"));
        }
        if cache.generation != Some(generation) {
            cache.generation = Some(generation);
            invalidate(&mut cache);
        }
        Ok(cache)
    }

    fn state(&self) -> Result<MutexGuard<'_, CredentialCache>, Error> {
        self.state
            .lock()
            .map_err(|_| Error::unknown("native cache is unavailable"))
    }
}

fn record_attempt(cache: &mut CredentialCache, context: &RefreshContext, error: Option<Error>) {
    cache.next_marker = cache.next_marker.wrapping_add(1).max(1);
    cache.attempts.insert(
        context.locale.clone(),
        RefreshAttempt {
            marker: cache.next_marker,
            error,
        },
    );
}

fn invalidate(cache: &mut CredentialCache) {
    cache.invalidation = cache.invalidation.wrapping_add(1);
    cache.catalogs.clear();
    cache.attempts.clear();
    cache.icons.clear();
    cache.icon_bytes = 0;
}

fn normalize_locale(locale: &str) -> String {
    locale.trim().to_ascii_lowercase()
}

#[cfg(test)]
#[path = "catalog_cache_tests.rs"]
mod tests;
