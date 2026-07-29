use std::collections::BTreeSet;

pub fn notify_updates(keys: &[String]) -> Result<(), String> {
    let current = normalized_update_keys(keys);
    let previous = read_notification_keys().unwrap_or_default();
    persist_notification_keys(&current)?;
    if newly_added_update_keys(&previous, &current).is_empty() {
        return Ok(());
    }
    show_update_toast(current.len() as u32)
}

pub fn clear_state() -> Result<(), String> {
    clear_notification_state()
}

fn normalized_update_keys(keys: &[String]) -> BTreeSet<String> {
    keys.iter().filter(|key| !key.is_empty()).cloned().collect()
}

fn newly_added_update_keys(
    previous: &BTreeSet<String>,
    current: &BTreeSet<String>,
) -> BTreeSet<String> {
    current.difference(previous).cloned().collect()
}

#[cfg(windows)]
fn show_update_toast(count: u32) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    let german = windows_locale_is_german();
    let title = if german {
        "App-Updates verfügbar"
    } else {
        "App updates available"
    };
    let detail = if german {
        format!("{count} freigegebene Updates können installiert werden.")
    } else {
        format!("{count} approved updates are ready to install.")
    };
    let action = if german {
        "Updates anzeigen"
    } else {
        "View updates"
    };
    let xml = format!(
        r#"<toast launch="relution-appport://updates" activationType="protocol"><visual><binding template="ToastGeneric"><text>{title}</text><text>{detail}</text></binding></visual><actions><action content="{action}" arguments="relution-appport://updates" activationType="protocol"/></actions></toast>"#
    );
    let document = XmlDocument::new().map_err(|_| "unknown: toast document unavailable")?;
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|_| "unknown: toast content is invalid")?;
    let toast = ToastNotification::CreateToastNotification(&document)
        .map_err(|_| "unknown: toast could not be created")?;
    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.relution.appport"))
            .map_err(|_| "unknown: toast notifier unavailable")?;
    notifier
        .Show(&toast)
        .map_err(|_| "unknown: toast could not be displayed")
}

#[cfg(not(windows))]
fn show_update_toast(count: u32) -> Result<(), String> {
    crate::logging::write(&format!(
        "toast suppressed on unsupported platform: {count}"
    ));
    Ok(())
}

#[cfg(windows)]
fn windows_locale_is_german() -> bool {
    use windows::Win32::Globalization::{GetUserDefaultLocaleName, LOCALE_NAME_MAX_LENGTH};
    let mut locale = [0_u16; LOCALE_NAME_MAX_LENGTH as usize];
    let length = unsafe { GetUserDefaultLocaleName(&mut locale) };
    length > 0
        && String::from_utf16_lossy(&locale[..length as usize - 1])
            .to_ascii_lowercase()
            .starts_with("de")
}

#[cfg(windows)]
fn read_notification_keys() -> Option<BTreeSet<String>> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ},
        },
    };
    let key = wide(r"Software\Relution\Appport");
    let value = wide("UpdateNotificationKeys");
    let mut bytes = vec![0_u8; 64 * 1024];
    let mut length = bytes.len() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(bytes.as_mut_ptr().cast()),
            Some(&mut length),
        )
    };
    if status != ERROR_SUCCESS || length < 2 || length as usize > bytes.len() {
        return None;
    }
    let units =
        unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), length as usize / 2) };
    let value = String::from_utf16(units)
        .ok()?
        .trim_end_matches('\0')
        .to_owned();
    serde_json::from_str::<Vec<String>>(&value)
        .ok()
        .map(|keys| normalized_update_keys(&keys))
}

#[cfg(not(windows))]
fn read_notification_keys() -> Option<BTreeSet<String>> {
    None
}

#[cfg(windows)]
fn persist_notification_keys(keys: &BTreeSet<String>) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{
                RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
                KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
            },
        },
    };
    let path = wide(r"Software\Relution\Appport");
    let mut key = HKEY::default();
    if unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_READ | KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    } != ERROR_SUCCESS
    {
        return Err("unknown: notification state registry unavailable".into());
    }
    let name = wide("UpdateNotificationKeys");
    let value = serde_json::to_string(&keys.iter().collect::<Vec<_>>())
        .map_err(|_| "unknown: notification state could not be saved")?;
    let encoded: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
    let bytes =
        unsafe { std::slice::from_raw_parts(encoded.as_ptr().cast::<u8>(), encoded.len() * 2) };
    let status = unsafe { RegSetValueExW(key, PCWSTR(name.as_ptr()), None, REG_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err("unknown: notification state could not be saved".into())
    }
}

#[cfg(not(windows))]
fn persist_notification_keys(_: &BTreeSet<String>) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn clear_notification_state() -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
            System::Registry::{
                RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
            },
        },
    };
    let path = wide(r"Software\Relution\Appport");
    let mut key = HKEY::default();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            None,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    if status != ERROR_SUCCESS {
        return Err("unknown: notification state registry unavailable".into());
    }
    let name = wide("UpdateNotificationKeys");
    let status = unsafe { RegDeleteValueW(key, PCWSTR(name.as_ptr())) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err("unknown: notification state could not be cleared".into())
    }
}

#[cfg(not(windows))]
fn clear_notification_state() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_notification_keys_only_alert_for_additions() {
        let previous = normalized_update_keys(&["firefox@128".into(), "vscode@1".into()]);
        let unchanged = normalized_update_keys(&["firefox@128".into(), "vscode@1".into()]);
        let replacement = normalized_update_keys(&["firefox@129".into(), "vscode@1".into()]);
        let removal = normalized_update_keys(&["firefox@128".into()]);
        assert!(newly_added_update_keys(&previous, &unchanged).is_empty());
        assert_eq!(
            newly_added_update_keys(&previous, &replacement),
            BTreeSet::from(["firefox@129".into()])
        );
        assert!(newly_added_update_keys(&previous, &removal).is_empty());
    }
}
