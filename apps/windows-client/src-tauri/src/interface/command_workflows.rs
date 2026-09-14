//! Owned durable operations admitted after their remote preflight reads.

use super::{
    generated_session_credential, native_error, support_error, support_workflow_error, AppState,
    NativeError,
};
use crate::{
    application::session_gate::dispatch,
    domain::action::AppAction,
    infrastructure::windows::{platform, support},
};
use std::sync::Arc;

impl AppState {
    pub(super) async fn request_deployment(
        self: &Arc<Self>,
        app_id: String,
    ) -> Result<AppAction, NativeError> {
        let workflow = Arc::clone(&self.action_workflow).lock_owned().await;
        let (token, _, user_uuid, generation) = generated_session_credential(self).await?;
        let prepared = self
            .actions
            .prepare_action(&token, &user_uuid, &app_id, &platform::current_locale())
            .await
            .map_err(native_error)?;
        let state = Arc::clone(self);
        let permit = self.session_gate.admit().await;
        dispatch(permit, async move {
            let _workflow = workflow;
            state
                .session
                .lock()
                .await
                .ensure_current(&user_uuid, generation)
                .map_err(native_error)?;
            let result = state
                .actions
                .submit_action(&token, prepared)
                .await
                .map_err(native_error)?;
            state
                .session
                .lock()
                .await
                .ensure_current(&user_uuid, generation)
                .map_err(native_error)?;
            Ok(result)
        })
        .await
        .map_err(|_| native_error("unknown: action task did not complete".into()))?
    }

    pub(super) async fn write_support_bundle(
        self: &Arc<Self>,
        confirmed: bool,
    ) -> Result<support::SupportBundleResult, NativeError> {
        if !confirmed {
            return Err(support_error(support::SupportError::ConsentRequired));
        }
        let (token, username, user_uuid, generation) = generated_session_credential(self).await?;
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

    pub(super) async fn write_confirmed_bundle(
        self: &Arc<Self>,
        user_uuid: &str,
        generation: u64,
        request: support::SupportBundleRequest,
        writer: impl FnOnce(
                &support::SupportBundleRequest,
            ) -> Result<support::SupportBundleResult, support::SupportError>
            + Send
            + 'static,
    ) -> Result<support::SupportBundleResult, NativeError> {
        let state = Arc::clone(self);
        let user_uuid = user_uuid.to_owned();
        let permit = self.session_gate.admit().await;
        dispatch(permit, async move {
            {
                let mut session = state.session.lock().await;
                session
                    .ensure_current(&user_uuid, generation)
                    .map_err(native_error)?;
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
}
