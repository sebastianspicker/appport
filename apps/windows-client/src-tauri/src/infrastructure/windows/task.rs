//! Stable façade for Windows protocol registration and background task staging.

use super::{task_protocol, task_scheduler};
use std::path::Path;

#[cfg(windows)]
use super::system_tools;
#[cfg(windows)]
use std::{fs, path::PathBuf, process::Stdio};

pub fn register_protocol(executable: &Path) -> Result<(), String> {
    task_protocol::register(executable)
}

pub fn register_background_check(executable: &Path) -> Result<(), String> {
    task_scheduler::register(executable)
}

pub fn remove_background_check() -> Result<(), String> {
    task_scheduler::remove()
}

#[cfg(windows)]
struct QualificationResources {
    registry_path: String,
    registry_key: String,
    task_name: String,
    task_file_name: String,
    task_file_path: PathBuf,
    executable: PathBuf,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CleanupState {
    registry_removed: bool,
    task_removed: bool,
    task_file_removed: bool,
}

#[cfg(any(windows, test))]
impl CleanupState {
    fn complete(self) -> bool {
        self.registry_removed && self.task_removed && self.task_file_removed
    }
}

#[cfg(windows)]
fn qualification_resources() -> Result<QualificationResources, String> {
    let suffix = std::process::id().to_string();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let registry_path = format!(r"Software\Classes\relution-appport-qualification-{suffix}");
    let task_file_name = format!("qualification-task-{suffix}-{nonce}.xml");
    let executable =
        std::env::current_exe().map_err(|_| "unknown: qualification executable unavailable")?;
    let task_file_path = task_scheduler::local_data_directory()?.join(&task_file_name);
    Ok(QualificationResources {
        registry_key: format!(r"HKCU\{registry_path}"),
        registry_path,
        task_name: format!(r"\AppportQualificationSelfCheck-{suffix}"),
        task_file_path,
        task_file_name,
        executable,
    })
}

#[cfg(windows)]
fn stage_qualification_resources(resources: &QualificationResources) -> Result<(), String> {
    task_protocol::write_registry_string(
        &resources.registry_path,
        None,
        "URL:Appport qualification self-check",
    )?;
    task_protocol::write_registry_string(&resources.registry_path, Some("URL Protocol"), "")?;
    require_registry_present(&resources.registry_key)?;

    let sid = task_scheduler::current_user_sid()?;
    let xml = task_scheduler::background_task_xml(&resources.executable, &sid)?;
    let task_file = task_scheduler::write_background_task_named(&xml, &resources.task_file_name)?;
    task_scheduler::create_scheduled_task(&resources.task_name, &task_file)?;
    require_task_present(&resources.task_name)
}

#[cfg(windows)]
fn require_registry_present(registry_key: &str) -> Result<(), String> {
    let query = system_tools::command("reg.exe")
        .map_err(|_| "unknown: qualification registry query failed")?
        .args(["query", registry_key])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "unknown: qualification registry query failed")?;
    query
        .success()
        .then_some(())
        .ok_or_else(|| "unknown: qualification registry state missing".into())
}

#[cfg(windows)]
fn require_task_present(task_name: &str) -> Result<(), String> {
    let query = system_tools::command("schtasks.exe")
        .map_err(|_| "unknown: qualification task query failed")?
        .args(["/Query", "/TN", task_name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "unknown: qualification task query failed")?;
    query
        .success()
        .then_some(())
        .ok_or_else(|| "unknown: qualification task state missing".into())
}

#[cfg(windows)]
fn cleanup_qualification_resources(resources: &QualificationResources) -> CleanupState {
    let registry_removed = system_tools::command("reg.exe")
        .and_then(|mut command| {
            command
                .args(["delete", &resources.registry_key, "/f"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "unknown: qualification registry cleanup failed".into())
        })
        .map(|status| status.success())
        .unwrap_or(false);
    let task_removed = system_tools::command("schtasks.exe")
        .and_then(|mut command| {
            command
                .args(["/Delete", "/F", "/TN", &resources.task_name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "unknown: qualification task cleanup failed".into())
        })
        .map(|status| status.success())
        .unwrap_or(false);
    let task_file_removed = (!resources.task_file_path.exists()
        || fs::remove_file(&resources.task_file_path).is_ok())
        && !resources.task_file_path.exists();
    CleanupState {
        registry_removed,
        task_removed,
        task_file_removed,
    }
}

#[cfg(windows)]
fn qualification_resources_absent(resources: &QualificationResources) -> bool {
    let registry_absent = !system_tools::command("reg.exe")
        .and_then(|mut command| {
            command
                .args(["query", &resources.registry_key])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "unknown: qualification registry query failed".into())
        })
        .map(|status| status.success())
        .unwrap_or(true);
    let task_absent = !system_tools::command("schtasks.exe")
        .and_then(|mut command| {
            command
                .args(["/Query", "/TN", &resources.task_name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "unknown: qualification task query failed".into())
        })
        .map(|status| status.success())
        .unwrap_or(true);
    registry_absent && task_absent
}

#[cfg(windows)]
pub fn qualification_platform_self_check() -> Result<(), String> {
    let resources = qualification_resources()?;
    let result = stage_qualification_resources(&resources);
    if !cleanup_qualification_resources(&resources).complete() {
        return Err("unknown: qualification platform cleanup failed".into());
    }
    if !qualification_resources_absent(&resources) {
        return Err("unknown: qualification platform resource remains".into());
    }
    result
}

#[cfg(not(windows))]
pub fn qualification_platform_self_check() -> Result<(), String> {
    Err("unknown: Windows registry and Task Scheduler are unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::CleanupState;

    #[test]
    fn cleanup_state_requires_every_resource_to_be_removed() {
        assert!(CleanupState {
            registry_removed: true,
            task_removed: true,
            task_file_removed: true,
        }
        .complete());

        for incomplete in [
            CleanupState {
                registry_removed: false,
                task_removed: true,
                task_file_removed: true,
            },
            CleanupState {
                registry_removed: true,
                task_removed: false,
                task_file_removed: true,
            },
            CleanupState {
                registry_removed: true,
                task_removed: true,
                task_file_removed: false,
            },
        ] {
            assert!(!incomplete.complete());
        }
    }
}
