//! Windows locale, single-instance, and fixed-portal integration.

use crate::error::Error;
use url::Url;

pub fn current_locale() -> String {
    #[cfg(windows)]
    {
        if let Some(value) = sys_locale::get_locale() {
            if value.to_ascii_lowercase().starts_with("de") {
                return "de-DE".into();
            }
        }
    }
    "en-US".into()
}

/// Opens the validated fixed Relution origin from `RelutionConfig`.
pub fn open_relution_portal(origin: &Url) -> Result<(), Error> {
    if origin.scheme() != "https" {
        return Err(Error::server("authorization URL must use HTTPS"));
    }
    #[cfg(windows)]
    {
        crate::infrastructure::windows::system_tools::open_https_url(origin.as_str())
    }
    #[cfg(not(windows))]
    {
        Err(Error::unknown(
            "Relution portal is only available on Windows",
        ))
    }
}

/// Holds the per-session `Local\Appport` mutex so that only one foreground client runs.
#[cfg(windows)]
pub fn acquire_singleton() -> Result<(), Error> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        },
    };
    let name: Vec<u16> = "Local\\Appport".encode_utf16().chain(Some(0)).collect();
    // SAFETY: `name` is NUL-terminated and outlives the call. GetLastError is read
    // immediately after CreateMutexW on the same thread, and the handle is closed
    // only on the already-running path; on success it is deliberately kept open
    // for the process lifetime so the mutex stays held.
    unsafe {
        let handle = CreateMutexW(None, true, PCWSTR(name.as_ptr()))
            .map_err(|_| Error::unknown("singleton mutex failed"))?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(handle);
            return Err(Error::unknown("Appport is already running"));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn acquire_singleton() -> Result<(), Error> {
    Ok(())
}

/// Best effort: brings the running instance's window (title from tauri.conf.json) forward.
#[cfg(windows)]
pub fn focus_existing_window() {
    use windows::{
        core::w,
        Win32::UI::WindowsAndMessaging::{
            FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
        },
    };
    // SAFETY: the title is a static NUL-terminated wide string. The HWND comes from
    // FindWindowW just above; a window that vanished makes the calls fail, and their
    // results are deliberately ignored.
    unsafe {
        if let Ok(hwnd) = FindWindowW(None, w!("Appport")) {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }
}
