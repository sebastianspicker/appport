//! Action application workflow: uncached authorization, durable reservation, and reconciliation.

use crate::{
    application::catalog::{installed_app, CatalogService},
    domain::{
        action::{
            action_details_match, baseline, correlation_candidates, inventory_matches,
            remote_action_blocks_request, remote_state, request_intent, select_correlation,
            to_action, Action, ActionRequest, AppAction, RemoteAction, RemoteActionDetails,
            Reservation, State, Transition,
        },
        catalog::AvailableApp,
    },
    infrastructure::{
        journal::ActionJournal,
        local::{epoch, uuid_key},
        relution::{dto, RelutionClient},
    },
};
use std::sync::Arc;

pub struct ActionService {
    client: Arc<RelutionClient>,
    catalog: Arc<CatalogService>,
    journal: ActionJournal,
}

pub struct PreparedAction(ActionRequest);

impl ActionService {
    pub fn new(client: Arc<RelutionClient>, catalog: Arc<CatalogService>) -> Self {
        let journal = catalog.journal();
        Self {
            client,
            catalog,
            journal,
        }
    }

    pub async fn request_action(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        locale: &str,
    ) -> Result<AppAction, String> {
        let prepared = self
            .prepare_action(token, user_uuid, app_id, locale)
            .await?;
        self.submit_action(token, prepared).await
    }

    pub async fn prepare_action(
        &self,
        token: &str,
        user_uuid: &str,
        app_id: &str,
        locale: &str,
    ) -> Result<PreparedAction, String> {
        if !self.client.writes_enabled() {
            return Err("server: Relution writes are disabled for this build".into());
        }
        // A mutation selects its target from a fresh catalog and evaluates only
        // that app's current permission and inventory state.
        let (device, app) = self
            .catalog
            .action_target(token, user_uuid, app_id, locale)
            .await?;
        let intent = request_intent(&app)?;
        let remote_actions = self.client.device_actions(token, &device.id).await?;
        if has_blocking_remote_action(&remote_actions, &app) {
            return Err("server: a matching Relution action is already active".into());
        }
        let baseline = remote_actions
            .iter()
            .map(|action| action.uuid.as_str())
            .collect::<Vec<_>>()
            .join(",");
        Ok(PreparedAction(ActionRequest {
            id: uuid_key(),
            device_id: device.id,
            app_id: app.id,
            version_id: app.released_version_id,
            package_id: app.package_identifier,
            intent,
            baseline,
        }))
    }

    pub async fn submit_action(
        &self,
        token: &str,
        prepared: PreparedAction,
    ) -> Result<AppAction, String> {
        let ActionRequest {
            id,
            device_id,
            app_id,
            version_id,
            package_id,
            intent,
            baseline,
        } = prepared.0;
        self.journal
            .reserve(Reservation {
                id: &id,
                tenant: self.client.organization_uuid(),
                device: &device_id,
                app: &app_id,
                version: &version_id,
                package: package_id.as_deref(),
                intent,
                baseline: &baseline,
            })
            .await?;
        let result = self
            .client
            .deploy(token, &app_id, &version_id, &device_id)
            .await;
        self.record_submission(&id, result).await?;
        self.saved_action(&id).await
    }

    pub async fn get_action(
        &self,
        token: &str,
        user_uuid: &str,
        action_id: &str,
        generation: u64,
    ) -> Result<AppAction, String> {
        let action = self.saved_journal_action(action_id).await?;
        let device = self
            .catalog
            .current_device_uncached(token, user_uuid)
            .await?;
        if device.id != action.device_id {
            return Err("device_match_failed: device not assigned".into());
        }
        if action.state.terminal() {
            return Ok(to_action(action));
        }
        if self.reconcile_action(token, action_id, &action).await? {
            self.catalog.invalidate_apps(generation).await?;
        }
        self.expire_verification(action_id).await?;
        self.saved_action(action_id).await
    }

    pub(crate) async fn has_remote_attribution(&self, id: &str) -> Result<bool, String> {
        Ok(self.saved_journal_action(id).await?.correlation.is_some())
    }

    async fn saved_action(&self, id: &str) -> Result<AppAction, String> {
        self.saved_journal_action(id).await.map(to_action)
    }
    async fn saved_journal_action(&self, id: &str) -> Result<Action, String> {
        self.journal
            .action(id)
            .await?
            .ok_or("server: application action was not found".into())
    }
    async fn record_submission(
        &self,
        id: &str,
        response: Result<dto::Page<dto::Deployment>, String>,
    ) -> Result<(), String> {
        match response {
            Ok(response) if response.results.len() == 1 && response.results[0].successful => {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionAccepted)
                    .await
            }
            Ok(_) => {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionRejected)
                    .await?;
                Err("server: Relution did not accept the deployment".into())
            }
            Err(error)
                if error.starts_with("session-expired:")
                    || error.starts_with("device_match_failed:") =>
            {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionRejected)
                    .await?;
                Err(error)
            }
            Err(_) => {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionUncertain)
                    .await
            }
        }
    }
    async fn reconcile_action(
        &self,
        token: &str,
        id: &str,
        action: &Action,
    ) -> Result<bool, String> {
        let remote_actions = self
            .client
            .device_actions(token, &action.device_id)
            .await?
            .into_iter()
            .map(remote_action)
            .collect();
        let candidates = correlation_candidates(remote_actions, &baseline(action), action);
        let Some(remote) = select_correlation(action, candidates) else {
            return self.mark_missing_action(id, action).await.map(|_| false);
        };
        let mapped = remote_state(&remote.state);
        self.journal
            .transition(
                id,
                action.state,
                Transition::RemoteObserved {
                    state: mapped,
                    correlation: &remote.id,
                    error_code: (mapped == State::Unknown).then_some("UNMAPPED_RELUTION_ACTION"),
                },
            )
            .await?;
        if mapped == State::Verifying && self.target_installed(token, action).await? {
            self.journal
                .transition(id, State::Verifying, Transition::InventoryConfirmed)
                .await?;
            return Ok(true);
        }
        Ok(false)
    }
    async fn target_installed(&self, token: &str, action: &Action) -> Result<bool, String> {
        let items = self.client.installed_apps(token, &action.device_id).await?;
        Ok(items.iter().map(installed_app).any(|item| {
            inventory_matches(
                &item,
                &action.app_id,
                &action.version_id,
                action.package_id.as_deref(),
            )
        }))
    }
    async fn mark_missing_action(&self, id: &str, action: &Action) -> Result<(), String> {
        if action.created_at + 300 >= epoch() {
            return Ok(());
        }
        self.journal
            .transition(
                id,
                action.state,
                Transition::RemoteMissing {
                    correlation_known: action.correlation.is_some(),
                },
            )
            .await
    }
    async fn expire_verification(&self, id: &str) -> Result<(), String> {
        let action = self.saved_journal_action(id).await?;
        if action.state == State::Verifying && action.created_at + 900 < epoch() {
            self.journal
                .transition(id, State::Verifying, Transition::VerificationTimedOut)
                .await?;
        }
        Ok(())
    }
}

fn remote_action(value: dto::DeviceAction) -> RemoteAction {
    RemoteAction {
        id: value.uuid,
        state: value.state,
        created_at: value.creation_date,
        details: value.details.map(|details| RemoteActionDetails {
            app_id: details.app_uuid,
            version_id: details.version_uuid,
            package_id: details.package,
        }),
    }
}
fn has_blocking_remote_action(actions: &[dto::DeviceAction], app: &AvailableApp) -> bool {
    actions.iter().any(|action| {
        action_details_match(
            action.details.as_ref().map(remote_details).as_ref(),
            &app.id,
            &app.released_version_id,
            app.package_identifier.as_deref(),
        ) && remote_action_blocks_request(remote_state(&action.state))
    })
}
fn remote_details(details: &dto::ActionDetails) -> RemoteActionDetails {
    RemoteActionDetails {
        app_id: details.app_uuid.clone(),
        version_id: details.version_uuid.clone(),
        package_id: details.package.clone(),
    }
}

#[cfg(test)]
#[path = "actions_tests.rs"]
mod actions_tests;
