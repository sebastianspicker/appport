use super::{AuthorizedCatalog, CatalogCache};
use crate::domain::catalog::{AppInstallState, AppSource, AvailableApp, DeviceSummary};
use crate::error::Error;
use std::time::{Duration, Instant};

fn app(id: impl Into<String>) -> AvailableApp {
    let id = id.into();
    AvailableApp {
        id: id.clone(),
        name: id.clone(),
        description: None,
        publisher: None,
        source: AppSource::Winget,
        package_identifier: Some(format!("{id}.package")),
        released_version_id: format!("{id}-1"),
        released_version_label: Some("1".into()),
        installed_version_id: None,
        installed_version_label: None,
        install_state: AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: true,
    }
}

fn catalog(revision: &str, rows: Vec<AvailableApp>) -> AuthorizedCatalog {
    AuthorizedCatalog {
        device: DeviceSummary {
            id: "device".into(),
            name: "Device".into(),
            status: "COMPLIANT".into(),
        },
        assigned_eligible_count: rows.len() as u32,
        rows,
        revision: revision.into(),
    }
}

fn store(cache: &CatalogCache, revision: &str, rows: Vec<AvailableApp>) {
    let context = cache.context(7, "en-US").expect("refresh context");
    cache
        .store_catalog(&context, catalog(revision, rows))
        .expect("store catalog");
}

#[test]
fn locale_generation_and_exact_expiry_scope_snapshots() {
    let cache = CatalogCache::default();
    store(&cache, "english", vec![]);
    assert_eq!(
        cache
            .catalog(7, "EN-us", Duration::from_secs(60))
            .expect("cached catalog")
            .expect("English snapshot")
            .revision,
        "english"
    );
    assert!(cache
        .catalog(7, "de-DE", Duration::from_secs(60))
        .expect("German cache")
        .is_none());
    {
        let mut state = cache.state.lock().expect("cache state");
        state
            .catalogs
            .get_mut("en-us")
            .expect("English catalog")
            .loaded_at = Instant::now() - Duration::from_secs(60);
    }
    assert!(cache
        .catalog(7, "en-US", Duration::from_secs(60))
        .expect("exactly expired cache")
        .is_none());
    cache.context(8, "en-US").expect("next generation");
    assert!(matches!(
        cache.catalog(7, "en-US", Duration::from_secs(60)),
        Err(error) if error == Error::session_expired("stale cache generation")
    ));
}

#[test]
fn invalidation_rejects_in_flight_catalog_and_icon_completions() {
    let cache = CatalogCache::default();
    let pending = cache.context(3, "en-US").expect("refresh context");
    cache.invalidate_session(4).expect("session invalidation");
    assert!(matches!(
        cache.store_catalog(&pending, catalog("stale", vec![])),
        Err(error) if error == Error::session_expired("stale cache generation")
    ));

    store(&cache, "current", vec![app("allowed")]);
    cache.invalidate_apps(7).expect("application invalidation");
    assert!(matches!(
        cache.store_icon(7, "current", "allowed", Some("stale".into())),
        Err(error) if error == Error::server("catalog revision is no longer current")
    ));
}

#[test]
fn missing_icons_are_cached() {
    let cache = CatalogCache::default();
    store(&cache, "revision", vec![app("missing")]);
    cache
        .store_icon(7, "revision", "missing", None)
        .expect("store missing icon");
    assert_eq!(
        cache.icon(7, "revision", "missing").expect("cached icon"),
        Some(None)
    );
}

#[test]
fn icon_lru_enforces_entry_limit_and_refreshes_recency() {
    let cache = CatalogCache::default();
    let rows = (0..258).map(|index| app(format!("app-{index}"))).collect();
    store(&cache, "revision", rows);
    for index in 0..256 {
        cache
            .store_icon(7, "revision", &format!("app-{index}"), Some("x".into()))
            .expect("store icon");
    }
    assert_eq!(
        cache.icon(7, "revision", "app-0").expect("touch icon"),
        Some(Some("x".into()))
    );
    for index in 256..258 {
        cache
            .store_icon(7, "revision", &format!("app-{index}"), Some("x".into()))
            .expect("store icon");
    }
    assert!(cache
        .icon(7, "revision", "app-1")
        .expect("oldest icon")
        .is_none());
    assert!(cache
        .icon(7, "revision", "app-0")
        .expect("recent icon")
        .is_some());
    assert_eq!(cache.state.lock().expect("cache state").icons.len(), 256);
}

#[test]
fn icon_lru_enforces_byte_limit() {
    let cache = CatalogCache::default();
    store(&cache, "revision", vec![app("first"), app("second")]);
    let large = "x".repeat(17 * 1024 * 1024);
    cache
        .store_icon(7, "revision", "first", Some(large.clone()))
        .expect("store first icon");
    cache
        .store_icon(7, "revision", "second", Some(large))
        .expect("store second icon");
    assert!(cache
        .icon(7, "revision", "first")
        .expect("first icon")
        .is_none());
    assert!(cache
        .icon(7, "revision", "second")
        .expect("second icon")
        .is_some());
    assert!(cache.state.lock().expect("cache state").icon_bytes <= 32 * 1024 * 1024);
}
