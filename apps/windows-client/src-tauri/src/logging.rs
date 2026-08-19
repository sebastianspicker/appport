use std::{fs, path::PathBuf};

mod relution_diagnostics;

pub use relution_diagnostics::{
    relution_diagnostics_enabled, write_relution_icon_response, write_relution_response,
    MAX_RELUTION_DIAGNOSTIC_BODY_BYTES,
};

const MAX_FILE_BYTES: u64 = 256 * 1024;

pub fn write(event: &str) {
    let text = sanitize(event);
    let path = log_path();
    if fs::metadata(&path)
        .map(|metadata| metadata.len() > MAX_FILE_BYTES)
        .unwrap_or(false)
    {
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, rotated);
    }
    let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| std::path::Path::new(".")));
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{text}");
    }
}

fn log_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Relution")
        .join("Appport")
        .join("client.log")
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
