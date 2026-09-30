use crate::error::Error;
use std::path::Path;

#[cfg(windows)]
use super::system_tools;
#[cfg(windows)]
use std::process::Stdio;

pub(super) const PROTOCOL: &str = "relution-appport";

#[cfg(windows)]
pub(super) fn register(executable: &Path) -> Result<(), Error> {
    let executable = executable
        .to_str()
        .ok_or_else(|| Error::unknown("application path is not Unicode"))?;
    let root = format!(r"Software\Classes\{PROTOCOL}");
    write_registry_string(&root, None, "URL:Appport")?;
    write_registry_string(&root, Some("URL Protocol"), "")?;
    write_registry_string(
        &format!(r"{root}\shell\open\command"),
        None,
        &format!("\"{executable}\" \"%1\""),
    )
}

#[cfg(not(windows))]
pub(super) fn register(_: &Path) -> Result<(), Error> {
    Ok(())
}

#[cfg(windows)]
pub(super) fn write_registry_string(
    path: &str,
    name: Option<&str>,
    value: &str,
) -> Result<(), Error> {
    let key = format!("HKCU\\{path}");
    let mut command = system_tools::command("reg.exe")
        .map_err(|_| Error::unknown("protocol registry unavailable"))?;
    command.args(["add", &key]);
    if let Some(name) = name {
        command.args(["/v", name]);
    } else {
        command.arg("/ve");
    }
    let status = command
        .args(["/t", "REG_SZ", "/d"])
        .arg(value)
        .arg("/f")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| Error::unknown("protocol registry unavailable"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::unknown("protocol registration failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::PROTOCOL;

    #[test]
    fn protocol_name_remains_fixed() {
        assert_eq!(PROTOCOL, "relution-appport");
    }
}
