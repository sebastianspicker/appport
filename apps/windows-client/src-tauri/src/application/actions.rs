//! Action application workflow: uncached authorization, durable reservation, and reconciliation.

use crate::{
    application::catalog::CatalogService,
    domain::{
        action::{
            action_details_match, baseline, correlation_candidates, inventory_matches,
            remote_action_blocks_request, remote_state, request_intent, select_correlation,
            to_action, Action, ActionRequest, AppAction, DeploymentResponse, RemoteAction,
            Reservation, State, Transition,
        },
        catalog::AvailableApp,
    },
    error::{Error, ErrorKind},
    infrastructure::{
        journal::ActionJournal,
        local::{epoch, uuid_key},
        relution::RelutionClient,
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
    ) -> Result<AppAction, Error> {
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
    ) -> Result<PreparedAction, Error> {
        if !self.client.writes_enabled() {
            return Err(Error::server("Relution writes are disabled for this build"));
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
            return Err(Error::server(
                "a matching Relution action is already active",
            ));
        }
        let baseline = remote_actions
            .iter()
            .map(|action| action.id.as_str())
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
    ) -> Result<AppAction, Error> {
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
    ) -> Result<AppAction, Error> {
        let action = self.saved_journal_action(action_id).await?;
        let device = self
            .catalog
            .current_device_uncached(token, user_uuid)
            .await?;
        if device.id != action.device_id {
            return Err(Error::device_match_failed("device not assigned"));
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

    pub(crate) async fn has_remote_attribution(&self, id: &str) -> Result<bool, Error> {
        Ok(self.saved_journal_action(id).await?.correlation.is_some())
    }

    async fn saved_action(&self, id: &str) -> Result<AppAction, Error> {
        self.saved_journal_action(id).await.map(to_action)
    }
    async fn saved_journal_action(&self, id: &str) -> Result<Action, Error> {
        self.journal
            .action(id)
            .await?
            .ok_or_else(|| Error::server("application action was not found"))
    }
    async fn record_submission(
        &self,
        id: &str,
        response: Result<DeploymentResponse, Error>,
    ) -> Result<(), Error> {
        match response {
            Ok(DeploymentResponse::Accepted) => {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionAccepted)
                    .await
            }
            Ok(DeploymentResponse::NotAccepted) => {
                self.journal
                    .transition(id, State::Reserved, Transition::SubmissionRejected)
                    .await?;
                Err(Error::server("Relution did not accept the deployment"))
            }
            // Only a refusal that proves the POST did not land is a rejection. Every
            // other kind, including kinds added later, stays uncertain.
            Err(error) => match error.kind() {
                ErrorKind::SessionExpired | ErrorKind::DeviceMatchFailed => {
                    self.journal
                        .transition(id, State::Reserved, Transition::SubmissionRejected)
                        .await?;
                    Err(error)
                }
                _ => {
                    self.journal
                        .transition(id, State::Reserved, Transition::SubmissionUncertain)
                        .await
                }
            },
        }
    }
    async fn reconcile_action(
        &self,
        token: &str,
        id: &str,
        action: &Action,
    ) -> Result<bool, Error> {
        let remote_actions = self.client.device_actions(token, &action.device_id).await?;
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
    async fn target_installed(&self, token: &str, action: &Action) -> Result<bool, Error> {
        let items = self.client.installed_apps(token, &action.device_id).await?;
        Ok(items.iter().any(|item| {
            inventory_matches(
                item,
                &action.app_id,
                &action.version_id,
                action.package_id.as_deref(),
            )
        }))
    }
    async fn mark_missing_action(&self, id: &str, action: &Action) -> Result<(), Error> {
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
    async fn expire_verification(&self, id: &str) -> Result<(), Error> {
        let action = self.saved_journal_action(id).await?;
        if action.state == State::Verifying && action.created_at + 900 < epoch() {
            self.journal
                .transition(id, State::Verifying, Transition::VerificationTimedOut)
                .await?;
        }
        Ok(())
    }
}

fn has_blocking_remote_action(actions: &[RemoteAction], app: &AvailableApp) -> bool {
    actions.iter().any(|action| {
        action_details_match(
            action.details.as_ref(),
            &app.id,
            &app.released_version_id,
            app.package_identifier.as_deref(),
        ) && remote_action_blocks_request(remote_state(&action.state))
    })
}

#[cfg(test)]
#[path = "actions_tests.rs"]
mod actions_tests;

#[cfg(test)]
#[path = "actions_submission_tests.rs"]
mod submission_tests;
