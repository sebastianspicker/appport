//! Bounded catalog permission and recursive-group evaluation.

use super::{catalog_entry, installed_app, join2, join3, reads::join4};
use crate::{
    application::catalog_cache::AuthorizedCatalog,
    domain::{
        catalog::{
            app_from, classify_catalog_inventory, AvailableApp, CatalogInventoryClassification,
            DeviceSummary,
        },
        device::same_uuid,
    },
    infrastructure::{
        local::uuid_key,
        relution::{dto, RelutionClient},
    },
};
use std::collections::{HashMap, HashSet};

pub(super) async fn authorize_catalog_inputs(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    device: DeviceSummary,
    _locale: &str,
    entries: Vec<dto::Catalog>,
    groups: dto::Groups,
) -> Result<AuthorizedCatalog, String> {
    let candidates = entries
        .into_iter()
        .filter_map(|entry| app_from(catalog_entry(entry), client.native_app_uuid()))
        .collect::<Vec<_>>();
    let direct_groups = groups
        .groups
        .into_iter()
        .map(|group| group.uuid)
        .collect::<Vec<_>>();
    let (permissions, inventory) = join2(
        app_permissions_bounded(client, token, &candidates),
        client.installed_apps(token, &device.id),
    )
    .await;
    let permissions = permissions?;
    let inventory = inventory?.iter().map(installed_app).collect::<Vec<_>>();
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
        if let CatalogInventoryClassification::Visible(app) =
            classify_catalog_inventory(app, installed)?
        {
            rows.push(*app);
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
) -> Result<bool, String> {
    let permissions = client.app_permissions(token, app_id).await?;
    for permission in permissions.results {
        if directly_authorized(&permission, user_uuid, group_ids) {
            return Ok(true);
        }
        if permission.read && permission.subject.kind.eq_ignore_ascii_case("GROUP") {
            let members = client
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

async fn app_permissions_bounded(
    client: &RelutionClient,
    token: &str,
    apps: &[AvailableApp],
) -> Result<Vec<Vec<dto::Permission>>, String> {
    let mut permissions = Vec::with_capacity(apps.len());
    for chunk in apps.chunks(4) {
        let pages = match chunk {
            [a] => vec![client.app_permissions(token, &a.id).await?],
            [a, b] => {
                let (a, b) = join2(
                    client.app_permissions(token, &a.id),
                    client.app_permissions(token, &b.id),
                )
                .await;
                vec![a?, b?]
            }
            [a, b, c] => {
                let (a, b, c) = join3(
                    client.app_permissions(token, &a.id),
                    client.app_permissions(token, &b.id),
                    client.app_permissions(token, &c.id),
                )
                .await;
                vec![a?, b?, c?]
            }
            [a, b, c, d] => {
                let (a, b, c, d) = join4(
                    client.app_permissions(token, &a.id),
                    client.app_permissions(token, &b.id),
                    client.app_permissions(token, &c.id),
                    client.app_permissions(token, &d.id),
                )
                .await;
                vec![a?, b?, c?, d?]
            }
            _ => unreachable!("chunks are bounded to four"),
        };
        permissions.extend(pages.into_iter().map(|page| page.results));
    }
    Ok(permissions)
}

async fn evaluate_permissions(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    direct_groups: &[String],
    permissions: &[Vec<dto::Permission>],
) -> Result<Vec<bool>, String> {
    let direct = permissions
        .iter()
        .map(|permissions| {
            permissions
                .iter()
                .any(|permission| directly_authorized(permission, user_uuid, direct_groups))
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
        for permission in app_permissions.iter().filter(|permission| permission.read) {
            let key = permission.subject.uuid.to_ascii_lowercase();
            if permission.subject.kind.eq_ignore_ascii_case("GROUP")
                && !direct_group_keys.contains(&key)
                && seen.insert(key)
            {
                recursive.push(permission.subject.uuid.clone());
            }
        }
    }
    let recursive_access = group_access_bounded(client, token, user_uuid, &recursive).await?;
    Ok(direct
        .into_iter()
        .zip(permissions)
        .map(|(direct, permissions)| {
            direct
                || permissions.iter().any(|permission| {
                    permission.read
                        && permission.subject.kind.eq_ignore_ascii_case("GROUP")
                        && recursive_access
                            .get(&permission.subject.uuid.to_ascii_lowercase())
                            .copied()
                            .unwrap_or(false)
                })
        })
        .collect())
}

fn directly_authorized(
    permission: &dto::Permission,
    user_uuid: &str,
    direct_groups: &[String],
) -> bool {
    permission.read
        && ((permission.subject.kind.eq_ignore_ascii_case("USER")
            && same_uuid(&permission.subject.uuid, user_uuid))
            || (permission.subject.kind.eq_ignore_ascii_case("GROUP")
                && direct_groups
                    .iter()
                    .any(|group| same_uuid(group, &permission.subject.uuid))))
}

async fn group_access_bounded(
    client: &RelutionClient,
    token: &str,
    user_uuid: &str,
    groups: &[String],
) -> Result<HashMap<String, bool>, String> {
    let mut access = HashMap::new();
    for chunk in groups.chunks(4) {
        let results = match chunk {
            [a] => vec![client.group_members(token, a).await?],
            [a, b] => {
                let (a_result, b_result) = join2(
                    client.group_members(token, a),
                    client.group_members(token, b),
                )
                .await;
                vec![a_result?, b_result?]
            }
            [a, b, c] => {
                let (a_result, b_result, c_result) = join3(
                    client.group_members(token, a),
                    client.group_members(token, b),
                    client.group_members(token, c),
                )
                .await;
                vec![a_result?, b_result?, c_result?]
            }
            [a, b, c, d] => {
                let (a_result, b_result, c_result, d_result) = join4(
                    client.group_members(token, a),
                    client.group_members(token, b),
                    client.group_members(token, c),
                    client.group_members(token, d),
                )
                .await;
                vec![a_result?, b_result?, c_result?, d_result?]
            }
            _ => unreachable!("chunks are bounded to four"),
        };
        for (group, members) in chunk.iter().zip(results) {
            access.insert(
                group.to_ascii_lowercase(),
                members
                    .iter()
                    .any(|member| same_uuid(&member.uuid, user_uuid)),
            );
        }
    }
    Ok(access)
}
