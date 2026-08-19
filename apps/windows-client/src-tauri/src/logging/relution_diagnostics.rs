use serde_json::Value;
#[cfg(any(debug_assertions, test))]
use std::io::Write;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

const MAX_FILE_BYTES: u64 = 256 * 1024;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
pub const MAX_RELUTION_DIAGNOSTIC_BODY_BYTES: usize = 8 * 1024;
const MAX_RELUTION_DIAGNOSTIC_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
static RELUTION_DEBUG_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static RELUTION_DEBUG_LOG_SECURITY_READY: OnceLock<bool> = OnceLock::new();

/// Writes only opt-in Relution response diagnostics. This function must stay
/// best-effort: callers do not observe filesystem or sanitization failures.
pub fn write_relution_response(
    method: &str,
    path: &str,
    status: u16,
    attempt: u32,
    disposition: &str,
    body: &[u8],
) {
    let Some(debug_path) = relution_debug_log_path() else {
        return;
    };
    write_relution_response_at(
        relution_diagnostics_enabled(),
        &debug_path,
        ResponseLogEvent {
            method,
            api_path: path,
            status,
            attempt,
            disposition,
            body,
        },
    );
}

pub fn relution_diagnostics_enabled() -> bool {
    option_env!("APPPORT_RELUTION_DIAGNOSTICS") == Some("true")
}

fn relution_debug_log_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| {
        PathBuf::from(base)
            .join("Relution")
            .join("Appport")
            .join("relution-debug.log")
    })
}

struct ResponseLogEvent<'a> {
    method: &'a str,
    api_path: &'a str,
    status: u16,
    attempt: u32,
    disposition: &'a str,
    body: &'a [u8],
}

fn write_relution_response_at(enabled: bool, path: &Path, event: ResponseLogEvent<'_>) {
    let Some(line) = response_diagnostic_line(enabled, &event) else {
        return;
    };
    write_relution_diagnostic_line(path, &line);
}

fn write_relution_diagnostic_line(path: &Path, line: &str) {
    write_relution_diagnostic_to_stderr(line);
    let Ok(_lock) = RELUTION_DEBUG_LOG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
    else {
        return;
    };
    let Some(directory) = path.parent() else {
        return;
    };
    if !*RELUTION_DEBUG_LOG_SECURITY_READY
        .get_or_init(|| prepare_diagnostic_directory(directory, path))
    {
        return;
    }
    append_rotating(path, line);
}

#[cfg(debug_assertions)]
fn write_relution_diagnostic_to_stderr(line: &str) {
    if relution_diagnostics_enabled() {
        let stderr = std::io::stderr();
        let mut stderr = stderr.lock();
        write_relution_diagnostic(&mut stderr, line);
    }
}

#[cfg(not(debug_assertions))]
fn write_relution_diagnostic_to_stderr(_: &str) {}

#[cfg(any(debug_assertions, test))]
fn write_relution_diagnostic(mut writer: impl Write, line: &str) {
    let _ = writeln!(writer, "APPPORT_RELUTION_DIAGNOSTIC {line}");
}

#[cfg(test)]
fn terminal_diagnostics_enabled_for(diagnostics_enabled: bool, debug_assertions: bool) -> bool {
    diagnostics_enabled && debug_assertions
}

fn response_diagnostic_line(enabled: bool, event: &ResponseLogEvent<'_>) -> Option<String> {
    enabled.then(|| {
        serde_json::json!({
            "method": safe_method(event.method),
            "path": api_path_only(event.api_path),
            "status": event.status,
            "attempt": event.attempt,
            "disposition": safe_disposition(event.disposition),
            "body": sanitize_response_body(event.body),
        })
        .to_string()
    })
}

fn safe_disposition(disposition: &str) -> &str {
    match disposition {
        "complete" | "retry" => disposition,
        _ => "invalid",
    }
}

fn safe_method(method: &str) -> &str {
    if method.bytes().all(|byte| byte.is_ascii_uppercase()) {
        method
    } else {
        "INVALID"
    }
}

fn api_path_only(path: &str) -> String {
    let path = path.split(['?', '#']).next().unwrap_or_default();
    if path.starts_with("/api/") {
        let segments = path.split('/').collect::<Vec<_>>();
        segments
            .iter()
            .enumerate()
            .map(|(index, &segment)| {
                if index > 3 && dynamic_path_segment(index, segment, &segments) {
                    "[redacted]".into()
                } else {
                    segment
                        .chars()
                        .filter(|character| !character.is_control())
                        .collect()
                }
            })
            .collect::<Vec<String>>()
            .join("/")
    } else {
        "/api/[invalid]".into()
    }
}

fn dynamic_path_segment(index: usize, segment: &str, segments: &[&str]) -> bool {
    let parent_is_collection = segments.get(index.saturating_sub(1)).is_some_and(|parent| {
        matches!(
            parent.to_ascii_lowercase().as_str(),
            "devices"
                | "users"
                | "apps"
                | "applications"
                | "actions"
                | "versions"
                | "groups"
                | "inventories"
                | "installedapps"
        )
    });
    let compact = segment.replace('-', "");
    parent_is_collection
        || compact.len() == 32 && compact.bytes().all(|byte| byte.is_ascii_hexdigit())
        || segment.len() > 24 && segment.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub fn write_relution_icon_response(
    path: &str,
    status: u16,
    content_type: &str,
    content_length: Option<u64>,
) {
    if !relution_diagnostics_enabled() {
        return;
    }
    let Some(debug_path) = relution_debug_log_path() else {
        return;
    };
    let line = icon_response_diagnostic_line(path, status, content_type, content_length);
    write_relution_diagnostic_line(&debug_path, &line);
}

fn icon_content_type(content_type: &str) -> &'static str {
    match content_type.split(';').next().map(str::trim) {
        Some("image/png") | Some("image/jpeg") | Some("image/webp") => "image",
        Some("application/json") => "json",
        Some(_) => "other",
        None => "missing",
    }
}

fn icon_response_diagnostic_line(
    path: &str,
    status: u16,
    content_type: &str,
    content_length: Option<u64>,
) -> String {
    serde_json::json!({
        "method": "GET",
        "path": api_path_only(path),
        "status": status,
        "attempt": 1,
        "disposition": "complete",
        "contentType": icon_content_type(content_type),
        "contentLength": content_length,
        "body": "[binary body omitted]",
    })
    .to_string()
}

fn sanitize_response_body(body: &[u8]) -> String {
    let text = match serde_json::from_slice::<Value>(body) {
        Ok(mut value) => {
            redact_json(&mut value, false);
            serde_json::to_string(&value).unwrap_or_else(|_| "[unserializable JSON]".into())
        }
        Err(_) => "[non-JSON response body omitted]".into(),
    };
    bound_text(&text, MAX_RELUTION_DIAGNOSTIC_BODY_BYTES)
}

fn redact_json(value: &mut Value, retain_number: bool) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|value| redact_json(value, false)),
        Value::Object(values) => {
            let mut redacted = serde_json::Map::new();
            for (index, (key, mut value)) in std::mem::take(values).into_iter().enumerate() {
                let output_key = if safe_json_key(&key) {
                    key.clone()
                } else {
                    format!("field_{index}")
                };
                if sensitive_json_key(&key) {
                    value = Value::String("[redacted]".into());
                } else {
                    redact_json(&mut value, numeric_diagnostic_key(&key));
                }
                redacted.insert(output_key, value);
            }
            *values = redacted;
        }
        Value::String(_) => *value = Value::String("[redacted]".into()),
        Value::Number(_) if !retain_number => *value = Value::String("[redacted]".into()),
        Value::Bool(_) | Value::Null | Value::Number(_) => {}
    }
}

fn numeric_diagnostic_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "count" | "total" | "limit" | "offset"
    )
}

fn safe_json_key(key: &str) -> bool {
    matches!(
        key,
        "results"
            | "errors"
            | "status"
            | "total"
            | "count"
            | "limit"
            | "offset"
            | "success"
            | "allowed"
            | "message"
            | "detail"
            | "code"
            | "type"
            | "items"
            | "uuid"
            | "id"
            | "name"
            | "email"
            | "user"
            | "device"
            | "serial"
            | "dmid"
            | "identifier"
            | "platforms"
            | "versions"
            | "RELEASE"
            | "read"
            | "activated"
            | "update"
            | "icon"
    )
}

fn sensitive_json_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "password",
        "secret",
        "cookie",
        "authorization",
        "credential",
        "api_key",
        "apikey",
        "session",
    ]
    .iter()
    .any(|marker| key.contains(marker))
}

fn bound_text(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.into();
    }
    let suffix = "[truncated]";
    let mut output = String::new();
    for character in value.chars() {
        if output.len() + character.len_utf8() + suffix.len() > maximum_bytes {
            break;
        }
        output.push(character);
    }
    output.push_str(suffix);
    output
}

fn append_rotating(path: &Path, line: &str) {
    if !diagnostic_path_is_reparse_free(path) {
        return;
    }
    remove_expired_diagnostic_logs(path);
    let line = bound_text(line, MAX_FILE_BYTES.saturating_sub(1) as usize);
    let incoming = line.len() as u64 + 1;
    if fs::metadata(path)
        .map(|metadata| metadata.len().saturating_add(incoming) > MAX_FILE_BYTES)
        .unwrap_or(false)
    {
        let rotated = path.with_extension("log.1");
        if !diagnostic_path_is_reparse_free(&rotated) {
            return;
        }
        let _ = fs::remove_file(&rotated);
        if fs::rename(path, &rotated).is_err() || !prepare_rotated_diagnostic_logs(path, &rotated) {
            return;
        }
    }
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn prepare_diagnostic_directory(directory: &Path, active_log: &Path) -> bool {
    if fs::create_dir_all(directory).is_err()
        || !diagnostic_path_is_reparse_free(directory)
        || !secure_diagnostic_path(directory)
    {
        return false;
    }
    let rotated = active_log.with_extension("log.1");
    if !existing_diagnostic_file_is_safe(active_log) || !existing_diagnostic_file_is_safe(&rotated)
    {
        return false;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(active_log)
        .is_ok()
        && secure_diagnostic_path(active_log)
}

fn existing_diagnostic_file_is_safe(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.file_type().is_symlink() || !diagnostic_path_is_reparse_free(path) =>
        {
            false
        }
        Ok(_) => secure_diagnostic_path(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

fn prepare_rotated_diagnostic_logs(active_log: &Path, rotated_log: &Path) -> bool {
    if !diagnostic_path_is_reparse_free(rotated_log) || !secure_diagnostic_path(rotated_log) {
        return false;
    }
    fs::OpenOptions::new()
        .create_new(true)
        .append(true)
        .open(active_log)
        .is_ok()
        && diagnostic_path_is_reparse_free(active_log)
        && secure_diagnostic_path(active_log)
}

fn diagnostic_path_is_reparse_free(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        match fs::symlink_metadata(path) {
            Ok(metadata) => !is_reparse_point(metadata.file_attributes()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

fn is_reparse_point(file_attributes: u32) -> bool {
    file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(windows)]
fn secure_diagnostic_path(path: &Path) -> bool {
    crate::journal::secure_current_user(path).is_ok()
}

#[cfg(not(windows))]
fn secure_diagnostic_path(_: &Path) -> bool {
    true
}

fn remove_expired_diagnostic_logs(path: &Path) {
    for candidate in [path.to_path_buf(), path.with_extension("log.1")] {
        let expired = fs::metadata(&candidate)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > MAX_RELUTION_DIAGNOSTIC_AGE);
        if expired {
            let _ = fs::remove_file(candidate);
        }
    }
}

#[cfg(test)]
#[path = "relution_diagnostics_tests.rs"]
mod tests;
