//! Windows Credential Manager persistence for Relution sessions.

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct CredentialRecord {
    version: u8,
    access_token: String,
    username: String,
    user_uuid: String,
}

impl CredentialRecord {
    pub(crate) fn new(
        access_token: String,
        username: String,
        user_uuid: String,
    ) -> Result<Self, String> {
        if access_token.is_empty()
            || access_token.len() > 4096
            || username.is_empty()
            || user_uuid.is_empty()
        {
            return Err("unknown: invalid Relution credential".into());
        }
        Ok(Self {
            version: 1,
            access_token,
            username,
            user_uuid,
        })
    }

    pub(crate) fn snapshot(&self) -> (String, String, String) {
        (
            self.access_token.clone(),
            self.username.clone(),
            self.user_uuid.clone(),
        )
    }

    pub(crate) fn into_access_token(self) -> String {
        self.access_token
    }
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

#[cfg(windows)]
const TARGET: &str = "Relution/Appport/v1";

#[cfg(windows)]
fn obsolete_target() -> String {
    ["Appport", "Bearer"].join("/")
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

#[cfg(windows)]
struct CredentialGuard(std::ptr::NonNull<windows::Win32::Security::Credentials::CREDENTIALW>);

#[cfg(windows)]
impl CredentialGuard {
    fn new(credential: *mut windows::Win32::Security::Credentials::CREDENTIALW) -> Option<Self> {
        std::ptr::NonNull::new(credential).map(Self)
    }

    fn credential(&self) -> &windows::Win32::Security::Credentials::CREDENTIALW {
        // SAFETY: CredReadW returned this non-null pointer and the guard keeps the
        // allocation alive until after this borrowed credential is no longer used.
        unsafe { self.0.as_ref() }
    }
}

#[cfg(windows)]
impl Drop for CredentialGuard {
    fn drop(&mut self) {
        // SAFETY: CredentialGuard is constructed only from a non-null pointer
        // returned by CredReadW, which must be released with CredFree exactly once.
        unsafe { windows::Win32::Security::Credentials::CredFree(self.0.as_ptr().cast()) };
    }
}

#[cfg(windows)]
fn read(target_name: &str) -> Option<Vec<u8>> {
    use windows::{
        core::PCWSTR,
        Win32::Security::Credentials::{CredReadW, CRED_TYPE_GENERIC},
    };

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

#[cfg(windows)]
fn write(target_name: &str, mut bytes: Vec<u8>) -> Result<(), String> {
    use windows::{
        core::PWSTR,
        Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    unsafe {
        let target = wide(target_name);
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_ptr() as *mut _),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        CredWriteW(&credential, 0)
            .map_err(|_| "unknown: Windows Credential Manager could not save session".into())
    }
}

#[cfg(windows)]
fn delete(target_name: &str) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
        },
    };

    unsafe {
        let target = wide(target_name);
        match CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) => {
                Ok(())
            }
            Err(_) => Err("unknown: Windows Credential Manager could not delete session".into()),
        }
    }
}

#[cfg(windows)]
pub(crate) fn load() -> Option<CredentialRecord> {
    let obsolete_target = obsolete_target();
    let current_bytes = read(TARGET);
    let obsolete_present = read(&obsolete_target).is_some();
    let (current, remove_obsolete) = migration_result(current_bytes.as_deref(), obsolete_present);
    // The unversioned bearer record is deliberately never accepted. Delete it only
    // after the versioned record is available, or when it is the sole obsolete item.
    if remove_obsolete {
        let _ = delete(&obsolete_target);
    }
    current
}

#[cfg(windows)]
pub(crate) fn save(value: &CredentialRecord) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "unknown: invalid Relution credential")?;
    write(TARGET, bytes)
}

#[cfg(windows)]
pub(crate) fn clear() -> Result<(), String> {
    delete(TARGET)?;
    delete(&obsolete_target())
}

#[cfg(windows)]
pub(crate) fn qualification_credential_self_check() -> Result<(), String> {
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

#[cfg(not(windows))]
pub(crate) fn load() -> Option<CredentialRecord> {
    None
}

#[cfg(not(windows))]
pub(crate) fn save(_: &CredentialRecord) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn clear() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn qualification_credential_self_check() -> Result<(), String> {
    Err("unknown: Windows Credential Manager is unavailable".into())
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::{migration_result, CredentialRecord};

    #[test]
    fn credential_manager_migration_never_accepts_the_obsolete_bearer() {
        let current = CredentialRecord::new("token".into(), "user".into(), "uuid".into()).unwrap();
        let bytes = serde_json::to_vec(&current).unwrap();
        assert_eq!(migration_result(Some(&bytes), true), (Some(current), true));
        assert_eq!(migration_result(None, true), (None, true));
        assert_eq!(migration_result(Some(b"not-json"), true), (None, true));
        assert_eq!(migration_result(None, false), (None, false));
    }
}

#[cfg(test)]
mod credential_blob_tests {
    use super::credential_blob_bytes;

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
