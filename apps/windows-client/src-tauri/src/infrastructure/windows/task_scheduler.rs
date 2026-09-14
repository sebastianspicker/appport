use std::path::Path;

#[cfg(windows)]
use super::system_tools;
#[cfg(windows)]
use std::{fs, io::Write, process::Stdio};

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

pub(super) fn background_task_name(sid: &str) -> String {
    format!(r"\Relution\Appport\{sid}")
}

#[cfg(windows)]
pub(super) fn register(executable: &Path) -> Result<(), String> {
    let sid = current_user_sid()?;
    let task_name = background_task_name(&sid);
    let task_xml = background_task_xml(executable, &sid)?;
    let task_file = write_background_task(&task_xml)?;
    let result = create_scheduled_task(&task_name, &task_file);
    let _ = fs::remove_file(task_file);
    result
}

#[cfg(not(windows))]
pub(super) fn register(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub(super) fn remove() -> Result<(), String> {
    let task_name = background_task_name(&current_user_sid()?);
    let status = system_tools::command("schtasks.exe")
        .map_err(|_| "unknown: Task Scheduler unavailable")?
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
pub(super) fn remove() -> Result<(), String> {
    Ok(())
}

pub(super) fn background_task_xml(executable: &Path, sid: &str) -> Result<String, String> {
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
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    write_background_task_named(
        task_xml,
        &format!("background-task-{}-{nonce}.xml", std::process::id()),
    )
}

#[cfg(windows)]
pub(super) fn write_background_task_named(
    task_xml: &str,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    if !valid_task_file_name(file_name) {
        return Err("unknown: task staging file name is invalid".into());
    }
    let directory = local_data_directory()?;
    let task_file = directory.join(file_name);
    let utf16: Vec<u16> = std::iter::once(0xfeff)
        .chain(task_xml.encode_utf16())
        .collect();
    let bytes: Vec<u8> = utf16.iter().flat_map(|unit| unit.to_le_bytes()).collect();
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&task_file)
        .map_err(|_| "unknown: task definition unavailable")?;
    file.write_all(&bytes)
        .map_err(|_| "unknown: task definition unavailable")?;
    file.sync_all()
        .map_err(|_| "unknown: task definition unavailable")?;
    Ok(task_file)
}

#[cfg(windows)]
pub(super) fn create_scheduled_task(task_name: &str, task_file: &Path) -> Result<(), String> {
    let status = system_tools::command("schtasks.exe")
        .map_err(|_| "unknown: Task Scheduler unavailable")?
        .args(["/Create", "/F", "/TN", task_name, "/XML"])
        .arg(task_file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "unknown: Task Scheduler unavailable")?;
    if status.success() {
        Ok(())
    } else {
        Err("unknown: Task Scheduler registration failed".into())
    }
}

#[cfg(windows)]
pub(super) fn current_user_sid() -> Result<String, String> {
    let output = system_tools::command("whoami.exe")
        .map_err(|_| "unknown: Windows user identity unavailable")?
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
pub(super) fn local_data_directory() -> Result<std::path::PathBuf, String> {
    system_tools::appport_local_data_directory()
        .map_err(|_| "unknown: task staging directory unavailable".into())
}

#[cfg(any(windows, test))]
fn valid_task_file_name(file_name: &str) -> bool {
    file_name.ends_with(".xml")
        && file_name.len() <= 160
        && file_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::{background_task_name, background_task_xml, valid_task_file_name, xml_escape};
    use std::path::Path;

    #[test]
    fn task_names_are_bound_to_the_current_user_sid() {
        assert_eq!(
            background_task_name("S-1-5-21-42"),
            r"\Relution\Appport\S-1-5-21-42"
        );
    }

    #[test]
    fn task_xml_escapes_identity_and_command_without_changing_schedule() {
        let xml =
            background_task_xml(Path::new(r#"C:\A&B\"App".exe"#), "S-1-5-21&42").expect("task XML");
        assert!(xml.contains(r#"C:\A&amp;B\&quot;App&quot;.exe"#));
        assert!(xml.contains("S-1-5-21&amp;42"));
        assert!(xml.contains("<Delay>PT15M</Delay>"));
        assert!(xml.contains("<Interval>PT4H</Interval>"));
        assert!(xml.contains("<Arguments>--background-check</Arguments>"));
    }

    #[test]
    fn escapes_task_xml_values() {
        assert_eq!(
            xml_escape(r#"C:\A&B\"App".exe"#),
            r#"C:\A&amp;B\&quot;App&quot;.exe"#
        );
    }

    #[test]
    fn staging_file_names_are_flat_and_constrained() {
        assert!(valid_task_file_name("background-task-7-8.xml"));
        assert!(!valid_task_file_name("."));
        assert!(!valid_task_file_name("../task.xml"));
        assert!(!valid_task_file_name("nested\\task.xml"));
        assert!(!valid_task_file_name("task.txt"));
    }
}
