use super::{
    checks::{failed, not_run, passed},
    read::ReadPrerequisites,
    ActionFixture, QualificationCheck, QualificationCredentials, QualificationPlan,
};
use crate::{
    client::RelutionClient,
    wire::{ActionIntent, ActionState, AppInstallState, AvailableApp, CatalogView},
};

pub(super) async fn run_write_checks(
    client: &RelutionClient,
    credentials: &QualificationCredentials,
    plan: &QualificationPlan,
    prerequisites: &ReadPrerequisites,
    checks: &mut Vec<QualificationCheck>,
) {
    if !plan_matches_operator_input(plan, credentials, prerequisites, checks) {
        return;
    }
    if !fresh_device_matches(client, credentials, plan, prerequisites, checks).await {
        return;
    }
    let (apps, updates) = match write_catalog(client, credentials, prerequisites).await {
        Ok(catalog) => catalog,
        Err(failure) => {
            checks.push(failure.check());
            return;
        }
    };
    if !fixtures_are_approved(&apps, &updates, plan, checks) {
        return;
    }
    if !cross_user_action_is_denied(client, credentials, prerequisites, checks).await {
        return;
    }
    let mut actions = ActionQualification {
        client,
        credentials,
        user_uuid: &prerequisites.user_b_uuid,
        checks,
    };
    actions
        .qualify(&plan.install, ActionIntent::Install, "approved_install")
        .await;
    if actions.last_check_failed() {
        return;
    }
    actions
        .qualify(&plan.update, ActionIntent::Update, "approved_update")
        .await;
    let checks = actions.checks;
    checks.push(not_run(
        "cleanup",
        "cleanup evidence must be attached after fixture owners restore the disposable resources",
    ));
    checks.push(not_run(
        "uninstall_and_administrative_probes",
        "not authorized by the alpha.4 qualification profile",
    ));
}

fn plan_matches_operator_input(
    plan: &QualificationPlan,
    credentials: &QualificationCredentials,
    prerequisites: &ReadPrerequisites,
    checks: &mut Vec<QualificationCheck>,
) -> bool {
    let matches = plan.disposable_device_uuid == credentials.expected_device_uuid
        && plan.disposable_device_uuid == prerequisites.device_uuid;
    checks.push(if matches {
        passed("qualification_plan", "disposable-resource plan validated")
    } else {
        failed(
            "qualification_plan",
            "plan device does not match the independently verified disposable device",
        )
    });
    matches
}

async fn fresh_device_matches(
    client: &RelutionClient,
    credentials: &QualificationCredentials,
    plan: &QualificationPlan,
    prerequisites: &ReadPrerequisites,
    checks: &mut Vec<QualificationCheck>,
) -> bool {
    let matches = client
        .current_device_id(&credentials.user_b_token, &prerequisites.user_b_uuid)
        .await
        .ok()
        .as_deref()
        == Some(plan.disposable_device_uuid.as_str());
    checks.push(if matches {
        passed(
            "write_device_binding",
            "freshly resolved device matches the approved disposable device",
        )
    } else {
        failed(
            "write_device_binding",
            "freshly resolved device does not match the approved disposable device",
        )
    });
    matches
}

async fn write_catalog(
    client: &RelutionClient,
    credentials: &QualificationCredentials,
    prerequisites: &ReadPrerequisites,
) -> Result<(Vec<AvailableApp>, Vec<AvailableApp>), WriteCatalogFailure> {
    let apps = catalog_result(
        client
            .list_apps(
                &credentials.user_b_token,
                &prerequisites.user_b_uuid,
                2,
                CatalogView::Apps,
            )
            .await,
        WriteCatalogFailure::Apps,
    )?;
    let updates = catalog_result(
        client
            .list_apps(
                &credentials.user_b_token,
                &prerequisites.user_b_uuid,
                2,
                CatalogView::Updates,
            )
            .await,
        WriteCatalogFailure::Updates,
    )?;
    Ok((apps, updates))
}

fn catalog_result<T>(
    result: Result<T, String>,
    failure: WriteCatalogFailure,
) -> Result<T, WriteCatalogFailure> {
    result.map_err(|_| failure)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WriteCatalogFailure {
    Apps,
    Updates,
}

impl WriteCatalogFailure {
    fn check(self) -> QualificationCheck {
        let detail = match self {
            Self::Apps => "Apps catalog lookup failed; write action submission was blocked",
            Self::Updates => "Updates catalog lookup failed; write action submission was blocked",
        };
        failed("write_catalog", detail)
    }
}

fn fixtures_are_approved(
    apps: &[AvailableApp],
    updates: &[AvailableApp],
    plan: &QualificationPlan,
    checks: &mut Vec<QualificationCheck>,
) -> bool {
    let install_ok = fixture_visible(apps, &plan.install, AppInstallState::Available);
    let update_ok = fixture_visible(updates, &plan.update, AppInstallState::UpdateAvailable);
    let unauthorized_absent = apps
        .iter()
        .chain(updates)
        .all(|app| app.id != plan.unauthorized.application_uuid);
    let substituted_absent = apps
        .iter()
        .chain(updates)
        .all(|app| app.released_version_id != plan.unauthorized.version_uuid);
    checks.push(fixture_check(
        install_ok,
        "install_fixture",
        "approved install fixture matched exactly",
        "approved install fixture did not match",
    ));
    checks.push(fixture_check(
        update_ok,
        "update_fixture",
        "approved update fixture matched exactly",
        "approved update fixture did not match",
    ));
    checks.push(fixture_check(
        unauthorized_absent,
        "unauthorized_application",
        "unauthorized application remained absent",
        "unauthorized application was visible",
    ));
    checks.push(fixture_check(
        substituted_absent,
        "substituted_version",
        "unauthorized version was not selectable",
        "unauthorized version was selectable",
    ));
    install_ok && update_ok && unauthorized_absent && substituted_absent
}

fn fixture_check(
    passed_check: bool,
    name: &'static str,
    success: &'static str,
    failure: &'static str,
) -> QualificationCheck {
    if passed_check {
        passed(name, success)
    } else {
        failed(name, failure)
    }
}

async fn cross_user_action_is_denied(
    client: &RelutionClient,
    credentials: &QualificationCredentials,
    prerequisites: &ReadPrerequisites,
    checks: &mut Vec<QualificationCheck>,
) -> bool {
    let result = client
        .request_action(
            &credentials.user_a_token,
            &prerequisites.user_a_uuid,
            client.native_app_uuid(),
        )
        .await;
    let check = cross_user_action_check(result);
    let denied = check.status == super::CheckStatus::Passed;
    checks.push(check);
    denied
}

fn cross_user_action_check(result: Result<crate::wire::AppAction, String>) -> QualificationCheck {
    if matches!(result, Err(error) if error.starts_with("device_match_failed:")) {
        passed(
            "cross_user_action",
            "production action path denied unassigned ordinary user A before dispatch",
        )
    } else {
        failed(
            "cross_user_action",
            "production action path did not return the expected device denial",
        )
    }
}

#[cfg(test)]
fn successful_action() -> crate::wire::AppAction {
    crate::wire::AppAction {
        id: "action".into(),
        device_id: "device".into(),
        app_id: "app".into(),
        intent: ActionIntent::Install,
        state: ActionState::Queued,
        error_code: None,
        error_message: None,
        created_at: "0".into(),
        updated_at: "0".into(),
    }
}

struct ActionQualification<'a> {
    client: &'a RelutionClient,
    credentials: &'a QualificationCredentials,
    user_uuid: &'a str,
    checks: &'a mut Vec<QualificationCheck>,
}

impl ActionQualification<'_> {
    async fn qualify(
        &mut self,
        fixture: &ActionFixture,
        expected_intent: ActionIntent,
        name: &'static str,
    ) {
        let action = match self
            .client
            .request_action(
                &self.credentials.user_b_token,
                self.user_uuid,
                &fixture.application_uuid,
            )
            .await
        {
            Ok(action) if action.intent == expected_intent => action,
            _ => {
                self.checks.push(failed(
                    name,
                    "action submission did not match the approved intent",
                ));
                return;
            }
        };
        for _ in 0..90 {
            match self
                .client
                .get_action(
                    &self.credentials.user_b_token,
                    self.user_uuid,
                    &action.id,
                    2,
                )
                .await
            {
                Ok(current) if current.state == ActionState::Succeeded => {
                    self.record_succeeded_action(name, &current.id);
                    return;
                }
                Ok(current)
                    if matches!(
                        current.state,
                        ActionState::Failed | ActionState::Cancelled | ActionState::Unknown
                    ) =>
                {
                    self.checks
                        .push(failed(name, "action reached a terminal non-success state"));
                    return;
                }
                Err(_) => {
                    self.checks
                        .push(failed(name, "action reconciliation failed without retry"));
                    return;
                }
                _ => tokio::time::sleep(std::time::Duration::from_secs(10)).await,
            }
        }
        self.checks
            .push(failed(name, "action inventory confirmation timed out"));
    }

    fn record_succeeded_action(&mut self, name: &'static str, action_id: &str) {
        let attributed = crate::journal::action(action_id)
            .ok()
            .flatten()
            .and_then(|saved| saved.correlation)
            .is_some();
        self.checks.push(if attributed {
            passed(
                name,
                "action succeeded with exact inventory proof and remote attribution",
            )
        } else {
            failed(name, "action completed without unique remote attribution")
        });
    }

    fn last_check_failed(&self) -> bool {
        self.checks
            .last()
            .is_some_and(|check| check.status == super::CheckStatus::Failed)
    }
}

fn fixture_visible(
    apps: &[AvailableApp],
    fixture: &ActionFixture,
    expected_state: AppInstallState,
) -> bool {
    apps.iter().any(|app| {
        app.id == fixture.application_uuid
            && app.released_version_id == fixture.version_uuid
            && app.released_version_label.as_deref() == Some(fixture.expected_version.as_str())
            && app.install_state == expected_state
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_lookup_failure_is_redacted_and_blocks_catalog_use() {
        let result: Result<(), String> =
            Err("server: invalid Relution response Bearer sentinel-apps-token".into());

        let failure = catalog_result(result, WriteCatalogFailure::Apps).unwrap_err();
        let check = failure.check();

        assert_eq!(failure, WriteCatalogFailure::Apps);
        assert_eq!(check.name, "write_catalog");
        assert_eq!(check.status, super::super::CheckStatus::Failed);
        assert!(check.detail.contains("Apps catalog lookup failed"));
        assert!(!check.detail.contains("sentinel-apps-token"));
    }

    #[test]
    fn updates_lookup_failure_is_redacted_and_blocks_catalog_use() {
        let result: Result<(), String> =
            Err("server: invalid Relution response Bearer sentinel-updates-token".into());

        let failure = catalog_result(result, WriteCatalogFailure::Updates).unwrap_err();
        let check = failure.check();

        assert_eq!(failure, WriteCatalogFailure::Updates);
        assert_eq!(check.name, "write_catalog");
        assert_eq!(check.status, super::super::CheckStatus::Failed);
        assert!(check.detail.contains("Updates catalog lookup failed"));
        assert!(!check.detail.contains("sentinel-updates-token"));
    }

    #[test]
    fn cross_user_action_passes_only_for_the_observed_device_denial() {
        let passed_check =
            cross_user_action_check(Err("device_match_failed: device not assigned".into()));
        assert_eq!(passed_check.status, super::super::CheckStatus::Passed);

        for result in [
            Ok(successful_action()),
            Err("server: action submission failed".into()),
            Err("session-expired: user A session expired".into()),
        ] {
            assert_eq!(
                cross_user_action_check(result).status,
                super::super::CheckStatus::Failed
            );
        }
    }
}
