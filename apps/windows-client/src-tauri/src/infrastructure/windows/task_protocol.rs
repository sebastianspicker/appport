use crate::error::Error;
use std::path::Path;

pub(super) const PROTOCOL: &str = "relution-appport";

#[cfg(windows)]
pub(super) fn register(executable: &Path) -> Result<(), Error> {
    let executable = executable
        .to_str()
        .ok_or_else(|| Error::unknown("application path is not Unicode"))?;
    let root = format!(r"Software\Classes\{PROTOCOL}");
    write_registry_string(&root, None, "URL:Appport")?;
    write_registry_string(&root, Some("URL Protocol"), "")?;
    write_registry_string(
        &format!(r"{root}\shell\open\command"),
        None,
        &format!("\"{executable}\" \"%1\""),
    )
}

#[cfg(not(windows))]
pub(super) fn register(_: &Path) -> Result<(), Error> {
    Ok(())
}

// Current-user registry access through the Win32 API, not reg.exe and its text output.
#[cfg(windows)]
fn current_user() -> winreg::RegKey {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
}

/// Writes a `REG_SZ` value under HKCU; `None` writes the key's default value.
#[cfg(windows)]
pub(super) fn write_registry_string(
    path: &str,
    name: Option<&str>,
    value: &str,
) -> Result<(), Error> {
    current_user()
        .create_subkey(path)
        .and_then(|(key, _)| key.set_value(name.unwrap_or_default(), &value))
        .map_err(|_| Error::unknown("registry value could not be written"))
}

#[cfg(windows)]
pub(super) fn read_registry_string(path: &str, name: &str) -> Option<String> {
    current_user()
        .open_subkey(path)
        .and_then(|key| key.get_value(name))
        .ok()
}

/// Deletes one HKCU value. A missing key or value counts as already deleted.
#[cfg(windows)]
pub(super) fn delete_registry_value(path: &str, name: &str) -> Result<(), Error> {
    match current_user()
        .open_subkey_with_flags(path, winreg::enums::KEY_SET_VALUE)
        .and_then(|key| key.delete_value(name))
    {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(Error::unknown("registry value could not be deleted"))
        }
        _ => Ok(()),
    }
}

/// Deletes one HKCU key that has no subkeys; never a whole tree.
#[cfg(windows)]
pub(super) fn delete_registry_key(path: &str) -> bool {
    current_user().delete_subkey(path).is_ok()
}

#[cfg(windows)]
pub(super) fn registry_key_exists(path: &str) -> bool {
    current_user().open_subkey(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::PROTOCOL;

    #[test]
    fn protocol_name_remains_fixed() {
        assert_eq!(PROTOCOL, "relution-appport");
    }
}
