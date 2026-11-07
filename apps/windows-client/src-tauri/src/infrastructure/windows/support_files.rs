//! Reparse-safe, bounded file operations for support bundle generation.

use super::support::{SupportError, MAX_LOG_BYTES};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

#[cfg(windows)]
pub(super) fn ensure_fixed_output_root(root: &Path) -> Result<(), SupportError> {
    let base = super::system_tools::local_app_data().map_err(|_| SupportError::Containment)?;
    let expected = base.join("Relution").join("Appport").join("SupportBundles");
    if root != expected {
        return Err(SupportError::Containment);
    }
    let mut current = base;
    for component in ["Relution", "Appport", "SupportBundles"] {
        ensure_fixed_root_component(&mut current, component)?;
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_fixed_root_component(current: &mut PathBuf, component: &str) -> Result<(), SupportError> {
    current.push(component);
    match fs::symlink_metadata(&current) {
        Ok(metadata) if metadata.is_dir() && !is_reparse_point(current)? => {}
        Ok(_) => return Err(SupportError::Containment),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&current).map_err(|_| SupportError::Containment)?;
        }
        Err(_) => return Err(SupportError::Containment),
    }
    secure_current_user(current)
}

#[cfg(not(windows))]
pub(super) fn ensure_fixed_output_root(_: &Path) -> Result<(), SupportError> {
    Err(SupportError::Unsupported)
}

pub(super) fn ensure_safe_root(root: &Path) -> Result<(), SupportError> {
    if !root.is_absolute()
        || root
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(SupportError::Containment);
    }
    fs::create_dir_all(root).map_err(|_| SupportError::Containment)?;
    if is_reparse_point(root)? {
        return Err(SupportError::Containment);
    }
    secure_current_user(root)
}

fn is_reparse_point(path: &Path) -> Result<bool, SupportError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| SupportError::Containment)?;
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(metadata.file_attributes() & 0x400 != 0)
    }
    #[cfg(not(windows))]
    Ok(false)
}

pub(super) fn make_temp_directory(root: &Path) -> Result<PathBuf, SupportError> {
    for _ in 0..32 {
        let candidate = root.join(format!(".support-tmp-{:016x}", rand::random::<u64>()));
        match fs::create_dir(&candidate) {
            Ok(()) => {
                secure_current_user(&candidate)?;
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(SupportError::AssemblyFailed),
        }
    }
    Err(SupportError::AssemblyFailed)
}

pub(super) fn secure_current_user(path: &Path) -> Result<(), SupportError> {
    #[cfg(windows)]
    {
        crate::infrastructure::journal::secure_current_user(path)
            .map_err(|_| SupportError::Containment)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

pub(super) fn generated_bundle_file_name() -> Result<String, SupportError> {
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| SupportError::AssemblyFailed)?
        .as_secs();
    let random = rand::random::<u64>();
    let name = format!("Appport-Support-{epoch}-{random:016x}.zip");
    if name.len() > 128
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
    {
        return Err(SupportError::AssemblyFailed);
    }
    Ok(name)
}

pub(super) fn valid_warning_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

pub(super) fn read_sanitized_log(
    path: Option<&Path>,
    warning: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<u8>, SupportError> {
    let Some(path) = path else {
        warnings.push(warning.to_owned());
        return Ok(Vec::new());
    };
    let mut input = match open_regular_file_without_reparse(path) {
        Ok(file) => file,
        Err(_) => {
            warnings.push(warning.to_owned());
            return Ok(Vec::new());
        }
    };
    let mut raw = Vec::with_capacity(MAX_LOG_BYTES + 1);
    Read::take(&mut input, (MAX_LOG_BYTES + 1) as u64)
        .read_to_end(&mut raw)
        .map_err(|_| SupportError::AssemblyFailed)?;
    record_truncation(&mut raw, warnings);
    let (sanitized, redacted) = sanitize_log(&raw);
    if redacted {
        warnings.push("client_log_redacted".to_owned());
    }
    Ok(sanitized.into_bytes())
}

fn record_truncation(raw: &mut Vec<u8>, warnings: &mut Vec<String>) {
    if raw.len() <= MAX_LOG_BYTES {
        return;
    }
    raw.truncate(MAX_LOG_BYTES);
    warnings.push("client_log_truncated".to_owned());
}

fn open_regular_file_without_reparse(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        let file = options.open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(std::io::Error::other("log source is not a regular file"));
        }
        Ok(file)
    }
    #[cfg(not(windows))]
    {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.file_type().is_file() {
            return Err(std::io::Error::other("log source is not a regular file"));
        }
        let file = options.open(path)?;
        ensure_unchanged_file(&metadata, &file)?;
        Ok(file)
    }
}

#[cfg(all(not(windows), unix))]
fn ensure_unchanged_file(before: &fs::Metadata, file: &File) -> std::io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let opened = file.metadata()?;
    if before.dev() != opened.dev() || before.ino() != opened.ino() {
        return Err(std::io::Error::other("log source changed while opening"));
    }
    Ok(())
}

#[cfg(all(not(windows), not(unix)))]
fn ensure_unchanged_file(_: &fs::Metadata, _: &File) -> std::io::Result<()> {
    Ok(())
}

fn sanitize_log(raw: &[u8]) -> (String, bool) {
    const SECRET_MARKERS: [&str; 9] = [
        "authorization:",
        "bearer ",
        "access_token",
        "password",
        "token=",
        "raw_body",
        "relution-debug",
        "journal",
        "installed apps",
    ];
    let mut changed = false;
    let mut kept = Vec::new();
    for line in String::from_utf8_lossy(raw).lines() {
        // The app's own fixed error texts ("action journal is unavailable") stay diagnosable.
        let lower = line.to_ascii_lowercase().replace("action journal ", " ");
        if SECRET_MARKERS.iter().any(|marker| lower.contains(marker)) {
            changed = true;
            continue;
        }
        let (line, replaced) = redact_profile_path(line);
        changed |= replaced;
        kept.push(line);
    }
    (kept.join("\n"), changed)
}

fn redact_profile_path(line: &str) -> (String, bool) {
    let (line, windows) = redact_profile_segment(line, &line.to_ascii_lowercase(), "\\users\\");
    let (line, unix) = redact_profile_segment(&line, &line, "/Users/");
    (line, windows || unix)
}

fn redact_profile_segment(line: &str, searchable: &str, marker: &str) -> (String, bool) {
    let mut redacted = String::new();
    let mut copied = 0;
    while let Some(offset) = searchable[copied..].find(marker) {
        let index = copied + offset;
        let start = index + marker.len();
        let end = line[start..]
            .find(['\\', '/'])
            .map_or(line.len(), |offset| start + offset);
        redacted.push_str(&line[copied..index]);
        redacted.push_str("[profile-path]");
        copied = end;
    }
    redacted.push_str(&line[copied..]);
    (redacted, copied > 0)
}

pub(super) fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), SupportError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path)
        .map_err(|_| SupportError::AssemblyFailed)?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| SupportError::AssemblyFailed)
}

#[cfg(test)]
mod tests {
    use super::{make_temp_directory, sanitize_log};
    use std::fs;

    #[test]
    fn every_profile_path_on_a_line_is_redacted() {
        let (log, changed) = sanitize_log(b"C:\\Users\\anna\\a -> C:\\Users\\bob\\b /Users/carl/c");
        assert!(changed);
        assert_eq!(
            log,
            "C:[profile-path]\\a -> C:[profile-path]\\b [profile-path]/c"
        );
    }

    #[test]
    fn own_journal_error_texts_survive_log_sanitizing() {
        let raw = [
            "command failed: unknown: action journal is unavailable",
            "journal entry 1",
            "action journal failed, Bearer secret",
        ]
        .join("\n");
        let (log, changed) = sanitize_log(raw.as_bytes());
        assert_eq!(
            log,
            "command failed: unknown: action journal is unavailable"
        );
        assert!(changed);
    }

    #[test]
    fn leftover_temp_directories_do_not_block_new_bundles() {
        let root =
            std::env::temp_dir().join(format!("appport-tmp-test-{:016x}", rand::random::<u64>()));
        for attempt in 0..64 {
            fs::create_dir_all(root.join(format!(".support-tmp-{attempt}"))).unwrap();
        }
        let created = make_temp_directory(&root).unwrap();
        assert!(created.is_dir());
        fs::remove_dir_all(root).unwrap();
    }
}
