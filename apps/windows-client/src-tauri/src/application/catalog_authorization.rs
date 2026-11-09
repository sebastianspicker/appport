//! Bounded catalog permission and recursive-group evaluation.

use super::{join2, reads::join_all};
use crate::{
    application::catalog_cache::AuthorizedCatalog,
    domain::{
        catalog::{
            app_from, classify_catalog_inventory, AppPermission, AvailableApp, CatalogEntry,
            CatalogInventoryClassification, DeviceSummary,
        },
        device::same_uuid,
    },
    error::Error,
    infrastructure::{local::uuid_key, logging, relution::RelutionClient},
};
use std::collections::{HashMap, HashSet};

pub(super) async fn authorize_catalog_inputs(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    device: DeviceSummary,
    _locale: &str,
    entries: Vec<CatalogEntry>,
    direct_groups: Vec<String>,
) -> Result<AuthorizedCatalog, Error> {
    let candidates = entries
        .into_iter()
        .filter_map(|entry| app_from(entry, client.native_app_uuid()))
        .collect::<Vec<_>>();
    let (permissions, inventory) = join2(
        app_permissions_bounded(client, token, &candidates),
        client.installed_apps(token, &device.id),
    )
    .await;
    let permissions = permissions?;
    let inventory = inventory?;
    let access =
        evaluate_permissions(client, token, user_uuid, &direct_groups, &permissions).await?;
    let mut rows = Vec::new();
    let mut assigned_eligible_count = 0;
    for (app, allowed) in candidates.into_iter().zip(access) {
        if !allowed {
            continue;
        }
        assigned_eligible_count += 1;
        let installed = inventory.iter().find(|item| {
            item.app_id
                .as_deref()
                .is_some_and(|id| same_uuid(id, &app.id))
        });
        let app_id = app.id.clone();
        match classify_catalog_inventory(app, installed) {
            Ok(CatalogInventoryClassification::Visible(app)) => rows.push(*app),
            Ok(CatalogInventoryClassification::InstalledCurrent) => {}
            // One unreadable installed version hides that row, not the whole catalog.
            Err(error) => logging::write(format!("catalog row {app_id} skipped: {error}")),
        }
    }
    rows.sort_by_key(|app| app.name.to_lowercase());
    Ok(AuthorizedCatalog {
        device,
        assigned_eligible_count,
        rows,
        revision: uuid_key(),
    })
}

pub(super) async fn allowed(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    group_ids: &[String],
    app_id: &str,
) -> Result<bool, Error> {
    let permissions = client.app_permissions(token, app_id).await?;
    for permission in permissions {
        if permission.grants_directly(user_uuid, group_ids) {
            return Ok(true);
        }
        if let Some(group) = permission.readable_group() {
            if client.group_contains_user(token, group, user_uuid).await? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

async fn app_permissions_bounded(
    client: &RelutionClient,
    token: &str,
    apps: &[AvailableApp],
) -> Result<Vec<Vec<AppPermission>>, Error> {
    let mut permissions = Vec::with_capacity(apps.len());
    for chunk in apps.chunks(4) {
        let pages = join_all(
            chunk
                .iter()
                .map(|app| client.app_permissions(token, &app.id))
                .collect(),
        )
        .await;
        for page in pages {
            permissions.push(page?);
        }
    }
    Ok(permissions)
}

async fn evaluate_permissions(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    direct_groups: &[String],
    permissions: &[Vec<AppPermission>],
) -> Result<Vec<bool>, Error> {
    let direct = permissions
        .iter()
        .map(|permissions| {
            permissions
                .iter()
                .any(|permission| permission.grants_directly(user_uuid, direct_groups))
        })
        .collect::<Vec<_>>();
    let direct_group_keys = direct_groups
        .iter()
        .map(|group| group.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut recursive = Vec::new();
    let mut seen = HashSet::new();
    for (already_allowed, app_permissions) in direct.iter().zip(permissions) {
        if *already_allowed {
            continue;
        }
        for group in app_permissions
            .iter()
            .filter_map(AppPermission::readable_group)
        {
            let key = group.to_ascii_lowercase();
            if !direct_group_keys.contains(&key) && seen.insert(key) {
                recursive.push(group.to_owned());
            }
        }
    }
    let recursive_access = group_access_bounded(client, token, user_uuid, &recursive).await?;
    Ok(direct
        .into_iter()
        .zip(permissions)
        .map(|(direct, permissions)| {
            direct
                || permissions
                    .iter()
                    .filter_map(AppPermission::readable_group)
                    .any(|group| {
                        recursive_access
                            .get(&group.to_ascii_lowercase())
                            .copied()
                            .unwrap_or(false)
                    })
        })
        .collect())
}

async fn group_access_bounded(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    groups: &[String],
) -> Result<HashMap<String, bool>, Error> {
    let mut access = HashMap::new();
    for chunk in groups.chunks(4) {
        let results = join_all(
            chunk
                .iter()
                .map(|group| client.group_contains_user(token, group, user_uuid))
                .collect(),
        )
        .await;
        for (group, contains_user) in chunk.iter().zip(results) {
            access.insert(group.to_ascii_lowercase(), contains_user?);
        }
    }
    Ok(access)
}
