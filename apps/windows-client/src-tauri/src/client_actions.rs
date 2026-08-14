use super::*;

impl RelutionClient {
    pub async fn request_action(
        &self,
        token: &str,
        user: &str,
        app_id: &str,
    ) -> Result<AppAction, String> {
        self.require_writes_enabled()?;
        let (device, app, intent) = self.request_context(token, user, app_id).await?;
        self.request_action_with_context(token, device, app, intent)
            .await
    }

    pub(super) async fn request_action_with_context(
        &self,
        token: &str,
        device: CurrentDevice,
        app: AvailableApp,
        intent: crate::wire::ActionIntent,
    ) -> Result<AppAction, String> {
        let remote_actions = self.device_actions(token, &device.id).await?;
        if has_blocking_remote_action(&remote_actions, &app) {
            return Err("server: a matching Relution action is already active".into());
        }
        let id = self.reserve_action(&device, &app, intent, remote_actions)?;
        self.submit_action(&id, token, app, device).await
    }

    fn require_writes_enabled(&self) -> Result<(), String> {
        if self.config.writes_enabled {
            Ok(())
        } else {
            Err("server: Relution writes are disabled for this build".into())
        }
    }

    async fn request_context(
        &self,
        token: &str,
        user: &str,
        app_id: &str,
    ) -> Result<(CurrentDevice, AvailableApp, crate::wire::ActionIntent), String> {
        let device = self.current_device(token, user).await?;
        let app = self
            .permitted_request_app(token, user, &device, app_id)
            .await?;
        let intent = request_intent(&app)?;
        Ok((device, app, intent))
    }

    async fn permitted_request_app(
        &self,
        token: &str,
        user: &str,
        device: &CurrentDevice,
        app_id: &str,
    ) -> Result<AvailableApp, String> {
        self.list_apps_for(token, user, device)
            .await?
            .into_iter()
            .find(|app| app.id == app_id)
            .ok_or("server: application is not permitted".into())
    }

    fn reserve_action(
        &self,
        device: &CurrentDevice,
        app: &AvailableApp,
        intent: crate::wire::ActionIntent,
        remote_actions: Vec<dto::DeviceAction>,
    ) -> Result<String, String> {
        let id = uuid_key();
        let baseline = action_baseline(remote_actions);
        crate::journal::reserve(crate::journal::Reservation {
            id: &id,
            tenant: &self.config.organization_uuid,
            device: &device.id,
            app: &app.id,
            version: &app.released_version_id,
            package: app.package_identifier.as_deref(),
            intent: intent_name(intent),
            baseline: &baseline,
        })?;
        Ok(id)
    }

    async fn submit_action(
        &self,
        id: &str,
        token: &str,
        app: AvailableApp,
        device: CurrentDevice,
    ) -> Result<AppAction, String> {
        let response = self
            .post_once(&deployment_path(&app), token, deployment_body(app, device))
            .await;
        record_submission(id, response)?;
        self.saved_action(id)
    }

    fn saved_action(&self, id: &str) -> Result<AppAction, String> {
        crate::journal::action(id)?
            .map(to_action)
            .ok_or("server: application action was not found".into())
    }

    pub async fn get_action(
        &self,
        token: &str,
        user: &str,
        id: &str,
        generation: u64,
    ) -> Result<AppAction, String> {
        let action = self.saved_journal_action(id)?;
        self.ensure_action_device(token, user, &action).await?;
        if terminal_action(&action) {
            return Ok(to_action(action));
        }
        if self.reconcile_action(token, id, &action).await? {
            self.invalidate_cached_apps(generation).await?;
        }
        self.expire_verification(id)?;
        self.saved_action(id)
    }

    fn saved_journal_action(&self, id: &str) -> Result<crate::journal::Action, String> {
        crate::journal::action(id)?.ok_or("server: application action was not found".into())
    }

    async fn ensure_action_device(
        &self,
        token: &str,
        user: &str,
        action: &crate::journal::Action,
    ) -> Result<(), String> {
        if self.current_device(token, user).await?.id == action.device_id {
            Ok(())
        } else {
            Err("device_match_failed: device not assigned".into())
        }
    }

    async fn reconcile_action(
        &self,
        token: &str,
        id: &str,
        action: &crate::journal::Action,
    ) -> Result<bool, String> {
        match self.related_remote_action(token, action).await? {
            Some(remote) => self.record_remote_action(token, id, action, remote).await,
            None => {
                mark_missing_action(id, action)?;
                Ok(false)
            }
        }
    }

    async fn related_remote_action(
        &self,
        token: &str,
        action: &crate::journal::Action,
    ) -> Result<Option<dto::DeviceAction>, String> {
        let candidates = correlation_candidates(
            self.device_actions(token, &action.device_id).await?,
            &baseline(action),
            action,
        );
        select_correlation(action, candidates)
    }

    async fn record_remote_action(
        &self,
        token: &str,
        id: &str,
        action: &crate::journal::Action,
        remote: dto::DeviceAction,
    ) -> Result<bool, String> {
        let mapped = remote_state(&remote.state);
        crate::journal::transition(
            id,
            action.state,
            crate::journal::Transition::RemoteObserved {
                state: mapped,
                correlation: &remote.uuid,
                error_code: unknown_action_code(mapped),
            },
        )?;
        if mapped == crate::journal::State::Verifying
            && self.target_installed(token, action).await?
        {
            crate::journal::transition(
                id,
                crate::journal::State::Verifying,
                crate::journal::Transition::InventoryConfirmed,
            )?;
            return Ok(true);
        }
        Ok(false)
    }

    fn expire_verification(&self, id: &str) -> Result<(), String> {
        let action = self.saved_journal_action(id)?;
        if action.state == crate::journal::State::Verifying && action.created_at + 900 < epoch() {
            crate::journal::transition(
                id,
                crate::journal::State::Verifying,
                crate::journal::Transition::VerificationTimedOut,
            )?;
        }
        Ok(())
    }

    async fn target_installed(
        &self,
        token: &str,
        action: &crate::journal::Action,
    ) -> Result<bool, String> {
        let items: Vec<dto::Inventory> = self
            .post_pages(
                &installed_apps_path(action),
                token,
                json!({"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        Ok(items.iter().any(|item| {
            inventory_matches(
                item,
                &action.app_id,
                &action.version_id,
                action.package_id.as_deref(),
            )
        }))
    }
}

fn request_intent(app: &AvailableApp) -> Result<crate::wire::ActionIntent, String> {
    if app.installed_version_id.as_deref() == Some(&app.released_version_id)
        || app.installed_version_id.is_some()
            && app.install_state != crate::wire::AppInstallState::UpdateAvailable
    {
        return Err("server: application is already current or update is not approved".into());
    }
    Ok(if app.installed_version_id.is_some() {
        crate::wire::ActionIntent::Update
    } else {
        crate::wire::ActionIntent::Install
    })
}

fn intent_name(intent: crate::wire::ActionIntent) -> &'static str {
    if intent == crate::wire::ActionIntent::Install {
        "install"
    } else {
        "update"
    }
}

fn deployment_path(app: &AvailableApp) -> String {
    format!(
        "/api/management/v1/content/apps/{}/versions/{}/deployments",
        encode(&app.id),
        encode(&app.released_version_id)
    )
}

fn deployment_body(app: AvailableApp, device: CurrentDevice) -> serde_json::Value {
    json!({"appUuid":app.id,"versionUuid":app.released_version_id,"deviceUuid":device.id})
}

fn record_submission(
    id: &str,
    response: Result<dto::Page<dto::Deployment>, String>,
) -> Result<(), String> {
    match response {
        Ok(response) if submission_accepted(&response) => crate::journal::transition(
            id,
            crate::journal::State::Reserved,
            crate::journal::Transition::SubmissionAccepted,
        ),
        Ok(_) => rejected_submission(id),
        Err(error) => uncertain_submission(id, error),
    }
}

fn submission_accepted(response: &dto::Page<dto::Deployment>) -> bool {
    response.results.len() == 1 && response.results[0].successful
}

fn rejected_submission(id: &str) -> Result<(), String> {
    crate::journal::transition(
        id,
        crate::journal::State::Reserved,
        crate::journal::Transition::SubmissionRejected,
    )?;
    Err("server: Relution did not accept the deployment".into())
}

fn uncertain_submission(id: &str, error: String) -> Result<(), String> {
    if submission_error_is_definitive(&error) {
        crate::journal::transition(
            id,
            crate::journal::State::Reserved,
            crate::journal::Transition::SubmissionRejected,
        )?;
        Err(error)
    } else {
        crate::journal::transition(
            id,
            crate::journal::State::Reserved,
            crate::journal::Transition::SubmissionUncertain,
        )
    }
}

fn submission_error_is_definitive(error: &str) -> bool {
    error.starts_with("session-expired:") || error.starts_with("device_match_failed:")
}

fn action_baseline(actions: Vec<dto::DeviceAction>) -> String {
    actions
        .into_iter()
        .map(|action| action.uuid)
        .collect::<Vec<_>>()
        .join(",")
}

pub(super) fn has_blocking_remote_action(
    actions: &[dto::DeviceAction],
    app: &AvailableApp,
) -> bool {
    actions.iter().any(|action| {
        action_details_match(
            action.details.as_ref(),
            &app.id,
            &app.released_version_id,
            app.package_identifier.as_deref(),
        ) && remote_action_blocks_request(remote_state(&action.state))
    })
}

fn remote_action_blocks_request(state: crate::journal::State) -> bool {
    matches!(
        state,
        crate::journal::State::Queued
            | crate::journal::State::Sent
            | crate::journal::State::Deferred
            | crate::journal::State::Verifying
            | crate::journal::State::Unknown
    )
}

fn terminal_action(action: &crate::journal::Action) -> bool {
    action.state.terminal()
}

fn baseline(action: &crate::journal::Action) -> std::collections::HashSet<&str> {
    action
        .baseline
        .split(',')
        .filter(|value| !value.is_empty())
        .collect()
}

fn select_correlation(
    action: &crate::journal::Action,
    candidates: Vec<dto::DeviceAction>,
) -> Result<Option<dto::DeviceAction>, String> {
    match action.correlation.as_deref() {
        Some(correlation) => Ok(candidates
            .into_iter()
            .find(|candidate| candidate.uuid == correlation)),
        None if candidates.len() == 1 => Ok(candidates.into_iter().next()),
        None => Ok(None),
    }
}

fn unknown_action_code(state: crate::journal::State) -> Option<&'static str> {
    (state == crate::journal::State::Unknown).then_some("UNMAPPED_RELUTION_ACTION")
}

fn mark_missing_action(id: &str, action: &crate::journal::Action) -> Result<(), String> {
    if action.created_at + 300 >= epoch() {
        return Ok(());
    }
    crate::journal::transition(
        id,
        action.state,
        crate::journal::Transition::RemoteMissing {
            correlation_known: action.correlation.is_some(),
        },
    )
}

fn installed_apps_path(action: &crate::journal::Action) -> String {
    format!(
        "/api/management/v2/devices/{}/installedApps/baseInfo/query",
        encode(&action.device_id)
    )
}

#[cfg(test)]
mod submission_classification_tests {
    use super::submission_error_is_definitive;

    #[test]
    fn ambiguous_submission_errors_remain_unknown() {
        assert!(!submission_error_is_definitive(
            "server: Relution request failed after submission may have occurred"
        ));
        assert!(!submission_error_is_definitive(
            "offline: Relution is unreachable"
        ));
        assert!(submission_error_is_definitive(
            "session-expired: authorization required"
        ));
        assert!(submission_error_is_definitive(
            "device_match_failed: device not assigned"
        ));
    }
}
