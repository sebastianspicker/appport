//! Reparse-safe local event and Relution diagnostic logging.

use std::{fs, path::PathBuf};

mod relution_diagnostics;

pub use relution_diagnostics::{
    relution_diagnostics_enabled, write_relution_icon_response, write_relution_response,
    MAX_RELUTION_DIAGNOSTIC_BODY_BYTES,
};

const MAX_FILE_BYTES: u64 = 256 * 1024;

pub fn write(event: impl std::fmt::Display) {
    let text = sanitize(&event.to_string());
    let Some(path) = log_path() else {
        return;
    };
    if fs::metadata(&path)
        .map(|metadata| metadata.len() > MAX_FILE_BYTES)
        .unwrap_or(false)
    {
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, rotated);
    }
    let Some(parent) = path.parent() else {
        return;
    };
    if !prepare_log_directory(parent) {
        return;
    }
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{text}");
    }
}

fn log_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = crate::infrastructure::windows::system_tools::local_app_data().ok()?;
    #[cfg(not(windows))]
    let base = std::env::temp_dir();
    Some(base.join("Relution").join("Appport").join("client.log"))
}

pub(crate) fn support_log_paths() -> (Option<PathBuf>, Option<PathBuf>) {
    let active = log_path();
    let rotated = active.as_ref().map(|path| path.with_extension("log.1"));
    (active, rotated)
}

fn prepare_log_directory(path: &std::path::Path) -> bool {
    #[cfg(windows)]
    {
        prepare_windows_log_directory(path)
    }
    #[cfg(not(windows))]
    {
        fs::create_dir_all(path).is_ok()
            && fs::symlink_metadata(path)
                .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
                .unwrap_or(false)
    }
}

#[cfg(windows)]
fn prepare_windows_log_directory(path: &std::path::Path) -> bool {
    let Ok(base) = crate::infrastructure::windows::system_tools::local_app_data() else {
        return false;
    };
    if path != base.join("Relution").join("Appport") {
        return false;
    }
    let mut current = base;
    for component in ["Relution", "Appport"] {
        current.push(component);
        if !prepare_log_component(&current) {
            return false;
        }
    }
    true
}

#[cfg(windows)]
fn prepare_log_component(path: &std::path::Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    if !path.exists() && fs::create_dir(path).is_err() {
        return false;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && metadata.file_attributes() & 0x400 == 0
        && crate::infrastructure::journal::secure_current_user(path).is_ok()
}

pub fn sanitize(value: &str) -> String {
    let clipped: String = value
        .chars()
        .filter(|character| !character.is_control() || *character == ' ')
        .take(512)
        .collect();
    redact_value(&redact_value(&clipped, "Bearer "), "access_token=")
}

fn redact_value(value: &str, marker: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some(index) = remaining.find(marker) {
        output.push_str(&remaining[..index + marker.len()]);
        output.push_str("[redacted]");
        let secret = &remaining[index + marker.len()..];
        let mut end = secret
            .find(|character: char| character.is_whitespace() || "&,'\"".contains(character))
            .unwrap_or(secret.len());
        if marker == "Bearer " {
            if let Some(next_marker) = secret.find("access_token=") {
                end = end.min(next_marker);
            }
        }
        remaining = &secret[end..];
    }
    output.push_str(remaining);
    output
}
