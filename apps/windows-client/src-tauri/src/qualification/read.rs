use super::{
    checks::{failed, passed, result_check},
    CheckStatus, QualificationCheck, QualificationCredentials,
};
use crate::{
    application::catalog::CatalogService,
    domain::catalog::{AvailableApp, CatalogView},
    infrastructure::relution::{ConnectedIdentity, RelutionClient},
    infrastructure::windows::platform,
};

pub(super) struct ReadPrerequisites {
    pub(super) user_a_uuid: String,
    pub(super) user_b_uuid: String,
    pub(super) device_uuid: String,
}

pub(super) async fn run_read_checks(
    client: &RelutionClient,
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    checks: &mut Vec<QualificationCheck>,
) -> Option<ReadPrerequisites> {
    let first_check = checks.len();
    let locale = platform::current_locale();
    let user_b = connect_user_b(client, credentials, checks).await?;
    if !matches_expected_device(catalog, credentials, &user_b, checks).await {
        return None;
    }
    let (apps, updates) = run_catalog_checks(catalog, credentials, &user_b, &locale, checks).await;
    run_icon_check(
        catalog,
        credentials,
        &user_b,
        &apps,
        &updates,
        &locale,
        checks,
    )
    .await;
    let user_a_uuid = verify_user_a_isolation(client, catalog, credentials, checks).await;
    let all_passed = checks[first_check..]
        .iter()
        .all(|check| check.status == CheckStatus::Passed);
    let user_a_uuid = user_a_uuid?;
    all_passed.then(|| ReadPrerequisites {
        user_a_uuid,
        user_b_uuid: user_b.user_uuid,
        device_uuid: credentials.expected_device_uuid.clone(),
    })
}

async fn connect_user_b(
    client: &RelutionClient,
    credentials: &QualificationCredentials,
    checks: &mut Vec<QualificationCheck>,
) -> Option<ConnectedIdentity> {
    match client
        .connect(&credentials.user_b_username, &credentials.user_b_token)
        .await
    {
        Ok(identity) => {
            checks.push(passed(
                "user_b_identity",
                "ordinary user B resolved uniquely",
            ));
            Some(identity)
        }
        Err(_) => {
            checks.push(failed("user_b_identity", "ordinary user B identity failed"));
            None
        }
    }
}

async fn matches_expected_device(
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    user_b: &ConnectedIdentity,
    checks: &mut Vec<QualificationCheck>,
) -> bool {
    let device = catalog
        .current_device_uncached(&credentials.user_b_token, &user_b.user_uuid)
        .await;
    if device.as_ref().map(|device| device.id.as_str())
        == Ok(credentials.expected_device_uuid.as_str())
    {
        checks.push(passed(
            "user_b_device_match",
            "assigned disposable device matched",
        ));
        true
    } else {
        checks.push(failed(
            "user_b_device_match",
            "assigned device did not match",
        ));
        false
    }
}

async fn run_catalog_checks(
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    user_b: &ConnectedIdentity,
    locale: &str,
    checks: &mut Vec<QualificationCheck>,
) -> (
    Result<Vec<AvailableApp>, String>,
    Result<Vec<AvailableApp>, String>,
) {
    let initial_bootstrap = bootstrap(catalog, credentials, user_b, 1, locale).await;
    checks.push(if initial_bootstrap.is_ok() {
        passed("bootstrap", "native bootstrap completed")
    } else {
        failed("bootstrap", "native bootstrap failed")
    });
    let apps = catalog
        .list_apps(
            &credentials.user_b_token,
            &user_b.user_uuid,
            1,
            CatalogView::Apps,
            locale,
        )
        .await;
    let updates = catalog
        .list_apps(
            &credentials.user_b_token,
            &user_b.user_uuid,
            1,
            CatalogView::Updates,
            locale,
        )
        .await;
    record_catalog_results(&apps, &updates, checks);
    let background_bootstrap = bootstrap(catalog, credentials, user_b, 2, locale).await;
    checks.push(result_check("background_bootstrap", &background_bootstrap));
    (apps, updates)
}

async fn bootstrap(
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    user_b: &ConnectedIdentity,
    generation: u64,
    locale: &str,
) -> Result<(), String> {
    catalog
        .bootstrap(
            &credentials.user_b_token,
            &user_b.username,
            &user_b.user_uuid,
            generation,
            locale,
        )
        .await
        .map(|_| ())
}

fn record_catalog_results(
    apps: &Result<Vec<AvailableApp>, String>,
    updates: &Result<Vec<AvailableApp>, String>,
    checks: &mut Vec<QualificationCheck>,
) {
    checks.push(result_check("apps_catalog", apps));
    checks.push(result_check("updates_catalog", updates));
    checks.push(if apps.is_ok() && updates.is_ok() {
        passed(
            "installed_inventory",
            "catalog classification completed from the production inventory path",
        )
    } else {
        failed(
            "installed_inventory",
            "production inventory classification failed",
        )
    });
}

async fn run_icon_check(
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    user_b: &ConnectedIdentity,
    apps: &Result<Vec<AvailableApp>, String>,
    updates: &Result<Vec<AvailableApp>, String>,
    locale: &str,
    checks: &mut Vec<QualificationCheck>,
) {
    let icon_app = apps
        .as_ref()
        .ok()
        .into_iter()
        .flatten()
        .chain(updates.as_ref().ok().into_iter().flatten())
        .find(|app| app.has_icon);
    let has_icon_fixture = icon_app.is_some();
    let detail = match icon_app {
        Some(app) => match catalog
            .icon(
                &credentials.user_b_token,
                &user_b.user_uuid,
                &app.id,
                2,
                locale,
            )
            .await
        {
            Ok(Some(_)) => Some("authorized icon loaded"),
            _ => None,
        },
        None => None,
    };
    checks.push(match (has_icon_fixture, detail) {
        (true, Some(detail)) => passed("icon", detail),
        (true, None) => failed("icon", "authorized icon could not be loaded"),
        (false, _) => failed("icon", "no approved icon fixture was visible"),
    });
}

async fn verify_user_a_isolation(
    client: &RelutionClient,
    catalog: &CatalogService,
    credentials: &QualificationCredentials,
    checks: &mut Vec<QualificationCheck>,
) -> Option<String> {
    let user_a = match client
        .connect(&credentials.user_a_username, &credentials.user_a_token)
        .await
    {
        Ok(user_a) => user_a,
        Err(_) => {
            checks.push(failed(
                "user_a_unassigned_isolation",
                "ordinary user A identity was not independently verified",
            ));
            return None;
        }
    };
    let result = catalog
        .current_device_uncached(&credentials.user_a_token, &user_a.user_uuid)
        .await;
    if matches!(result, Err(error) if error.starts_with("device_match_failed:")) {
        checks.push(passed(
            "user_a_unassigned_isolation",
            "unassigned ordinary user A was denied before action submission",
        ));
        Some(user_a.user_uuid)
    } else {
        checks.push(failed(
            "user_a_unassigned_isolation",
            "unassigned ordinary user A was not denied",
        ));
        None
    }
}
