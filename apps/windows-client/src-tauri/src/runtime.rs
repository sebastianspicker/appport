use std::path::Path;

#[cfg(windows)]
use std::{fs, process::Command};

#[cfg(windows)]
const BACKGROUND_TASK_TEMPLATE: &str = r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Checks Appport for approved updates.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{sid_xml}</UserId><Delay>PT15M</Delay></LogonTrigger>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <RandomDelay>PT15M</RandomDelay>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
      <Repetition><Interval>PT4H</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>{sid_xml}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{command}</Command><Arguments>--background-check</Arguments></Exec></Actions>
</Task>"#;

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
pub fn register_protocol(executable: &Path) -> Result<(), String> {
    let executable = executable
        .to_str()
        .ok_or("unknown: application path is not Unicode")?;
    write_registry_string(r"Software\Classes\relution-appport", None, "URL:Appport")?;
    write_registry_string(
        r"Software\Classes\relution-appport",
        Some("URL Protocol"),
        "",
    )?;
    write_registry_string(
        r"Software\Classes\relution-appport\shell\open\command",
        None,
        &format!("\"{executable}\" \"%1\""),
    )
}

#[cfg(not(windows))]
pub fn register_protocol(_: &Path) -> Result<(), String> {
    Ok(())
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
        std::mem::forget(handle);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn acquire_singleton() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn register_background_check(executable: &Path) -> Result<(), String> {
    let sid = current_user_sid()?;
    let task_name = format!(r"\Relution\Appport\{sid}");
    let task_xml = background_task_xml(executable, &sid)?;
    let task_file = write_background_task(&task_xml)?;
    let result = create_scheduled_task(&task_name, &task_file);
    let _ = fs::remove_file(task_file);
    result
}

#[cfg(windows)]
fn background_task_xml(executable: &Path, sid: &str) -> Result<String, String> {
    let command = xml_escape(
        executable
            .to_str()
            .ok_or("unknown: application path is not Unicode")?,
    );
    let sid_xml = xml_escape(sid);
    Ok(BACKGROUND_TASK_TEMPLATE
        .replace("{sid_xml}", &sid_xml)
        .replace("{command}", &command))
}

#[cfg(windows)]
fn write_background_task(task_xml: &str) -> Result<std::path::PathBuf, String> {
    let directory = local_data_directory();
    fs::create_dir_all(&directory).map_err(|_| "unknown: task staging directory unavailable")?;
    let task_file = directory.join("background-task.xml");
    let utf16: Vec<u16> = std::iter::once(0xfeff)
        .chain(task_xml.encode_utf16())
        .collect();
    let bytes = unsafe { std::slice::from_raw_parts(utf16.as_ptr().cast::<u8>(), utf16.len() * 2) };
    fs::write(&task_file, bytes).map_err(|_| "unknown: task definition unavailable")?;
    Ok(task_file)
}

#[cfg(windows)]
fn create_scheduled_task(task_name: &str, task_file: &Path) -> Result<(), String> {
    let status = Command::new("schtasks.exe")
        .args(["/Create", "/F", "/TN", &task_name, "/XML"])
        .arg(task_file)
        .status()
        .map_err(|_| "unknown: Task Scheduler unavailable")?;
    if status.success() {
        Ok(())
    } else {
        Err("unknown: Task Scheduler registration failed".into())
    }
}

#[cfg(not(windows))]
pub fn register_background_check(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn remove_background_check() -> Result<(), String> {
    let task_name = format!(r"\Relution\Appport\{}", current_user_sid()?);
    let status = Command::new("schtasks.exe")
        .args(["/Delete", "/F", "/TN", &task_name])
        .status()
        .map_err(|_| "unknown: Task Scheduler unavailable")?;
    if status.success() {
        Ok(())
    } else {
        Err("unknown: Task Scheduler removal failed".into())
    }
}

#[cfg(not(windows))]
pub fn remove_background_check() -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn current_user_sid() -> Result<String, String> {
    let output = Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|_| "unknown: Windows user identity unavailable")?;
    if !output.status.success() {
        return Err("unknown: Windows user identity unavailable".into());
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| "unknown: Windows user identity is malformed")?;
    let sid = text
        .split(',')
        .nth(1)
        .map(|value| value.trim().trim_matches('"').to_owned())
        .filter(|value| {
            value.starts_with("S-1-")
                && value
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '-')
        })
        .ok_or("unknown: Windows user SID is unavailable")?;
    Ok(sid)
}

#[cfg(windows)]
fn local_data_directory() -> std::path::PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Relution")
        .join("Appport")
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn notify_updates(count: u32) -> Result<(), String> {
    if count == 0 {
        update_last_count(0)?;
        return Ok(());
    }
    let previous = read_last_count().unwrap_or(0);
    update_last_count(count)?;
    if count <= previous {
        return Ok(());
    }
    show_update_toast(count)
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
fn read_last_count() -> Option<u32> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
        },
    };
    let key = wide(r"Software\Relution\Appport");
    let value = wide("LastUpdateCount");
    let mut count = 0_u32;
    let mut length = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut count as *mut u32).cast()),
            Some(&mut length),
        )
    };
    (status == ERROR_SUCCESS).then_some(count)
}

#[cfg(not(windows))]
fn read_last_count() -> Option<u32> {
    None
}

#[cfg(windows)]
fn update_last_count(count: u32) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{
                RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
                KEY_SET_VALUE, REG_DWORD, REG_OPTION_NON_VOLATILE,
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
    let name = wide("LastUpdateCount");
    let bytes = count.to_le_bytes();
    let status =
        unsafe { RegSetValueExW(key, PCWSTR(name.as_ptr()), None, REG_DWORD, Some(&bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err("unknown: notification state could not be saved".into())
    }
}

#[cfg(windows)]
fn write_registry_string(path: &str, name: Option<&str>, value: &str) -> Result<(), String> {
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
    let path = wide(path);
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
        return Err("unknown: protocol registry unavailable".into());
    }
    let name = name.map(wide);
    let encoded: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
    let bytes =
        unsafe { std::slice::from_raw_parts(encoded.as_ptr().cast::<u8>(), encoded.len() * 2) };
    let name_pointer = match &name {
        Some(value) => PCWSTR(value.as_ptr()),
        None => PCWSTR::null(),
    };
    let status = unsafe { RegSetValueExW(key, name_pointer, None, REG_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err("unknown: protocol registration failed".into())
    }
}

#[cfg(not(windows))]
fn update_last_count(_: u32) -> Result<(), String> {
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

    #[test]
    fn escapes_task_xml_values() {
        assert_eq!(
            xml_escape(r#"C:\A&B\"App".exe"#),
            r#"C:\A&amp;B\&quot;App&quot;.exe"#
        );
    }
}
