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
        .args(["/Create", "/F", "/TN", task_name, "/XML"])
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
    text.split(',')
        .nth(1)
        .map(|value| value.trim().trim_matches('"').to_owned())
        .filter(|value| {
            value.starts_with("S-1-")
                && value
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '-')
        })
        .ok_or("unknown: Windows user SID is unavailable".into())
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

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_task_xml_values() {
        assert_eq!(
            xml_escape(r#"C:\A&B\"App".exe"#),
            r#"C:\A&amp;B\&quot;App&quot;.exe"#
        );
    }
}
