//! Hardened Windows known-folder and system-tool access.

#[cfg(windows)]
use std::{
    ffi::OsString,
    os::windows::{ffi::OsStringExt, fs::MetadataExt},
    path::{Component, Prefix},
};

#[cfg(any(windows, test))]
use std::path::PathBuf;

#[cfg(windows)]
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

#[cfg(windows)]
pub(crate) fn local_app_data() -> Result<PathBuf, String> {
    use windows::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_LocalAppData, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
    };

    // SAFETY: SHGetKnownFolderPath allocates a null-terminated path for the
    // current user. It is copied before being released with CoTaskMemFree.
    let allocated = unsafe { SHGetKnownFolderPath(&FOLDERID_LocalAppData, KF_FLAG_DEFAULT, None) }
        .map_err(|_| "unknown: Windows local application data is unavailable")?;
    let path = PathBuf::from(OsString::from_wide(unsafe { allocated.as_wide() }));
    unsafe { CoTaskMemFree(Some(allocated.as_ptr().cast())) };
    validate_local_app_data(path)
}

#[cfg(windows)]
pub(crate) fn appport_local_data_directory() -> Result<PathBuf, String> {
    let base = local_app_data()?;
    let relution = create_non_reparse_directory(&base, "Relution")?;
    create_non_reparse_directory(&relution, "Appport")
}

#[cfg(windows)]
pub(crate) fn open_https_url(url: &str) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let operation = "open".encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let target = url.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    // SAFETY: both strings are valid, null-terminated UTF-16 buffers that live
    // for the duration of this synchronous shell call. No parameters or
    // working directory are supplied.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("unknown: unable to open HTTPS URL".into())
    }
}

#[cfg(windows)]
fn validate_local_app_data(path: PathBuf) -> Result<PathBuf, String> {
    let is_local_absolute = matches!(
        path.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
    );
    if !is_local_absolute || !path.is_absolute() {
        return Err("unknown: Windows local application data is not a local path".into());
    }
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "unknown: Windows local application data is unavailable")?;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err("unknown: Windows local application data is redirected".into());
    }
    Ok(path)
}

#[cfg(windows)]
fn create_non_reparse_directory(parent: &std::path::Path, name: &str) -> Result<PathBuf, String> {
    if !valid_appport_directory_component(name) {
        return Err("unknown: Windows application data path is invalid".into());
    }
    let path = parent.join(name);
    match std::fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("unknown: Windows application data directory is unavailable".into()),
    }
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "unknown: Windows application data directory is unavailable")?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.file_attributes() & 0x400 != 0
    {
        return Err("unknown: Windows application data directory is redirected".into());
    }
    Ok(path)
}

#[cfg(any(windows, test))]
fn valid_appport_directory_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

#[cfg(windows)]
pub(crate) fn command(tool: &str) -> Result<std::process::Command, String> {
    let system_directory = system_directory()?;
    command_in(&system_directory, tool)
}

#[cfg(windows)]
fn system_directory() -> Result<PathBuf, String> {
    let mut capacity = 260usize;
    loop {
        let mut buffer = vec![0; capacity];
        // SAFETY: buffer is a valid writable UTF-16 slice.
        let length = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
        if length == 0 {
            return Err("unknown: Windows System32 directory is unavailable".into());
        }
        if length < capacity {
            buffer.truncate(length);
            return validated_system_directory(PathBuf::from(OsString::from_wide(&buffer)));
        }
        capacity = length.saturating_add(1);
    }
}

#[cfg(any(windows, test))]
fn validated_system_directory(system_directory: PathBuf) -> Result<PathBuf, String> {
    if !system_directory.is_absolute() {
        return Err("unknown: Windows System32 directory is not absolute".into());
    }
    Ok(system_directory)
}

#[cfg(any(windows, test))]
fn command_in(
    system_directory: &std::path::Path,
    tool: &str,
) -> Result<std::process::Command, String> {
    if !matches!(
        tool,
        "whoami.exe" | "icacls.exe" | "reg.exe" | "schtasks.exe" | "explorer.exe"
    ) {
        return Err("unknown: requested Windows system tool is not allowlisted".into());
    }
    let system_directory = validated_system_directory(system_directory.to_path_buf())?;
    let program = system_directory.join(tool);
    if !program.is_absolute() {
        return Err("unknown: requested Windows system tool path is not absolute".into());
    }
    let mut command = std::process::Command::new(program);
    command.current_dir(system_directory);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::{command_in, valid_appport_directory_component, validated_system_directory};
    use std::path::PathBuf;

    #[test]
    fn command_uses_system32_instead_of_hostile_path_or_current_directory() {
        let base = std::env::current_dir().unwrap();
        let system32 = base.join("trusted").join("System32");
        let hostile_directory = base.join("attacker");
        let mut command = command_in(&system32, "whoami.exe").unwrap();
        command.env("PATH", &hostile_directory);

        assert_eq!(
            command.get_program(),
            system32.join("whoami.exe").as_os_str()
        );
        assert_eq!(command.get_current_dir(), Some(system32.as_path()));
        assert_ne!(
            command.get_program(),
            hostile_directory.join("whoami.exe").as_os_str()
        );
    }

    #[test]
    fn command_rejects_nonabsolute_resolver_output_and_unknown_tools() {
        assert!(validated_system_directory(PathBuf::from("System32")).is_err());

        let system32 = std::env::current_dir()
            .unwrap()
            .join("trusted")
            .join("System32");

        assert!(command_in(&system32, "cmd.exe").is_err());
    }

    #[test]
    fn explorer_is_resolved_from_system32_without_a_script_shell() {
        let system32 = std::env::current_dir()
            .unwrap()
            .join("trusted")
            .join("System32");
        let command = command_in(&system32, "explorer.exe").unwrap();
        assert_eq!(
            command.get_program(),
            system32.join("explorer.exe").as_os_str()
        );
        assert_eq!(command.get_current_dir(), Some(system32.as_path()));
    }

    #[test]
    fn appport_directory_components_cannot_escape_the_known_folder() {
        assert!(valid_appport_directory_component("Relution"));
        assert!(valid_appport_directory_component("Appport"));
        assert!(!valid_appport_directory_component("."));
        assert!(!valid_appport_directory_component(".."));
        assert!(!valid_appport_directory_component("nested/path"));
        assert!(!valid_appport_directory_component("nested\\path"));
    }
}
