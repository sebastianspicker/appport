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

pub fn open_system_browser(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "server: invalid authorization URL".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("server: authorization URL must use HTTPS".into());
    }
    #[cfg(windows)]
    {
        open::that(url).map_err(|_| "unknown: unable to open system browser".into())
    }
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err("unknown: system-browser sign-in is only available on Windows".into())
    }
}
