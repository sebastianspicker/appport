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

#[cfg(any(windows, test))]
unsafe fn credential_blob_bytes(blob: *const u8, blob_size: u32) -> Option<Vec<u8>> {
    let blob_size = blob_size as usize;
    if blob_size == 0 {
        return Some(Vec::new());
    }
    let blob = std::ptr::NonNull::new(blob as *mut u8)?;
    // SAFETY: The caller guarantees that a non-empty CredentialBlob points to
    // CredentialBlobSize readable bytes for the lifetime of this copy.
    Some(unsafe { std::slice::from_raw_parts(blob.as_ptr(), blob_size).to_vec() })
}

#[derive(Default)]
pub struct SessionStore {
    credential: Option<CredentialRecord>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignInOperation(u64);

pub struct SignOutSnapshot {
    pub token_revocation_required: bool,
    pub credential_removed: bool,
}

pub struct SessionCoordinator {
    store: SessionStore,
    generation: u64,
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
        Self {
            store,
            generation,
            token_revocation_pending: false,
        }
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
            drop(access_token);
            return Err(SignInCompletionError::StaleCredential);
        }
        self.store
            .save(access_token, username, user_uuid)
            .map_err(|error| {
                self.generation = self.generation.wrapping_add(1);
                SignInCompletionError::Credential(error)
            })
    }

    pub fn sign_out(&mut self) -> SignOutSnapshot {
        let clear_result = self.store.clear_credential();
        self.sign_out_with_clear_result(clear_result)
    }

    fn sign_out_with_clear_result(&mut self, clear_result: Result<(), String>) -> SignOutSnapshot {
        self.generation = self.generation.wrapping_add(1);
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
#[cfg(windows)]
mod credential {
    use super::{credential_blob_bytes, CredentialRecord};
    use std::ptr::NonNull;
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

    struct CredentialGuard(NonNull<CREDENTIALW>);

    impl CredentialGuard {
        fn new(credential: *mut CREDENTIALW) -> Option<Self> {
            NonNull::new(credential).map(Self)
        }

        fn credential(&self) -> &CREDENTIALW {
            // SAFETY: CredReadW returned this non-null pointer and the guard keeps the
            // allocation alive until after this borrowed credential is no longer used.
            unsafe { self.0.as_ref() }
        }
    }

    impl Drop for CredentialGuard {
        fn drop(&mut self) {
            // SAFETY: CredentialGuard is constructed only from a non-null pointer
            // returned by CredReadW, which must be released with CredFree exactly once.
            unsafe { CredFree(self.0.as_ptr().cast()) };
        }
    }

    pub(super) fn read(target_name: &str) -> Option<Vec<u8>> {
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
            let credential = CredentialGuard::new(credential)?;
            let credential = credential.credential();
            credential_blob_bytes(credential.CredentialBlob, credential.CredentialBlobSize)
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
    fn write(target_name: &str, mut bytes: Vec<u8>) -> Result<(), String> {
        unsafe {
            let target = wide(target_name);
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
    pub fn save(value: &CredentialRecord) -> Result<(), String> {
        let bytes =
            serde_json::to_vec(value).map_err(|_| "unknown: invalid Relution credential")?;
        write(TARGET, bytes)
    }
    pub(super) fn delete(target_name: &str) -> Result<(), String> {
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

    pub(super) fn qualification_self_check() -> Result<(), String> {
        let target = format!(
            "Relution/Appport/qualification-self-check-{}",
            std::process::id()
        );
        let bytes = br#"{"version":1,"probe":"non-secret"}"#.to_vec();
        let result = write(&target, bytes.clone()).and_then(|_| {
            (read(&target).as_deref() == Some(bytes.as_slice()))
                .then_some(())
                .ok_or_else(|| "unknown: qualification credential round-trip failed".into())
        });
        let cleanup = delete(&target).and_then(|_| {
            read(&target)
                .is_none()
                .then_some(())
                .ok_or_else(|| "unknown: qualification credential remains".into())
        });
        result.and(cleanup)
    }
}

#[cfg(windows)]
pub fn qualification_credential_self_check() -> Result<(), String> {
    credential::qualification_self_check()
}

#[cfg(not(windows))]
pub fn qualification_credential_self_check() -> Result<(), String> {
    Err("unknown: Windows Credential Manager is unavailable".into())
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

#[cfg(test)]
mod credential_blob_tests {
    use super::*;

    #[test]
    fn credential_blob_reader_accepts_empty_null_blobs_and_rejects_nonempty_null_blobs() {
        // SAFETY: A zero-length blob is never dereferenced.
        assert_eq!(
            unsafe { credential_blob_bytes(std::ptr::null(), 0) },
            Some(vec![])
        );
        // SAFETY: A non-empty null blob is rejected before dereferencing.
        assert_eq!(unsafe { credential_blob_bytes(std::ptr::null(), 1) }, None);
    }

    #[test]
    fn credential_blob_reader_copies_nonempty_blobs() {
        let blob = [1, 2, 3];
        // SAFETY: blob is valid and readable for its full length during the copy.
        assert_eq!(
            unsafe { credential_blob_bytes(blob.as_ptr(), blob.len() as u32) },
            Some(blob.to_vec())
        );
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
    fn a_new_sign_in_discards_stale_credential_and_preserves_generation() {
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
            Some(("current".into(), "user".into(), "uuid".into(), second.0))
        );
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
