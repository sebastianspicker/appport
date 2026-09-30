//! Windows registry-backed, add-only update notifications.

use crate::error::Error;
use std::collections::BTreeSet;

pub fn notify_updates(keys: &[String]) -> Result<(), Error> {
    let current = normalized_update_keys(keys);
    let previous = read_notification_keys().unwrap_or_default();
    persist_notification_keys(&current)?;
    if newly_added_update_keys(&previous, &current).is_empty() {
        return Ok(());
    }
    show_update_toast(current.len() as u32)
}

pub fn clear_state() -> Result<(), Error> {
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
fn show_update_toast(count: u32) -> Result<(), Error> {
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
    let document = XmlDocument::new().map_err(|_| Error::unknown("toast document unavailable"))?;
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|_| Error::unknown("toast content is invalid"))?;
    let toast = ToastNotification::CreateToastNotification(&document)
        .map_err(|_| Error::unknown("toast could not be created"))?;
    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.relution.appport"))
            .map_err(|_| Error::unknown("toast notifier unavailable"))?;
    notifier
        .Show(&toast)
        .map_err(|_| Error::unknown("toast could not be displayed"))
}

#[cfg(not(windows))]
fn show_update_toast(count: u32) -> Result<(), Error> {
    crate::infrastructure::logging::write(format!(
        "toast suppressed on unsupported platform: {count}"
    ));
    Ok(())
}

#[cfg(windows)]
fn windows_locale_is_german() -> bool {
    sys_locale::get_locale()
        .map(|locale| locale.to_ascii_lowercase().starts_with("de"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn read_notification_keys() -> Option<BTreeSet<String>> {
    let output = crate::infrastructure::windows::system_tools::command("reg.exe")
        .ok()?
        .args([
            "query",
            r"HKCU\Software\Relution\Appport",
            "/v",
            "UpdateNotificationKeys",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let value = text
        .lines()
        .find_map(|line| line.split_once("REG_SZ").map(|(_, value)| value.trim()))?;
    serde_json::from_str::<Vec<String>>(value)
        .ok()
        .map(|keys| normalized_update_keys(&keys))
}

#[cfg(not(windows))]
fn read_notification_keys() -> Option<BTreeSet<String>> {
    None
}

#[cfg(windows)]
fn persist_notification_keys(keys: &BTreeSet<String>) -> Result<(), Error> {
    let value = serde_json::to_string(&keys.iter().collect::<Vec<_>>())
        .map_err(|_| Error::unknown("notification state could not be saved"))?;
    let status = crate::infrastructure::windows::system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("notification state registry unavailable"))?
        .args([
            "add",
            r"HKCU\Software\Relution\Appport",
            "/v",
            "UpdateNotificationKeys",
            "/t",
            "REG_SZ",
            "/d",
        ])
        .arg(value)
        .arg("/f")
        .status()
        .map_err(|_| Error::unknown("notification state registry unavailable"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::unknown("notification state could not be saved"))
    }
}

#[cfg(not(windows))]
fn persist_notification_keys(_: &BTreeSet<String>) -> Result<(), Error> {
    Ok(())
}

#[cfg(windows)]
fn clear_notification_state() -> Result<(), Error> {
    let status = crate::infrastructure::windows::system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("notification state registry unavailable"))?
        .args([
            "delete",
            r"HKCU\Software\Relution\Appport",
            "/v",
            "UpdateNotificationKeys",
            "/f",
        ])
        .status()
        .map_err(|_| Error::unknown("notification state registry unavailable"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::unknown("notification state could not be cleared"))
    }
}

#[cfg(not(windows))]
fn clear_notification_state() -> Result<(), Error> {
    Ok(())
}

#[cfg(windows)]
pub fn qualification_notification_self_check() -> Result<(), Error> {
    let key = format!(
        r"HKCU\Software\Relution\AppportQualificationSelfCheck-{}",
        std::process::id()
    );
    let value = serde_json::to_string(&["qualification@1"])
        .map_err(|_| Error::unknown("qualification notification value invalid"))?;
    let result = write_qualification_notification(&key, value)
        .and_then(|_| query_qualification_notification(&key));
    let cleanup = cleanup_qualification_notification(&key);
    let absent = qualification_notification_absent(&key);
    result.and(cleanup).and(absent)
}

#[cfg(windows)]
fn write_qualification_notification(key: &str, value: String) -> Result<(), Error> {
    let status = crate::infrastructure::windows::system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("qualification notification registry unavailable"))?
        .args([
            "add",
            &key,
            "/v",
            "UpdateNotificationKeys",
            "/t",
            "REG_SZ",
            "/d",
        ])
        .arg(value)
        .args(["/f"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| Error::unknown("qualification notification registry unavailable"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| Error::unknown("qualification notification write failed"))
}

#[cfg(windows)]
fn query_qualification_notification(key: &str) -> Result<(), Error> {
    let output = crate::infrastructure::windows::system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("qualification notification query failed"))?
        .args(["query", key, "/v", "UpdateNotificationKeys"])
        .output()
        .map_err(|_| Error::unknown("qualification notification query failed"))?;
    (output.status.success() && String::from_utf8_lossy(&output.stdout).contains("qualification@1"))
        .then_some(())
        .ok_or_else(|| Error::unknown("qualification notification state missing"))
}

#[cfg(windows)]
fn cleanup_qualification_notification(key: &str) -> Result<(), Error> {
    let status = crate::infrastructure::windows::system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("qualification notification cleanup failed"))?
        .args(["delete", key, "/f"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| Error::unknown("qualification notification cleanup failed"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| Error::unknown("qualification notification cleanup failed"))
}

#[cfg(windows)]
fn qualification_notification_absent(key: &str) -> Result<(), Error> {
    crate::infrastructure::windows::system_tools::command("reg.exe")
        .and_then(|mut command| {
            command
                .args(["query", key])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map_err(|_| Error::unknown("qualification notification query failed"))
        })
        .map(|status| !status.success())
        .unwrap_or(false)
        .then_some(())
        .ok_or_else(|| Error::unknown("qualification notification key remains"))
}

#[cfg(not(windows))]
pub fn qualification_notification_self_check() -> Result<(), Error> {
    Err(Error::unknown(
        "Windows notification registry is unavailable",
    ))
}

#[cfg(test)]
mod tests {
    use super::{newly_added_update_keys, normalized_update_keys};
    use std::collections::BTreeSet;

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
