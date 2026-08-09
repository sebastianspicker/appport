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

pub fn open_relution_portal() -> Result<(), String> {
    let url = option_env!("APPPORT_RELUTION_API_BASE_URL")
        .ok_or("configuration: Relution portal URL was not embedded in this build")?;
    let parsed = Url::parse(url).map_err(|_| "server: invalid authorization URL".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("server: authorization URL must use HTTPS".into());
    }
    #[cfg(windows)]
    {
        open::that(url).map_err(|_| "unknown: unable to open Relution portal".into())
    }
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err("unknown: Relution portal is only available on Windows".into())
    }
}
