use url::Url;

pub fn current_locale() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::Globalization::{GetUserDefaultLocaleName, LOCALE_NAME_MAX_LENGTH};
        let mut locale = [0_u16; LOCALE_NAME_MAX_LENGTH as usize];
        // SAFETY: `locale` is writable, has `LOCALE_NAME_MAX_LENGTH` UTF-16
        // elements, and remains valid for the synchronous Win32 call.
        let length = unsafe { GetUserDefaultLocaleName(&mut locale) };
        if length > 0 {
            let value = String::from_utf16_lossy(&locale[..length as usize - 1]);
            if value.to_ascii_lowercase().starts_with("de") {
                return "de-DE".into();
            }
        }
    }
    "en-US".into()
}

pub fn open_system_browser(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "server: invalid authorization URL".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("server: authorization URL must use HTTPS".into());
    }
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        // SAFETY: both UTF-16 vectors are NUL-terminated, retained until
        // `ShellExecuteW` returns, and are derived from an already validated HTTPS URL.
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
        if result.0 as isize <= 32 {
            return Err("unknown: unable to open system browser".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err("unknown: system-browser sign-in is only available on Windows".into())
    }
}
