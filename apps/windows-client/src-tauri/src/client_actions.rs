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
        let id = self.reserve_action(token, &device, &app, intent).await?;
        self.submit_action(&id, token, app, device).await?;
        self.saved_action(&id)
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

    async fn reserve_action(
        &self,
        token: &str,
        device: &CurrentDevice,
        app: &AvailableApp,
        intent: crate::wire::ActionIntent,
    ) -> Result<String, String> {
        let id = uuid_key();
        let baseline = self.action_baseline(token, &device.id).await?;
        crate::journal::reserve(
            &id,
            &self.config.organization_uuid,
            &device.id,
            &app.id,
            &app.released_version_id,
            app.package_identifier.as_deref(),
            intent_name(intent),
            &baseline,
        )?;
        Ok(id)
    }

    async fn action_baseline(&self, token: &str, device_id: &str) -> Result<String, String> {
        Ok(self
            .device_actions(token, device_id)
            .await?
            .into_iter()
            .map(|action| action.uuid)
            .collect::<Vec<_>>()
            .join(","))
    }

    async fn submit_action(
        &self,
        id: &str,
        token: &str,
        app: AvailableApp,
        device: CurrentDevice,
    ) -> Result<(), String> {
        let response = self
            .post_once(&deployment_path(&app), token, deployment_body(app, device))
            .await;
        record_submission(id, response)
    }

    fn saved_action(&self, id: &str) -> Result<AppAction, String> {
        crate::journal::action(id)?
            .map(to_action)
            .ok_or("server: application action was not found".into())
    }

    pub async fn get_action(&self, token: &str, user: &str, id: &str) -> Result<AppAction, String> {
        let action = self.saved_journal_action(id)?;
        if terminal_action(&action) {
            return Ok(to_action(action));
        }
        self.ensure_action_device(token, user, &action).await?;
        self.reconcile_action(token, id, &action).await?;
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
    ) -> Result<(), String> {
        match self.related_remote_action(token, action).await? {
            Some(remote) => self.record_remote_action(token, id, action, remote).await,
            None => mark_missing_action(id, action),
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
    ) -> Result<(), String> {
        let mapped = remote_state(&remote.state);
        crate::journal::update(
            id,
            mapped,
            Some(&remote.uuid),
            unknown_action_code(mapped),
            None,
        )?;
        if mapped == "verifying" && self.target_installed(token, action).await? {
            crate::journal::update(id, "succeeded", Some(&remote.uuid), None, None)?;
        }
        Ok(())
    }

    fn expire_verification(&self, id: &str) -> Result<(), String> {
        let action = self.saved_journal_action(id)?;
        if action.state == "verifying" && action.created_at + 900 < epoch() {
            crate::journal::update(
                id,
                "unknown",
                None,
                Some("INVENTORY_VERIFICATION_TIMEOUT"),
                Some("The installed version could not be confirmed. Do not retry."),
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
        Ok(response) if submission_accepted(&response) => {
            crate::journal::update(id, "queued", None, None, None)
        }
        Ok(_) => rejected_submission(id),
        Err(error) => uncertain_submission(id, error),
    }
}

fn submission_accepted(response: &dto::Page<dto::Deployment>) -> bool {
    response.results.len() == 1 && response.results[0].successful
}

fn rejected_submission(id: &str) -> Result<(), String> {
    crate::journal::update(
        id,
        "failed",
        None,
        Some("SUBMISSION_REJECTED"),
        Some("Relution rejected the application request."),
    )?;
    Err("server: Relution did not accept the deployment".into())
}

fn uncertain_submission(id: &str, error: String) -> Result<(), String> {
    let failed = error.starts_with("session-expired:")
        || error.starts_with("device_match_failed:")
        || error.contains("rejected");
    crate::journal::update(
        id,
        if failed { "failed" } else { "unknown" },
        None,
        Some(if failed {
            "SUBMISSION_REJECTED"
        } else {
            "SUBMISSION_UNCERTAIN"
        }),
        Some("The submission status could not be confirmed. Do not retry."),
    )?;
    Err(error)
}

fn terminal_action(action: &crate::journal::Action) -> bool {
    matches!(
        action.state.as_str(),
        "succeeded" | "failed" | "cancelled" | "unknown"
    )
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
        None if candidates.len() == 1 => {
            let remote = candidates
                .into_iter()
                .next()
                .expect("one correlation candidate");
            crate::journal::update(&action.id, &action.state, Some(&remote.uuid), None, None)?;
            Ok(Some(remote))
        }
        None => Ok(None),
    }
}

fn unknown_action_code(state: &str) -> Option<&'static str> {
    (state == "unknown").then_some("UNMAPPED_RELUTION_ACTION")
}

fn mark_missing_action(id: &str, action: &crate::journal::Action) -> Result<(), String> {
    if action.created_at + 300 >= epoch() {
        return Ok(());
    }
    let code = if action.correlation.is_some() {
        "RELUTION_ACTION_NOT_FOUND"
    } else {
        "AMBIGUOUS_RELUTION_ACTION"
    };
    crate::journal::update(
        id,
        "unknown",
        None,
        Some(code),
        Some("The submission status could not be confirmed. Do not retry."),
    )
}

fn installed_apps_path(action: &crate::journal::Action) -> String {
    format!(
        "/api/management/v2/devices/{}/installedApps/baseInfo/query",
        encode(&action.device_id)
    )
}
