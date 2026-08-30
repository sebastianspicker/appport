use super::{
    api_path_only, append_rotating, icon_content_type, icon_response_diagnostic_line,
    is_reparse_point, redact_json, response_diagnostic_line, terminal_diagnostics_enabled_for,
    write_relution_diagnostic, write_relution_response_at, ResponseLogEvent,
    FILE_ATTRIBUTE_REPARSE_POINT, MAX_FILE_BYTES, MAX_RELUTION_DIAGNOSTIC_BODY_BYTES,
};
#[cfg(windows)]
use super::{existing_diagnostic_file_is_safe, prepare_diagnostic_directory};
use crate::infrastructure::logging::sanitize;
use serde_json::Value;
use std::{fs, io::Write, path::PathBuf};

#[test]
fn strips_controls_and_masks_tokens() {
    assert_eq!(
        sanitize("Bearer abc\naccess_token=xyz"),
        "Bearer [redacted]access_token=[redacted]"
    );
}

#[test]
fn removes_sentinel_secrets() {
    let sanitized = sanitize("Bearer sentinel-bearer access_token=sentinel-token&next=yes");
    assert!(!sanitized.contains("sentinel-bearer"));
    assert!(!sanitized.contains("sentinel-token"));
}

#[test]
fn disabled_response_diagnostics_do_not_create_a_log_file() {
    let path = test_log_path("disabled");
    write_relution_response_at(
        false,
        &path,
        response_event("GET", "/api/management/v1/users", 403, 1, "complete", b"{}"),
    );
    assert!(!path.exists());
}

#[test]
fn terminal_diagnostics_require_the_compiled_opt_in_and_debug_assertions() {
    assert!(terminal_diagnostics_enabled_for(true, true));
    assert!(!terminal_diagnostics_enabled_for(false, true));
    assert!(!terminal_diagnostics_enabled_for(true, false));
    assert!(!terminal_diagnostics_enabled_for(false, false));
}

#[test]
fn terminal_diagnostic_is_one_sanitized_json_line() {
    let line = response_diagnostic_line(true, &response_event("POST", "/api/management/v1/users/private-user?access_token=query-secret", 403, 1, "complete", br#"{"message":"private-message","token":"token-secret","email":"person@example.invalid"}"#)).unwrap();
    let mut output = Vec::new();
    write_relution_diagnostic(&mut output, &line);
    let output = String::from_utf8(output).unwrap();
    assert_eq!(output.lines().count(), 1);
    serde_json::from_str::<Value>(
        output
            .strip_prefix("APPPORT_RELUTION_DIAGNOSTIC ")
            .unwrap()
            .trim_end(),
    )
    .unwrap();
    for secret in [
        "private-user",
        "query-secret",
        "private-message",
        "token-secret",
        "person@example.invalid",
    ] {
        assert!(!output.contains(secret));
    }
}

#[test]
fn terminal_diagnostic_ignores_sink_failures() {
    struct FailingWriter;
    impl Write for FailingWriter {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("closed diagnostic sink"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::other("closed diagnostic sink"))
        }
    }
    write_relution_diagnostic(FailingWriter, "{}");
}

#[test]
fn reparse_point_detection_accepts_regular_attributes_and_rejects_the_flag() {
    assert!(!is_reparse_point(0));
    assert!(!is_reparse_point(0x20));
    assert!(is_reparse_point(FILE_ATTRIBUTE_REPARSE_POINT));
    assert!(is_reparse_point(FILE_ATTRIBUTE_REPARSE_POINT | 0x20));
}

#[test]
fn response_diagnostics_exclude_queries_and_redact_nested_secrets() {
    let line = response_diagnostic_line(true, &response_event("GET", "/api/management/v1/devices/123e4567-e89b-12d3-a456-426614174000?access_token=query-secret", 403, 2, "retry", br#"{"message":"forbidden","access_token":"access-secret","nested":{"cookie":"cookie-secret","password":"password-secret","email":"person@example.invalid","serial":"device-serial-123","identifier":"package-id-123"},"items":[{"bearerToken":"bearer-secret","name":"ordinary"}],"total":2,"allowed":false}"#)).unwrap();
    for secret in [
        "query-secret",
        "access-secret",
        "cookie-secret",
        "password-secret",
        "bearer-secret",
        "person@example.invalid",
        "device-serial-123",
        "package-id-123",
    ] {
        assert!(!line.contains(secret));
    }
    let record: Value = serde_json::from_str(&line).unwrap();
    let body = record["body"].as_str().unwrap();
    assert_eq!(record["path"], "/api/management/v1/devices/[redacted]");
    assert_eq!(record["attempt"], 2);
    assert_eq!(record["disposition"], "retry");
    assert!(!body.contains("forbidden"));
    assert!(!body.contains("ordinary"));
    assert!(body.contains("\"total\":2"));
    assert!(body.contains("\"allowed\":false"));
    assert!(body.contains("[redacted]"));
}

#[test]
fn json_redaction_retains_only_allowlisted_numbers_and_safe_keys() {
    let mut body = serde_json::json!({
        "total": 2,
        "message": "ordinary text",
        "results": {"count": 1, "value": 7},
        "access_token": "secret",
        "unsafe-key": true,
    });
    redact_json(&mut body, false);

    assert_eq!(body["total"], 2);
    assert_eq!(body["message"], "[redacted]");
    assert_eq!(body["results"]["count"], 1);
    assert_eq!(body["results"]["field_1"], "[redacted]");
    assert_eq!(body["field_0"], "[redacted]");
    assert!(body
        .as_object()
        .is_some_and(|values| values.values().any(|value| value == true)));
}

#[test]
fn path_templates_redact_short_and_percent_encoded_identifiers() {
    assert_eq!(
        api_path_only("/api/management/v1/users/alice/actions"),
        "/api/management/v1/users/[redacted]/actions"
    );
    assert_eq!(
        api_path_only("/api/management/v1/apps/device%2Fsecret/icon"),
        "/api/management/v1/apps/[redacted]/icon"
    );
}

#[test]
fn malformed_bodies_are_sanitized_and_bounded() {
    let body = format!(
        "Bearer bearer-secret password=password-secret {}",
        "x".repeat(16 * 1024)
    );
    let line = response_diagnostic_line(
        true,
        &response_event("POST", "/api/test", 500, 1, "complete", body.as_bytes()),
    )
    .unwrap();
    assert!(!line.contains("bearer-secret"));
    assert!(!line.contains("password-secret"));
    assert!(line.len() <= 8 * 1024 + 256);
    assert!(line.contains("[non-JSON response body omitted]"));
}

#[test]
fn valid_json_bodies_are_bounded_after_redaction() {
    let body = serde_json::json!({"results": vec!["ordinary"; 2048]}).to_string();
    let line = response_diagnostic_line(
        true,
        &response_event(
            "GET",
            "/api/management/v1/content/apps",
            200,
            1,
            "complete",
            body.as_bytes(),
        ),
    )
    .unwrap();
    let record: Value = serde_json::from_str(&line).unwrap();
    let redacted_body = record["body"].as_str().unwrap();
    assert!(redacted_body.len() <= MAX_RELUTION_DIAGNOSTIC_BODY_BYTES);
    assert!(redacted_body.ends_with("[truncated]"));
    assert!(!redacted_body.contains("ordinary"));
}

#[test]
fn icon_diagnostic_classifies_content_without_exposing_binary_data() {
    assert_eq!(icon_content_type("image/png; charset=binary"), "image");
    assert_eq!(icon_content_type("application/json"), "json");
    assert_eq!(icon_content_type("text/html"), "other");
    assert_eq!(icon_content_type(""), "other");
    let record: Value = serde_json::from_str(&icon_response_diagnostic_line(
        "/api/management/v1/content/apps/private-app/icon",
        200,
        "image/png",
        Some(42),
    ))
    .unwrap();
    assert_eq!(
        record["path"],
        "/api/management/v1/content/apps/[redacted]/icon"
    );
    assert_eq!(record["contentType"], "image");
    assert_eq!(record["contentLength"], 42);
    assert_eq!(record["body"], "[binary body omitted]");
}

#[cfg(windows)]
#[test]
fn rotation_restricts_active_and_rotated_logs_to_the_current_user() {
    let path = test_log_path("windows-acl-rotation");
    let directory = path.parent().unwrap();
    assert!(prepare_diagnostic_directory(directory, &path));
    fs::write(&path, vec![b'x'; MAX_FILE_BYTES as usize - 4]).unwrap();
    append_rotating(&path, "response body");
    let rotated = path.with_extension("log.1");
    assert!(path.exists());
    assert!(rotated.exists());
    assert!(existing_diagnostic_file_is_safe(&path));
    assert!(existing_diagnostic_file_is_safe(&rotated));
    let _ = fs::remove_dir_all(directory);
}

fn test_log_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("test-artifacts")
        .join(format!(
            "appport-relution-logging-{name}-{}",
            std::process::id()
        ))
        .join("relution-debug.log")
}

fn response_event<'a>(
    method: &'a str,
    api_path: &'a str,
    status: u16,
    attempt: u32,
    disposition: &'a str,
    body: &'a [u8],
) -> ResponseLogEvent<'a> {
    ResponseLogEvent {
        method,
        api_path,
        status,
        attempt,
        disposition,
        body,
    }
}

#[test]
fn response_log_files_rotate_before_exceeding_the_limit() {
    let path = test_log_path("rotation");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, vec![b'x'; MAX_FILE_BYTES as usize - 4]).unwrap();
    append_rotating(&path, "response body");
    let rotated = path.with_extension("log.1");
    assert!(rotated.exists());
    assert!(fs::metadata(&path).unwrap().len() <= MAX_FILE_BYTES);
    assert!(fs::metadata(&rotated).unwrap().len() <= MAX_FILE_BYTES);
    let _ = fs::remove_dir_all(path.parent().unwrap());
}
