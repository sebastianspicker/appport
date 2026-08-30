//! Credential lifecycle and generation-fenced session coordination.

use crate::infrastructure::windows::credentials;

#[derive(Default)]
pub struct SessionStore {
    credential: Option<credentials::CredentialRecord>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignInOperation(u64);

pub struct SignOutSnapshot {
    pub token_revocation_required: bool,
    pub credential_removed: bool,
}

pub struct SessionCoordinator {
    store: SessionStore,
    active_generation: u64,
    sign_in_generation: u64,
    token_revocation_pending: bool,
}

#[derive(Debug)]
pub enum SignInCompletionError {
    StaleCredential,
    Credential(String),
}

impl SessionStore {
    pub fn load() -> Self {
        Self {
            credential: credentials::load(),
        }
    }

    pub fn credential(&self) -> Option<(String, String, String)> {
        self.credential
            .as_ref()
            .map(credentials::CredentialRecord::snapshot)
    }

    pub fn save(
        &mut self,
        access_token: String,
        username: String,
        user_uuid: String,
    ) -> Result<(), String> {
        let record = credentials::CredentialRecord::new(access_token, username, user_uuid)?;
        credentials::save(&record)?;
        self.credential = Some(record);
        Ok(())
    }

    fn take_access_token(&mut self) -> Option<String> {
        self.credential
            .take()
            .map(credentials::CredentialRecord::into_access_token)
    }

    fn clear_credential(&self) -> Result<(), String> {
        credentials::clear()
    }
}

impl SessionCoordinator {
    pub fn load() -> Self {
        let store = SessionStore::load();
        let generation = u64::from(store.credential().is_some());
        Self {
            store,
            active_generation: generation,
            sign_in_generation: generation,
            token_revocation_pending: false,
        }
    }

    pub fn credential(&self) -> Option<(String, String, String)> {
        self.store.credential()
    }

    pub fn credential_with_generation(&self) -> Option<(String, String, String, u64)> {
        self.store.credential().map(|(token, username, user_uuid)| {
            (token, username, user_uuid, self.active_generation)
        })
    }

    pub fn begin_sign_in(&mut self) -> SignInOperation {
        self.sign_in_generation = self.sign_in_generation.wrapping_add(1);
        SignInOperation(self.sign_in_generation)
    }

    pub fn finish_sign_in(
        &mut self,
        operation: SignInOperation,
        access_token: String,
        username: String,
        user_uuid: String,
    ) -> Result<(), SignInCompletionError> {
        if operation.0 != self.sign_in_generation {
            drop(access_token);
            return Err(SignInCompletionError::StaleCredential);
        }
        self.store
            .save(access_token, username, user_uuid)
            .map_err(|error| {
                self.sign_in_generation = self.sign_in_generation.wrapping_add(1);
                SignInCompletionError::Credential(error)
            })?;
        self.active_generation = self.active_generation.wrapping_add(1);
        Ok(())
    }

    pub fn sign_out(&mut self) -> SignOutSnapshot {
        let clear_result = self.store.clear_credential();
        self.sign_out_with_clear_result(clear_result)
    }

    fn sign_out_with_clear_result(&mut self, clear_result: Result<(), String>) -> SignOutSnapshot {
        self.sign_in_generation = self.sign_in_generation.wrapping_add(1);
        self.active_generation = self.active_generation.wrapping_add(1);
        if self.store.take_access_token().is_some() {
            self.token_revocation_pending = true;
        }
        let credential_removed = clear_result.is_ok();
        let token_revocation_required = self.token_revocation_pending;
        if credential_removed {
            self.token_revocation_pending = false;
        }
        SignOutSnapshot {
            token_revocation_required,
            credential_removed,
        }
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::{SessionCoordinator, SignInCompletionError};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[test]
    fn clearing_an_absent_credential_is_idempotent() {
        let mut session = SessionCoordinator::load();
        assert!(session.sign_out().credential_removed);
        assert!(session.credential().is_none());
    }

    #[test]
    fn a_new_sign_in_discards_stale_credential_and_advances_active_generation_once() {
        let mut session = SessionCoordinator::load();
        let first = session.begin_sign_in();
        let second = session.begin_sign_in();
        assert!(matches!(
            session.finish_sign_in(first, "stale".into(), "user".into(), "uuid".into()),
            Err(SignInCompletionError::StaleCredential)
        ));
        assert!(session.credential().is_none());
        assert!(session
            .finish_sign_in(second, "current".into(), "user".into(), "uuid".into())
            .is_ok());
        assert_eq!(
            session.credential_with_generation(),
            Some(("current".into(), "user".into(), "uuid".into(), 1))
        );
    }

    #[test]
    fn pending_replacement_does_not_relabel_the_active_credential() {
        let mut session = SessionCoordinator::load();
        let first = session.begin_sign_in();
        session
            .finish_sign_in(first, "first".into(), "user".into(), "uuid".into())
            .unwrap();
        assert_eq!(session.credential_with_generation().unwrap().3, 1);

        let replacement = session.begin_sign_in();
        assert_eq!(session.credential_with_generation().unwrap().3, 1);
        session
            .finish_sign_in(
                replacement,
                "second".into(),
                "other".into(),
                "other-uuid".into(),
            )
            .unwrap();
        assert_eq!(session.credential_with_generation().unwrap().3, 2);
    }

    #[test]
    fn sign_out_invalidates_an_in_flight_handoff_before_revocation() {
        let mut session = SessionCoordinator::load();
        let operation = session.begin_sign_in();
        let snapshot = session.sign_out();
        assert!(!snapshot.token_revocation_required);
        assert!(matches!(
            session.finish_sign_in(operation, "stale".into(), "user".into(), "uuid".into()),
            Err(SignInCompletionError::StaleCredential)
        ));
        assert!(session.credential().is_none());
    }

    #[test]
    fn retry_keeps_revocation_guidance_after_credential_deletion_failure() {
        let mut session = SessionCoordinator::load();
        let operation = session.begin_sign_in();
        session
            .finish_sign_in(operation, "token".into(), "user".into(), "uuid".into())
            .unwrap();

        let first = session.sign_out_with_clear_result(Err("delete failed".into()));
        assert!(!first.credential_removed);
        assert!(first.token_revocation_required);
        assert!(session.credential().is_none());

        let second = session.sign_out_with_clear_result(Ok(()));
        assert!(second.credential_removed);
        assert!(second.token_revocation_required);
        assert!(session.credential().is_none());

        let third = session.sign_out_with_clear_result(Ok(()));
        assert!(!third.token_revocation_required);
    }

    #[test]
    fn a_bearer_snapshot_does_not_hold_the_session_lock_during_network_work() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let session = Arc::new(Mutex::new(SessionCoordinator::load()));
            let operation = session.lock().await.begin_sign_in();
            assert!(session
                .lock()
                .await
                .finish_sign_in(operation, "token".into(), "user".into(), "uuid".into())
                .is_ok());

            let credential = { session.lock().await.credential_with_generation() };
            assert_eq!(
                credential,
                Some(("token".into(), "user".into(), "uuid".into(), operation.0))
            );

            let _guard = tokio::time::timeout(std::time::Duration::from_millis(50), session.lock())
                .await
                .expect("network work must not retain the session mutex");
        });
    }
}
