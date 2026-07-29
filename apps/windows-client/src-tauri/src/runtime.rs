pub enum LaunchMode {
    Foreground,
    BackgroundCheck,
}

pub fn launch_mode(args: &[String]) -> LaunchMode {
    if args
        .iter()
        .skip(1)
        .any(|argument| argument == "--background-check")
    {
        LaunchMode::BackgroundCheck
    } else {
        LaunchMode::Foreground
    }
}

pub fn opens_updates(args: &[String]) -> bool {
    args.iter()
        .skip(1)
        .any(|argument| argument == "--updates" || argument == "relution-appport://updates")
}

#[cfg(windows)]
pub fn acquire_singleton() -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        },
    };
    let name: Vec<u16> = "Local\\Appport".encode_utf16().chain(Some(0)).collect();
    unsafe {
        let handle = CreateMutexW(None, true, PCWSTR(name.as_ptr()))
            .map_err(|_| "unknown: singleton mutex failed")?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(handle);
            return Err("unknown: Appport is already running".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn acquire_singleton() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exact_background_switch_selects_background_mode() {
        let arguments = vec!["app".into(), "--background-check".into()];
        assert!(matches!(
            launch_mode(&arguments),
            LaunchMode::BackgroundCheck
        ));
        assert!(matches!(
            launch_mode(&["app".into(), "--background-check=yes".into()]),
            LaunchMode::Foreground
        ));
    }

    #[test]
    fn recognizes_updates_activation() {
        assert!(opens_updates(&[
            "app".into(),
            "relution-appport://updates".into()
        ]));
        assert!(!opens_updates(&["app".into(), "--background-check".into()]));
    }
}
