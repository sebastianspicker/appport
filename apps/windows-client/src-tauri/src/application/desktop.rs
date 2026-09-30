//! Session-scoped desktop operations: gate admission, generation fencing, and sign-in/out.

use crate::{
    application::{
        actions::ActionService,
        catalog::{CatalogService, LoadedCatalog},
        session::{self, SessionCoordinator},
        session_gate::{dispatch, SessionGate},
        support::{SupportService, SupportWorkflowError},
    },
    domain::{
        action::AppAction,
        catalog::{filter_catalog_view, CatalogView},
        support::{SupportBundleResult, SupportDetails},
    },
    error::Error,
    infrastructure::{
        logging, relution,
        windows::{notifications, platform, support, task},
    },
};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

pub(crate) struct DesktopService {
    client: Arc<relution::RelutionClient>,
    catalog: Arc<CatalogService>,
    actions: Arc<ActionService>,
    support: Arc<SupportService>,
    session: Mutex<SessionCoordinator>,
    session_gate: SessionGate,
    action_workflow: Arc<Mutex<()>>,
    initial_view: CatalogView,
}

/// A completed sign-in; scheduled-task registration is an additive partial outcome.
pub(crate) struct ConnectStarted {
    pub(crate) background_check_registered: bool,
}

/// Local cleanup results of a sign-out, which itself always completes.
pub(crate) struct SignOutOutcome {
    pub(crate) token_revocation_required: bool,
    pub(crate) credential_removed: bool,
    pub(crate) scheduled_task_removed: bool,
    pub(crate) notification_state_cleared: bool,
}

type GeneratedSessionCredential = (String, String, String, u64);

pub(crate) fn sign_in_completion_error(error: session::SignInCompletionError) -> Error {
    match error {
        session::SignInCompletionError::StaleCredential => {
            Error::session_expired("sign-in was superseded")
        }
        session::SignInCompletionError::Credential(error) => error,
    }
}

fn support_error(error: support::SupportError) -> Error {
    logging::write(error.code());
    error.into()
}

fn support_workflow_error(error: SupportWorkflowError) -> Error {
    match error {
        SupportWorkflowError::Client(error) => error,
        SupportWorkflowError::Support(error) => support_error(error),
    }
}

impl DesktopService {
    pub(crate) fn new(
        client: Arc<relution::RelutionClient>,
        catalog: Arc<CatalogService>,
        initial_view: CatalogView,
    ) -> Self {
        let actions = Arc::new(ActionService::new(
            Arc::clone(&client),
            Arc::clone(&catalog),
        ));
        let support = Arc::new(SupportService::new(Arc::clone(&catalog)));
        Self {
            client,
            catalog,
            actions,
            support,
            session: Mutex::new(SessionCoordinator::load()),
            session_gate: SessionGate::default(),
            action_workflow: Arc::new(Mutex::new(())),
            initial_view,
        }
    }

    async fn generated_session_credential(&self) -> Result<GeneratedSessionCredential, Error> {
        let session = self.session.lock().await;
        session
            .credential_with_generation()
            .ok_or_else(|| Error::session_expired("no stored session"))
    }

    async fn ensure_session_generation(
        &self,
        user_uuid: &str,
        generation: u64,
    ) -> Result<(), Error> {
        self.session
            .lock()
            .await
            .ensure_current(user_uuid, generation)
    }

    /// Signs in and registers the background check for `executable` when it is known.
    pub(crate) async fn connect_token(
        &self,
        username: String,
        token: String,
        executable: Option<PathBuf>,
    ) -> Result<ConnectStarted, Error> {
        self.connect_token_with(username, token, move || {
            executable
                .and_then(|path| task::register_background_check(&path).ok())
                .is_some()
        })
        .await
    }

    pub(crate) async fn connect_token_with(
        &self,
        username: String,
        token: String,
        register: impl FnOnce() -> bool,
    ) -> Result<ConnectStarted, Error> {
        let operation = self.session.lock().await.begin_sign_in();
        let identity = self.client.connect(&username, &token).await?;
        let _transition = self.session_gate.transition().await;
        let mut session = self.session.lock().await;
        session
            .finish_sign_in(operation, token, identity.username, identity.user_uuid)
            .map_err(sign_in_completion_error)?;
        if let Err(error) = self.catalog.invalidate_session(session.generation()) {
            logging::write(error);
        }
        // No await separates credential persistence and scheduled-task registration.
        Ok(ConnectStarted {
            background_check_registered: register(),
        })
    }

    pub(crate) async fn load_catalog(
        &self,
        view: CatalogView,
        force_refresh: bool,
    ) -> Result<LoadedCatalog, Error> {
        let (token, username, user_uuid, generation) = self.generated_session_credential().await?;
        let result = self
            .catalog
            .load_catalog(
                &token,
                &username,
                &user_uuid,
                generation,
                &platform::current_locale(),
                force_refresh,
            )
            .await?;
        self.ensure_session_generation(&user_uuid, generation)
            .await?;
        Ok(LoadedCatalog {
            bootstrap: result.bootstrap,
            rows: filter_catalog_view(result.rows, view),
            revision: result.revision,
        })
    }

    pub(crate) async fn request_deployment(
        self: &Arc<Self>,
        app_id: String,
    ) -> Result<AppAction, Error> {
        let workflow = Arc::clone(&self.action_workflow).lock_owned().await;
        let (token, _, user_uuid, generation) = self.generated_session_credential().await?;
        let prepared = self
            .actions
            .prepare_action(&token, &user_uuid, &app_id, &platform::current_locale())
            .await?;
        let state = Arc::clone(self);
        let permit = self.session_gate.admit().await;
        dispatch(permit, async move {
            let _workflow = workflow;
            state
                .session
                .lock()
                .await
                .ensure_current(&user_uuid, generation)?;
            let result = state.actions.submit_action(&token, prepared).await?;
            state
                .session
                .lock()
                .await
                .ensure_current(&user_uuid, generation)?;
            Ok(result)
        })
        .await
        .map_err(|_| Error::unknown("action task did not complete"))?
    }

    pub(crate) async fn get_action(&self, action_id: String) -> Result<AppAction, Error> {
        let _workflow = self.action_workflow.lock().await;
        let (token, _, user_uuid, generation) = self.generated_session_credential().await?;
        let result = self
            .actions
            .get_action(&token, &user_uuid, &action_id, generation)
            .await?;
        self.ensure_session_generation(&user_uuid, generation)
            .await?;
        Ok(result)
    }

    pub(crate) async fn load_app_icon(
        &self,
        app_id: String,
        catalog_revision: Option<String>,
    ) -> Result<Option<String>, Error> {
        let (token, _, user_uuid, generation) = self.generated_session_credential().await?;
        let result = self
            .catalog
            .icon_for_revision(
                &token,
                &user_uuid,
                &app_id,
                generation,
                &platform::current_locale(),
                catalog_revision.as_deref(),
            )
            .await?;
        self.ensure_session_generation(&user_uuid, generation)
            .await?;
        Ok(result)
    }

    pub(crate) async fn read_support_details(&self) -> Result<SupportDetails, Error> {
        let (token, username, user_uuid, generation) = self.generated_session_credential().await?;
        let result = self
            .support
            .details(&token, &username, &user_uuid, generation)
            .await?;
        self.session
            .lock()
            .await
            .confirm_support(&user_uuid, generation)?;
        Ok(result)
    }

    pub(crate) async fn write_support_bundle(
        self: &Arc<Self>,
        confirmed: bool,
    ) -> Result<SupportBundleResult, Error> {
        if !confirmed {
            return Err(support_error(support::SupportError::ConsentRequired));
        }
        let (token, username, user_uuid, generation) = self.generated_session_credential().await?;
        let request = self
            .support
            .prepare_bundle(&token, &username, &user_uuid, generation)
            .await
            .map_err(support_workflow_error)?;
        self.write_confirmed_bundle(
            &user_uuid,
            generation,
            request,
            support::generate_support_bundle,
        )
        .await
    }

    pub(crate) async fn write_confirmed_bundle(
        self: &Arc<Self>,
        user_uuid: &str,
        generation: u64,
        request: support::SupportBundleRequest,
        writer: impl FnOnce(
                &support::SupportBundleRequest,
            ) -> Result<SupportBundleResult, support::SupportError>
            + Send
            + 'static,
    ) -> Result<SupportBundleResult, Error> {
        let state = Arc::clone(self);
        let user_uuid = user_uuid.to_owned();
        let permit = self.session_gate.admit().await;
        dispatch(permit, async move {
            {
                let mut session = state.session.lock().await;
                session.ensure_current(&user_uuid, generation)?;
                if !session.consume_support_confirmation(generation) {
                    return Err(support_error(support::SupportError::ConsentRequired));
                }
            }
            tokio::task::spawn_blocking(move || writer(&request))
                .await
                .map_err(|_| support_error(support::SupportError::AssemblyFailed))?
                .map_err(support_error)
        })
        .await
        .map_err(|_| support_error(support::SupportError::AssemblyFailed))?
    }

    pub(crate) async fn open_support_folder(&self) -> Result<(), Error> {
        let _ = self.generated_session_credential().await?;
        support::open_support_folder().map_err(support_error)
    }

    pub(crate) async fn sign_out_current(&self) -> SignOutOutcome {
        self.sign_out_with_cleanup(|| {
            (
                task::remove_background_check().is_ok(),
                notifications::clear_state().is_ok(),
            )
        })
        .await
    }

    pub(crate) async fn sign_out_with_cleanup(
        &self,
        cleanup: impl FnOnce() -> (bool, bool),
    ) -> SignOutOutcome {
        let _transition = self.session_gate.transition().await;
        let mut session = self.session.lock().await;
        let invalidated = session.sign_out();
        if let Err(error) = self.catalog.invalidate_session(session.generation()) {
            logging::write(error);
        }
        let (scheduled_task_removed, notification_state_cleared) = cleanup();
        SignOutOutcome {
            token_revocation_required: invalidated.token_revocation_required,
            credential_removed: invalidated.credential_removed,
            scheduled_task_removed,
            notification_state_cleared,
        }
    }

    pub(crate) fn initial_view(&self) -> CatalogView {
        self.initial_view
    }
}

/// Opens the fixed Relution origin embedded in this build.
pub(crate) fn open_relution_portal() -> Result<(), Error> {
    let config = relution::RelutionConfig::embedded()?;
    platform::open_relution_portal(&config.base)
}

#[cfg(all(test, not(windows)))]
#[path = "desktop_coordination_tests.rs"]
mod coordination_tests;

#[cfg(all(test, not(windows)))]
#[path = "desktop_deployment_tests.rs"]
mod deployment_tests;

#[cfg(all(test, not(windows)))]
#[path = "desktop_test_support.rs"]
mod test_support;
