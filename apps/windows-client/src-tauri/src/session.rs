#[derive(Default)]
pub struct SessionStore {
    bearer: Option<String>,
}
impl SessionStore {
    pub fn load() -> Self {
        Self {
            bearer: credential::load(),
        }
    }
    pub fn bearer(&self) -> Option<&str> {
        self.bearer.as_deref()
    }
    pub fn save(&mut self, value: String) -> Result<(), String> {
        credential::save(&value)?;
        self.bearer = Some(value);
        Ok(())
    }
    pub fn clear(&mut self) -> Result<(), String> {
        credential::clear()?;
        self.bearer = None;
        Ok(())
    }
}
#[cfg(windows)]
mod credential {
    use windows::{
        core::PCWSTR,
        Win32::Security::Credentials::{
            CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    const TARGET: &str = "Appport/Bearer";
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn load() -> Option<String> {
        unsafe {
            let target = wide(TARGET);
            let mut credential = std::ptr::null_mut();
            if CredReadW(
                PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                0,
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
            let value = String::from_utf8(bytes.to_vec()).ok();
            CredFree(Some(credential.cast()));
            value
        }
    }
    pub fn save(value: &str) -> Result<(), String> {
        if value.is_empty() || value.len() > 4096 {
            return Err("unknown: invalid session value".into());
        }
        unsafe {
            let target = wide(TARGET);
            let mut bytes = value.as_bytes().to_vec();
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: windows::core::PWSTR(target.as_ptr() as *mut _),
                CredentialBlobSize: bytes.len() as u32,
                CredentialBlob: windows::core::PSTR(bytes.as_mut_ptr()),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                UserName: windows::core::PWSTR::null(),
                Comment: windows::core::PWSTR::null(),
                TargetAlias: windows::core::PWSTR::null(),
                AttributeCount: 0,
                Attributes: std::ptr::null_mut(),
                Flags: 0,
            };
            CredWriteW(&credential, 0)
                .map_err(|_| "unknown: Windows Credential Manager could not save session".into())
        }
    }
    pub fn clear() -> Result<(), String> {
        use windows::Win32::Foundation::ERROR_NOT_FOUND;
        use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
        unsafe {
            let target = wide(TARGET);
            match CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, 0) {
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
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn clearing_an_absent_credential_is_idempotent() {
        let mut session = SessionStore::load();
        assert!(session.clear().is_ok());
        assert!(session.bearer().is_none());
    }
}
#[cfg(not(windows))]
mod credential {
    pub fn load() -> Option<String> {
        None
    }
    pub fn save(_: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn clear() -> Result<(), String> {
        Ok(())
    }
}
