//! Current-user-only ACLs and reparse-safe path validation.

use crate::error::Error;
use std::path::Path;

pub(crate) fn validate_not_reparse(path: &Path) -> Result<(), Error> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| Error::unknown("protected path is unavailable"))?;
    if metadata.file_type().is_symlink() {
        return Err(Error::unknown("protected path is a reparse point"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Error::unknown("protected path is a reparse point"));
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn secure_current_user(path: &Path) -> Result<(), Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::{
            Foundation::{ERROR_SUCCESS, HANDLE},
            Security::{
                Authorization::{
                    SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, SET_ACCESS,
                    SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
                },
                DACL_SECURITY_INFORMATION, NO_INHERITANCE, PROTECTED_DACL_SECURITY_INFORMATION,
                SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_QUERY, TOKEN_USER,
            },
            Storage::FileSystem::FILE_ALL_ACCESS,
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        },
    };

    validate_not_reparse(path)?;
    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut token = HANDLE::default();
    // SAFETY: token is an out-parameter for the current process pseudo-handle.
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|_| Error::unknown("current-user security identity is unavailable"))?;
    let token = TokenHandle(token);
    let sid_buffer = token_user(&token)?;
    // SAFETY: GetTokenInformation populated a TOKEN_USER at the start of this
    // aligned buffer and its SID remains valid until SetNamedSecurityInfoW returns.
    let sid = unsafe { (*(sid_buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let inheritance = if path.is_dir() {
        SUB_CONTAINERS_AND_OBJECTS_INHERIT
    } else {
        NO_INHERITANCE
    };
    let trustee = TRUSTEE_W {
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_USER,
        ptstrName: PWSTR(sid.0.cast()),
        ..Default::default()
    };
    let access = EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS.0,
        grfAccessMode: SET_ACCESS,
        grfInheritance: inheritance,
        Trustee: trustee,
    };
    let mut acl = std::ptr::null_mut();
    // SAFETY: the access entry points to the live SID buffer and acl is an out-parameter.
    let acl_status = unsafe { SetEntriesInAclW(Some(&[access]), None, &mut acl) };
    if acl_status != ERROR_SUCCESS || acl.is_null() {
        return Err(Error::unknown("protected path ACL could not be created"));
    }
    let acl = LocalAcl(acl);
    // SAFETY: wide_path is null-terminated and acl remains allocated for this call.
    let status = unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(wide_path.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(acl.0.cast_const()),
            None,
        )
    };
    (status == ERROR_SUCCESS)
        .then_some(())
        .ok_or_else(|| Error::unknown("protected path ACL could not be applied"))
}

#[cfg(windows)]
fn token_user(token: &TokenHandle) -> Result<Vec<usize>, Error> {
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_USER};
    let mut required = 0;
    // SAFETY: the first call intentionally supplies no buffer and returns its size.
    let _ = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &mut required) };
    if required < std::mem::size_of::<TOKEN_USER>() as u32 {
        return Err(Error::unknown(
            "current-user security identity is unavailable",
        ));
    }
    let word = std::mem::size_of::<usize>();
    let mut buffer = vec![0usize; (required as usize).div_ceil(word)];
    // SAFETY: buffer is aligned and at least `required` bytes long.
    unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            required,
            &mut required,
        )
    }
    .map_err(|_| Error::unknown("current-user security identity is unavailable"))?;
    Ok(buffer)
}

#[cfg(windows)]
struct TokenHandle(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for TokenHandle {
    fn drop(&mut self) {
        // SAFETY: this handle was returned by OpenProcessToken and is owned here.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
struct LocalAcl(*mut windows::Win32::Security::ACL);

#[cfg(windows)]
impl Drop for LocalAcl {
    fn drop(&mut self) {
        // SAFETY: SetEntriesInAclW allocated this pointer with LocalAlloc.
        unsafe {
            windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(
                self.0.cast(),
            )));
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn secure_current_user(path: &Path) -> Result<(), Error> {
    validate_not_reparse(path)
}

#[cfg(test)]
mod tests {
    use super::validate_not_reparse;

    #[test]
    fn ordinary_file_is_not_a_reparse_point() {
        let path = std::env::temp_dir().join(format!("appport-path-{}", rand::random::<u64>()));
        std::fs::write(&path, b"test").unwrap();
        assert!(validate_not_reparse(&path).is_ok());
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_is_rejected() {
        let root = std::env::temp_dir().join(format!("appport-link-{}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let target = root.join("target");
        let link = root.join("link");
        std::fs::write(&target, b"test").unwrap();
        std::os::unix::fs::symlink(target, &link).unwrap();
        assert!(validate_not_reparse(&link).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
