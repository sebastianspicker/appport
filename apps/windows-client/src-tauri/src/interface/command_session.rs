//! Generation-checked support publication and ordered sign-out cleanup.

use super::{
    connect_started, generated_session_credential, native_error, sign_in_completion_error,
    AppState, NativeError,
};
use crate::{
    infrastructure::{
        logging,
        windows::{notifications, support, task},
    },
    interface::wire,
};

impl AppState {
    pub(super) async fn connect_token(
        &self,
        username: String,
        token: String,
        register: impl FnOnce() -> bool,
    ) -> Result<wire::ConnectStarted, NativeError> {
        let operation = self.session.lock().await.begin_sign_in();
        let identity = self
            .client
            .connect(&username, &token)
            .await
            .map_err(native_error)?;
        let _transition = self.session_gate.transition().await;
        let mut session = self.session.lock().await;
        session
            .finish_sign_in(operation, token, identity.username, identity.user_uuid)
            .map_err(sign_in_completion_error)?;
        if let Err(error) = self.catalog.invalidate_session(session.generation()) {
            logging::write(&error);
        }
        // No await separates credential persistence and scheduled-task registration.
        Ok(connect_started(register()))
    }

    pub(super) async fn read_support_details(
        &self,
    ) -> Result<support::SupportDetails, NativeError> {
        let (token, username, user_uuid, generation) = generated_session_credential(self).await?;
        let result = self
            .support
            .details(&token, &username, &user_uuid, generation)
            .await
            .map_err(native_error)?;
        self.session
            .lock()
            .await
            .confirm_support(&user_uuid, generation)
            .map_err(native_error)?;
        Ok(result)
    }

    pub(super) async fn sign_out_current(&self) -> wire::SignOutOutcome {
        self.sign_out_with_cleanup(|| {
            (
                task::remove_background_check().is_ok(),
                notifications::clear_state().is_ok(),
            )
        })
        .await
    }

    pub(super) async fn sign_out_with_cleanup(
        &self,
        cleanup: impl FnOnce() -> (bool, bool),
    ) -> wire::SignOutOutcome {
        let _transition = self.session_gate.transition().await;
        let mut session = self.session.lock().await;
        let invalidated = session.sign_out();
        if let Err(error) = self.catalog.invalidate_session(session.generation()) {
            logging::write(&error);
        }
        let (scheduled_task_removed, notification_state_cleared) = cleanup();
        wire::SignOutOutcome {
            token_revocation_required: invalidated.token_revocation_required,
            credential_removed: invalidated.credential_removed,
            scheduled_task_removed,
            notification_state_cleared,
        }
    }
}
