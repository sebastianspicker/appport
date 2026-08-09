#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct CredentialRecord {
    version: u8,
    access_token: String,
    username: String,
    user_uuid: String,
}

fn credential_input_is_valid(access_token: &str, username: &str, user_uuid: &str) -> bool {
    if access_token.is_empty() || access_token.len() > 4096 {
        return false;
    }
    !username.is_empty() && !user_uuid.is_empty()
}

fn migration_result(
    current_bytes: Option<&[u8]>,
    obsolete_present: bool,
) -> (Option<CredentialRecord>, bool) {
    let current = current_bytes
        .and_then(|value| serde_json::from_slice::<CredentialRecord>(value).ok())
        .filter(|value| {
            value.version == 1
                && !value.access_token.is_empty()
                && !value.username.is_empty()
                && !value.user_uuid.is_empty()
        });
    let remove_obsolete = current.is_some() || obsolete_present;
    (current, remove_obsolete)
}
#[derive(Default)]
pub struct SessionStore {
    credential: Option<CredentialRecord>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignInOperation(u64);

pub struct SignOutSnapshot {
    pub access_token: Option<String>,
    pub credential_removed: bool,
}

pub struct SessionCoordinator {
    store: SessionStore,
    generation: u64,
}

pub enum SignInCompletionError {
    StaleCredential(String),
    Credential(String),
}

impl SessionStore {
    pub fn load() -> Self {
        Self {
            credential: credential::load(),
        }
    }
    pub fn credential(&self) -> Option<(String, String, String)> {
        self.credential.as_ref().map(|value| {
            (
                value.access_token.clone(),
                value.username.clone(),
                value.user_uuid.clone(),
            )
        })
    }
    pub fn save(
        &mut self,
        access_token: String,
        username: String,
        user_uuid: String,
    ) -> Result<(), String> {
        if !credential_input_is_valid(&access_token, &username, &user_uuid) {
            return Err("unknown: invalid Relution credential".into());
        }
        let record = CredentialRecord {
            version: 1,
            access_token,
            username,
            user_uuid,
        };
        credential::save(&record)?;
        self.credential = Some(record);
        Ok(())
    }
    fn take_access_token(&mut self) -> Option<String> {
        self.credential.take().map(|record| record.access_token)
    }
    fn clear_credential(&self) -> Result<(), String> {
        credential::clear()
    }
}

impl SessionCoordinator {
    pub fn load() -> Self {
        let store = SessionStore::load();
        let generation = u64::from(store.credential().is_some());
        Self { store, generation }
    }

    pub fn credential(&self) -> Option<(String, String, String)> {
        self.store.credential()
    }

    pub fn credential_with_generation(&self) -> Option<(String, String, String, u64)> {
        self.store
            .credential()
            .map(|(token, username, user_uuid)| (token, username, user_uuid, self.generation))
    }

    pub fn begin_sign_in(&mut self) -> SignInOperation {
        self.generation = self.generation.wrapping_add(1);
        SignInOperation(self.generation)
    }

    pub fn finish_sign_in(
        &mut self,
        operation: SignInOperation,
        access_token: String,
        username: String,
        user_uuid: String,
    ) -> Result<(), SignInCompletionError> {
        if operation.0 != self.generation {
            return Err(SignInCompletionError::StaleCredential(access_token));
        }
        self.store
            .save(access_token, username, user_uuid)
            .map_err(|error| {
                self.generation = self.generation.wrapping_add(1);
                SignInCompletionError::Credential(error)
            })
    }

    pub fn sign_out(&mut self) -> SignOutSnapshot {
        self.generation = self.generation.wrapping_add(1);
        let access_token = self.store.take_access_token();
        let credential_removed = self.store.clear_credential().is_ok();
        SignOutSnapshot {
            access_token,
            credential_removed,
        }
    }
}
#[cfg(windows)]
mod credential {
    use super::CredentialRecord;
    use windows::{
        core::PCWSTR,
        Win32::Security::Credentials::{
            CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    const TARGET: &str = "Relution/Appport/v1";
    fn obsolete_target() -> String {
        ["Appport", "Bearer"].join("/")
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    fn read(target_name: &str) -> Option<Vec<u8>> {
        unsafe {
            let target = wide(target_name);
            let mut credential = std::ptr::null_mut();
            if CredReadW(
                PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut credential,
            )
            .is_err()
            {
                return None;
            }
            let bytes = std::slice::from_raw_parts(
                (*credential).CredentialBlob,
                (*credential).CredentialBlobSize as usize,
            );
            let value = bytes.to_vec();
            CredFree(credential.cast());
            Some(value)
        }
    }
    pub fn load() -> Option<CredentialRecord> {
        let obsolete_target = obsolete_target();
        let current_bytes = read(TARGET);
        let obsolete_present = read(&obsolete_target).is_some();
        let (current, remove_obsolete) =
            super::migration_result(current_bytes.as_deref(), obsolete_present);
        // The unversioned bearer record is deliberately never accepted. Delete it only
        // after the versioned record is available, or when it is the sole obsolete item.
        if remove_obsolete {
            let _ = delete(&obsolete_target);
        }
        current
    }
    pub fn save(value: &CredentialRecord) -> Result<(), String> {
        let mut bytes =
            serde_json::to_vec(value).map_err(|_| "unknown: invalid Relution credential")?;
        unsafe {
            let target = wide(TARGET);
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: windows::core::PWSTR(target.as_ptr() as *mut _),
                CredentialBlobSize: bytes.len() as u32,
                CredentialBlob: bytes.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..Default::default()
            };
            CredWriteW(&credential, 0)
                .map_err(|_| "unknown: Windows Credential Manager could not save session".into())
        }
    }
    fn delete(target_name: &str) -> Result<(), String> {
        use windows::Win32::Foundation::ERROR_NOT_FOUND;
        use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
        unsafe {
            let target = wide(target_name);
            match CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) {
                Ok(()) => Ok(()),
                Err(error)
                    if error.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) =>
                {
                    Ok(())
                }
                Err(_) => {
                    Err("unknown: Windows Credential Manager could not delete session".into())
                }
            }
        }
    }
    pub fn clear() -> Result<(), String> {
        delete(TARGET)?;
        delete(&obsolete_target())
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[test]
    fn credential_manager_migration_never_accepts_the_obsolete_bearer() {
        let current = CredentialRecord {
            version: 1,
            access_token: "token".into(),
            username: "user".into(),
            user_uuid: "uuid".into(),
        };
        let bytes = serde_json::to_vec(&current).unwrap();
        assert_eq!(migration_result(Some(&bytes), true), (Some(current), true));
        assert_eq!(migration_result(None, true), (None, true));
        assert_eq!(migration_result(Some(b"not-json"), true), (None, true));
        assert_eq!(migration_result(None, false), (None, false));
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[test]
    fn clearing_an_absent_credential_is_idempotent() {
        let mut session = SessionCoordinator::load();
        assert!(session.sign_out().credential_removed);
        assert!(session.credential().is_none());
    }

    #[test]
    fn a_new_sign_in_invalidates_a_previous_handoff() {
        let mut session = SessionCoordinator::load();
        let first = session.begin_sign_in();
        let second = session.begin_sign_in();
        assert!(matches!(
            session.finish_sign_in(first, "stale".into(), "user".into(), "uuid".into()),
            Err(SignInCompletionError::StaleCredential(token)) if token == "stale"
        ));
        assert!(session
            .finish_sign_in(second, "current".into(), "user".into(), "uuid".into())
            .is_ok());
        assert_eq!(
            session.credential().map(|value| value.0),
            Some("current".into())
        );
    }

    #[test]
    fn sign_out_invalidates_an_in_flight_handoff_before_revocation() {
        let mut session = SessionCoordinator::load();
        let operation = session.begin_sign_in();
        let snapshot = session.sign_out();
        assert!(snapshot.access_token.is_none());
        assert!(matches!(
            session.finish_sign_in(operation, "stale".into(), "user".into(), "uuid".into()),
            Err(SignInCompletionError::StaleCredential(token)) if token == "stale"
        ));
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

            let credential = { session.lock().await.credential() };
            assert_eq!(credential.map(|value| value.0), Some("token".into()));

            let _guard = tokio::time::timeout(std::time::Duration::from_millis(50), session.lock())
                .await
                .expect("network work must not retain the session mutex");
        });
    }
}
#[cfg(not(windows))]
mod credential {
    use super::CredentialRecord;
    pub fn load() -> Option<CredentialRecord> {
        None
    }
    pub fn save(_: &CredentialRecord) -> Result<(), String> {
        Ok(())
    }
    pub fn clear() -> Result<(), String> {
        Ok(())
    }
}
