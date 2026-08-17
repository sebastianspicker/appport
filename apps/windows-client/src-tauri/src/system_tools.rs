#[cfg(windows)]
use std::{ffi::OsString, os::windows::ffi::OsStringExt};

#[cfg(any(windows, test))]
use std::path::PathBuf;

#[cfg(windows)]
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

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
        "whoami.exe" | "icacls.exe" | "reg.exe" | "schtasks.exe"
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
    use super::*;

    #[test]
    fn command_uses_system32_instead_of_hostile_path_or_current_directory() {
        let system32 = PathBuf::from("/trusted/System32");
        let hostile_directory = PathBuf::from("/attacker");
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
        assert!(command_in(&PathBuf::from("/trusted/System32"), "cmd.exe").is_err());
    }
}
