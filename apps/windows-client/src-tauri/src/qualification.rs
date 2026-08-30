//! Operator qualification built on the same native client used by the Tauri commands.
//! Credentials are caller-owned, never serializable, and never included in reports.

mod checks;
mod plan;
mod read;
mod report;
mod write;

use crate::{
    application::{actions::ActionService, catalog::CatalogService},
    build_config::QualificationProfile,
    infrastructure::relution::{RelutionClient, RelutionConfig},
};
use checks::{add_not_run_write_checks, failed, passed};
use read::run_read_checks;
use report::{finish_report, now};
use std::sync::Arc;
use write::run_write_checks;

pub use checks::{CheckStatus, QualificationCheck};
pub use plan::{ActionFixture, QualificationPlan, UnauthorizedFixture};
pub use report::QualificationReport;

pub struct QualificationCredentials {
    pub user_a_username: String,
    pub user_a_token: String,
    pub user_b_username: String,
    pub user_b_token: String,
    pub expected_device_uuid: String,
}

#[derive(Clone, Debug)]
pub struct QualificationBinding {
    pub candidate_msi_sha256: String,
    pub qualification_utility_sha256: String,
    pub configuration_fingerprint_sha256: String,
    pub source_revision: String,
}

pub async fn run(
    credentials: QualificationCredentials,
    plan: Option<QualificationPlan>,
    binding: QualificationBinding,
) -> QualificationReport {
    let started = now();
    let profile = embedded_profile();
    let config = RelutionConfig::embedded();
    let mut checks = Vec::new();
    let plan_fingerprint = None;
    let writes_enabled = config
        .as_ref()
        .map(|value| value.writes_enabled)
        .unwrap_or(false);

    match (profile, config) {
        (Ok(profile), Ok(config)) => {
            run_configured(
                profile,
                config,
                credentials,
                plan,
                binding,
                started,
                writes_enabled,
            )
            .await
        }
        _ => {
            checks.push(failed(
                "embedded_configuration",
                "embedded configuration is invalid",
            ));
            finish_report(
                QualificationProfile::ReadOnly,
                started,
                writes_enabled,
                plan_fingerprint,
                Some(binding),
                checks,
            )
        }
    }
}

async fn run_configured(
    profile: QualificationProfile,
    config: RelutionConfig,
    credentials: QualificationCredentials,
    plan: Option<QualificationPlan>,
    binding: QualificationBinding,
    started: u64,
    writes_enabled: bool,
) -> QualificationReport {
    let mut checks = Vec::new();
    if profile.writes_enabled() != config.writes_enabled {
        checks.push(failed(
            "profile_matches_write_flag",
            "embedded profile mismatch",
        ));
        return finish_report(
            profile,
            started,
            writes_enabled,
            None,
            Some(binding),
            checks,
        );
    }
    checks.push(passed(
        "profile_matches_write_flag",
        "embedded profile is consistent",
    ));
    let client = match RelutionClient::new(config) {
        Ok(client) => Arc::new(client),
        Err(_) => {
            checks.push(failed(
                "native_client",
                "production client initialization failed",
            ));
            return finish_report(
                profile,
                started,
                writes_enabled,
                None,
                Some(binding),
                checks,
            );
        }
    };
    let catalog = Arc::new(CatalogService::new(Arc::clone(&client)));
    let actions = Arc::new(ActionService::new(
        Arc::clone(&client),
        Arc::clone(&catalog),
    ));
    let plan_fingerprint = run_profile(
        client.as_ref(),
        catalog.as_ref(),
        actions.as_ref(),
        profile,
        &credentials,
        plan,
        &mut checks,
    )
    .await;
    finish_report(
        profile,
        started,
        writes_enabled,
        plan_fingerprint,
        Some(binding),
        checks,
    )
}

async fn run_profile(
    client: &RelutionClient,
    catalog: &CatalogService,
    actions: &ActionService,
    profile: QualificationProfile,
    credentials: &QualificationCredentials,
    plan: Option<QualificationPlan>,
    checks: &mut Vec<QualificationCheck>,
) -> Option<String> {
    let read_prerequisites = run_read_checks(client, catalog, credentials, checks).await;
    match profile {
        QualificationProfile::ReadOnly => run_read_only_profile(plan, checks),
        QualificationProfile::WriteQualification => {
            run_write_profile(
                client,
                catalog,
                actions,
                credentials,
                plan,
                read_prerequisites,
                checks,
            )
            .await
        }
    }
}

fn run_read_only_profile(
    plan: Option<QualificationPlan>,
    checks: &mut Vec<QualificationCheck>,
) -> Option<String> {
    if plan.is_some() {
        checks.push(failed(
            "qualification_plan",
            "write plan is not accepted by the read_only profile",
        ));
    } else {
        add_not_run_write_checks(checks);
    }
    None
}

async fn run_write_profile(
    client: &RelutionClient,
    catalog: &CatalogService,
    actions: &ActionService,
    credentials: &QualificationCredentials,
    plan: Option<QualificationPlan>,
    read_prerequisites: Option<read::ReadPrerequisites>,
    checks: &mut Vec<QualificationCheck>,
) -> Option<String> {
    let Some(plan) = plan else {
        checks.push(failed(
            "qualification_plan",
            "validated disposable-resource plan is required",
        ));
        return None;
    };
    let fingerprint = plan.fingerprint();
    if let Some(prerequisites) = read_prerequisites {
        run_write_checks(
            client,
            catalog,
            actions,
            credentials,
            &plan,
            &prerequisites,
            checks,
        )
        .await;
    } else {
        checks.push(failed(
            "write_preconditions",
            "read, device, and isolation prerequisites did not pass",
        ));
        add_not_run_write_checks(checks);
    }
    Some(fingerprint)
}

fn embedded_profile() -> Result<QualificationProfile, String> {
    QualificationProfile::parse(option_env!("APPPORT_QUALIFICATION_PROFILE").unwrap_or(""))
        .map_err(str::to_owned)
}
