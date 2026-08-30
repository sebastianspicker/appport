//! Privacy-bounded Windows support bundle assembly.
//!
//! Archives contain only the files named by `BUNDLE_FILES`.  In particular,
//! credentials, request bodies, journals, Relution diagnostics, installed-app
//! inventory, security logs, proof files, and profile paths are not collected.

use crate::infrastructure::windows::support_collectors::{
    validate_matched_relution_ip, NetworkSummary,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) const MAX_LOG_BYTES: usize = 256 * 1024;
pub(crate) const MAX_ARCHIVE_BYTES: usize = 4 * 1024 * 1024;
const BUNDLE_SCHEMA: u32 = 1;
const BUNDLE_FILES: [&str; 6] = [
    "support-details.json",
    "catalog-summary.json",
    "network-summary.json",
    "client.log",
    "client.log.1",
    "manifest.json",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportDetails {
    pub app_version: String,
    pub source_revision: String,
    pub username: String,
    pub device_name: String,
    pub device_status: String,
    pub windows_display: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub smbios_serial: Option<String>,
    pub matched_relution_last_ip: Option<String>,
    pub matched_relution_last_connection_at: Option<String>,
    pub assigned_eligible_count: u32,
    pub available_count: u32,
    pub update_count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportCatalogSummary {
    pub assigned_eligible_count: u32,
    pub available_count: u32,
    pub update_count: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct SupportBundleRequest {
    pub consent: bool,
    pub created_at: String,
    pub details: SupportDetails,
    pub catalog_summary: SupportCatalogSummary,
    pub network_summary: NetworkSummary,
    pub collector_warnings: Vec<String>,
    pub client_log: Option<PathBuf>,
    pub client_log_1: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupportBundleResult {
    pub bundle_file_name: String,
    pub bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SupportError {
    ConsentRequired,
    GenerationActive,
    Unsupported,
    Containment,
    InvalidRequest,
    AssemblyFailed,
    ArchiveTooLarge,
}

impl SupportError {
    pub(crate) const fn code(self) -> &'static str {
        match self {
            Self::ConsentRequired => "SUPPORT_CONSENT_REQUIRED",
            Self::GenerationActive => "SUPPORT_GENERATION_ACTIVE",
            Self::Unsupported => "SUPPORT_UNSUPPORTED",
            Self::Containment => "SUPPORT_CONTAINMENT_REJECTED",
            Self::InvalidRequest => "SUPPORT_INVALID_REQUEST",
            Self::AssemblyFailed => "SUPPORT_ASSEMBLY_FAILED",
            Self::ArchiveTooLarge => "SUPPORT_ARCHIVE_TOO_LARGE",
        }
    }

    pub(crate) const fn client_message(self) -> &'static str {
        match self {
            Self::ConsentRequired => "support: explicit consent is required",
            Self::GenerationActive => "support: a bundle is already being generated",
            Self::Unsupported => "support: support bundles are only available on Windows",
            Self::Containment => "support: support bundle storage is unavailable",
            Self::InvalidRequest => "support: invalid bundle request",
            Self::AssemblyFailed => "support: unable to create support bundle",
            Self::ArchiveTooLarge => "support: support bundle exceeds the size limit",
        }
    }
}

impl std::fmt::Display for SupportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.client_message())
    }
}

impl std::error::Error for SupportError {}

static GENERATION: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug)]
pub(crate) struct SupportGenerationPermit(MutexGuard<'static, ()>);

pub(crate) fn try_begin_generation() -> Result<SupportGenerationPermit, SupportError> {
    let lock = GENERATION.get_or_init(|| Mutex::new(()));
    lock.try_lock()
        .map(SupportGenerationPermit)
        .map_err(|_| SupportError::GenerationActive)
}

pub(crate) fn default_support_bundle_root() -> Result<PathBuf, SupportError> {
    #[cfg(windows)]
    {
        Ok(
            crate::infrastructure::windows::system_tools::local_app_data()
                .map_err(|_| SupportError::Containment)?
                .join("Relution")
                .join("Appport")
                .join("SupportBundles"),
        )
    }
    #[cfg(not(windows))]
    {
        Err(SupportError::Unsupported)
    }
}

pub(crate) fn generate_support_bundle(
    request: &SupportBundleRequest,
) -> Result<SupportBundleResult, SupportError> {
    let root = default_support_bundle_root()?;
    ensure_fixed_output_root(&root)?;
    generate_support_bundle_in(&root, request)
}

pub(crate) fn open_support_folder() -> Result<(), SupportError> {
    let root = default_support_bundle_root()?;
    ensure_fixed_output_root(&root)?;
    #[cfg(windows)]
    {
        crate::infrastructure::windows::system_tools::command("explorer.exe")
            .map_err(|_| SupportError::AssemblyFailed)?
            .arg(root)
            .spawn()
            .map(|_| ())
            .map_err(|_| SupportError::AssemblyFailed)
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Err(SupportError::Unsupported)
    }
}

#[cfg(windows)]
fn ensure_fixed_output_root(root: &Path) -> Result<(), SupportError> {
    let base = crate::infrastructure::windows::system_tools::local_app_data()
        .map_err(|_| SupportError::Containment)?;
    let expected = base.join("Relution").join("Appport").join("SupportBundles");
    if root != expected {
        return Err(SupportError::Containment);
    }
    let mut current = base;
    for component in ["Relution", "Appport", "SupportBundles"] {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if !metadata.is_dir() || is_reparse_point(&current)? {
                    return Err(SupportError::Containment);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|_| SupportError::Containment)?;
            }
            Err(_) => return Err(SupportError::Containment),
        }
        secure_current_user(&current)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn ensure_fixed_output_root(_: &Path) -> Result<(), SupportError> {
    Err(SupportError::Unsupported)
}

/// Test and integration seam. Production callers must use `generate_support_bundle`.
pub(crate) fn generate_support_bundle_in(
    root: &Path,
    request: &SupportBundleRequest,
) -> Result<SupportBundleResult, SupportError> {
    let _permit = try_begin_generation()?;
    if !request.consent {
        return Err(SupportError::ConsentRequired);
    }
    if request.created_at.is_empty() {
        return Err(SupportError::InvalidRequest);
    }
    if validate_matched_relution_ip(request.details.matched_relution_last_ip.as_deref()).is_err() {
        return Err(SupportError::InvalidRequest);
    }
    ensure_safe_root(root)?;
    let temp = make_temp_directory(root)?;
    let outcome = assemble_bundle(root, &temp, request);
    let _ = fs::remove_dir_all(&temp);
    outcome
}

fn assemble_bundle(
    root: &Path,
    temp: &Path,
    request: &SupportBundleRequest,
) -> Result<SupportBundleResult, SupportError> {
    let mut warnings = request
        .collector_warnings
        .iter()
        .filter(|warning| valid_warning_code(warning))
        .cloned()
        .collect::<Vec<_>>();
    warnings.extend(
        request
            .network_summary
            .warnings
            .iter()
            .filter(|warning| valid_warning_code(warning))
            .cloned(),
    );
    let details =
        serde_json::to_vec_pretty(&request.details).map_err(|_| SupportError::AssemblyFailed)?;
    let catalog = serde_json::to_vec_pretty(&request.catalog_summary)
        .map_err(|_| SupportError::AssemblyFailed)?;
    let network = serde_json::to_vec_pretty(&request.network_summary)
        .map_err(|_| SupportError::AssemblyFailed)?;
    let log = read_sanitized_log(
        request.client_log.as_deref(),
        "client_log_missing",
        &mut warnings,
    )?;
    let log_one = read_sanitized_log(
        request.client_log_1.as_deref(),
        "client_log_1_missing",
        &mut warnings,
    )?;
    let mut files = vec![
        ("support-details.json", details),
        ("catalog-summary.json", catalog),
        ("network-summary.json", network),
        ("client.log", log),
        ("client.log.1", log_one),
    ];
    let manifest = BundleManifest::from_files(request, &warnings, &files);
    files.push((
        "manifest.json",
        serde_json::to_vec_pretty(&manifest).map_err(|_| SupportError::AssemblyFailed)?,
    ));
    let archive = zip_stored(&files)?;
    if archive.len() > MAX_ARCHIVE_BYTES {
        return Err(SupportError::ArchiveTooLarge);
    }
    let file_name = generated_bundle_file_name()?;
    let temporary_archive = temp.join("bundle.zip");
    write_new_file(&temporary_archive, &archive)?;
    secure_current_user(&temporary_archive)?;
    let destination = root.join(&file_name);
    if fs::hard_link(&temporary_archive, &destination).is_err() {
        return Err(SupportError::AssemblyFailed);
    }
    fs::remove_file(&temporary_archive).map_err(|_| SupportError::AssemblyFailed)?;
    if secure_current_user(&destination).is_err() {
        let _ = fs::remove_file(&destination);
        return Err(SupportError::Containment);
    }
    Ok(SupportBundleResult {
        bundle_file_name: file_name,
        bytes: archive.len() as u64,
        warnings,
    })
}

fn ensure_safe_root(root: &Path) -> Result<(), SupportError> {
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
    secure_current_user(root)?;
    Ok(())
}

fn is_reparse_point(path: &Path) -> Result<bool, SupportError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| SupportError::Containment)?;
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return Ok(metadata.file_attributes() & 0x400 != 0);
    }
    #[cfg(not(windows))]
    Ok(false)
}

fn make_temp_directory(root: &Path) -> Result<PathBuf, SupportError> {
    for attempt in 0..32 {
        let candidate = root.join(format!(".support-tmp-{attempt}"));
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

fn secure_current_user(path: &Path) -> Result<(), SupportError> {
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

fn generated_bundle_file_name() -> Result<String, SupportError> {
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

fn valid_warning_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn read_sanitized_log(
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
    if raw.len() > MAX_LOG_BYTES {
        raw.truncate(MAX_LOG_BYTES);
        warnings.push("client_log_truncated".to_owned());
    }
    let (sanitized, redacted) = sanitize_log(&raw);
    if redacted {
        warnings.push("client_log_redacted".to_owned());
    }
    Ok(sanitized.into_bytes())
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let opened = file.metadata()?;
            if metadata.dev() != opened.dev() || metadata.ino() != opened.ino() {
                return Err(std::io::Error::other("log source changed while opening"));
            }
        }
        Ok(file)
    }
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
        let lower = line.to_ascii_lowercase();
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
    let lower = line.to_ascii_lowercase();
    if let Some(index) = lower.find("\\users\\") {
        let end = line[index + 7..]
            .find(['\\', '/'])
            .map(|offset| index + 7 + offset)
            .unwrap_or(line.len());
        return (
            format!("{}[profile-path]{}", &line[..index], &line[end..]),
            true,
        );
    }
    if let Some(index) = line.find("/Users/") {
        let end = line[index + 7..]
            .find('/')
            .map(|offset| index + 7 + offset)
            .unwrap_or(line.len());
        return (
            format!("{}[profile-path]{}", &line[..index], &line[end..]),
            true,
        );
    }
    (line.to_owned(), false)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), SupportError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path)
        .map_err(|_| SupportError::AssemblyFailed)?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| SupportError::AssemblyFailed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    schema_version: u32,
    created_at: String,
    app_version: String,
    source_revision: String,
    consent: bool,
    warnings: Vec<String>,
    files: Vec<ManifestFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    name: String,
    bytes: usize,
    sha256: String,
}

impl BundleManifest {
    fn from_files(
        request: &SupportBundleRequest,
        warnings: &[String],
        files: &[(&str, Vec<u8>)],
    ) -> Self {
        Self {
            schema_version: BUNDLE_SCHEMA,
            created_at: request.created_at.clone(),
            app_version: request.details.app_version.clone(),
            source_revision: request.details.source_revision.clone(),
            consent: true,
            warnings: warnings.to_vec(),
            files: files
                .iter()
                .map(|(name, contents)| ManifestFile {
                    name: (*name).to_owned(),
                    bytes: contents.len(),
                    sha256: hex_sha256(contents),
                })
                .collect(),
        }
    }
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn zip_stored(files: &[(&str, Vec<u8>)]) -> Result<Vec<u8>, SupportError> {
    if files.len() != BUNDLE_FILES.len()
        || files
            .iter()
            .enumerate()
            .any(|(index, (name, _))| *name != BUNDLE_FILES[index])
    {
        return Err(SupportError::AssemblyFailed);
    }
    let mut archive = Vec::new();
    let mut central = Vec::new();
    for (name, contents) in files {
        let offset = u32::try_from(archive.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
        let name = name.as_bytes();
        let size = u32::try_from(contents.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
        let crc = crc32(contents);
        put_u32(&mut archive, 0x04034b50);
        put_u16(&mut archive, 20);
        put_u16(&mut archive, 0);
        put_u16(&mut archive, 0);
        put_u16(&mut archive, 0);
        put_u16(&mut archive, 0);
        put_u32(&mut archive, crc);
        put_u32(&mut archive, size);
        put_u32(&mut archive, size);
        put_u16(&mut archive, name.len() as u16);
        put_u16(&mut archive, 0);
        archive.extend_from_slice(name);
        archive.extend_from_slice(contents);
        put_u32(&mut central, 0x02014b50);
        put_u16(&mut central, 20);
        put_u16(&mut central, 20);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, crc);
        put_u32(&mut central, size);
        put_u32(&mut central, size);
        put_u16(&mut central, name.len() as u16);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, 0);
        put_u32(&mut central, offset);
        central.extend_from_slice(name);
    }
    let central_offset = u32::try_from(archive.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
    archive.extend_from_slice(&central);
    put_u32(&mut archive, 0x06054b50);
    put_u16(&mut archive, 0);
    put_u16(&mut archive, 0);
    put_u16(&mut archive, files.len() as u16);
    put_u16(&mut archive, files.len() as u16);
    put_u32(&mut archive, central.len() as u32);
    put_u32(&mut archive, central_offset);
    put_u16(&mut archive, 0);
    Ok(archive)
}

fn put_u16(target: &mut Vec<u8>, value: u16) {
    target.extend_from_slice(&value.to_le_bytes());
}
fn put_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & (0_u32.wrapping_sub(crc & 1)));
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_safe_root, generate_support_bundle_in, try_begin_generation, SupportBundleRequest,
        SupportCatalogSummary, SupportDetails, SupportError, MAX_ARCHIVE_BYTES, MAX_LOG_BYTES,
    };
    use crate::infrastructure::windows::support_collectors::bounded_network_summary;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    static TEST_GENERATION_LOCK: Mutex<()> = Mutex::new(());

    fn root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("appport-support-test-{unique}"))
    }

    fn request(log: Option<PathBuf>) -> SupportBundleRequest {
        SupportBundleRequest {
            consent: true,
            created_at: "2026-08-21T12:00:00Z".into(),
            details: SupportDetails {
                app_version: "0.1.0".into(),
                source_revision: "abc123".into(),
                username: "Ada".into(),
                device_name: "PC-42".into(),
                device_status: "managed".into(),
                windows_display: "25H2 (10.0.26200.8973)".into(),
                manufacturer: Some("Contoso".into()),
                model: Some("Model X".into()),
                smbios_serial: Some("SN-42".into()),
                matched_relution_last_ip: None,
                matched_relution_last_connection_at: None,
                assigned_eligible_count: 4,
                available_count: 3,
                update_count: 1,
            },
            catalog_summary: SupportCatalogSummary {
                assigned_eligible_count: 4,
                available_count: 3,
                update_count: 1,
            },
            network_summary: bounded_network_summary(std::iter::empty()),
            collector_warnings: vec!["smbios_unavailable".into()],
            client_log: log,
            client_log_1: None,
        }
    }

    #[test]
    fn rejects_missing_consent_and_concurrent_generation() {
        let _test_lock = TEST_GENERATION_LOCK.lock().unwrap();
        let mut no_consent = request(None);
        no_consent.consent = false;
        assert_eq!(
            generate_support_bundle_in(&root(), &no_consent).unwrap_err(),
            SupportError::ConsentRequired
        );
        let permit = try_begin_generation().unwrap();
        assert_eq!(
            try_begin_generation().unwrap_err(),
            SupportError::GenerationActive
        );
        drop(permit);
    }

    #[test]
    fn assembly_is_deterministic_and_sanitized() {
        let _test_lock = TEST_GENERATION_LOCK.lock().unwrap();
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let log = root.join("input.log");
        fs::write(
            &log,
            [
                "ok",
                "Authorization: Bearer sentinel-token",
                "password=private",
                "raw_body=private",
                "C:\\Users\\ada\\file",
                "journal entry",
                "relution-debug.log",
            ]
            .join("\n"),
        )
        .unwrap();
        let result = generate_support_bundle_in(&root, &request(Some(log))).unwrap();
        let archive = fs::read(root.join(&result.bundle_file_name)).unwrap();
        assert!(archive.len() <= MAX_ARCHIVE_BYTES);
        assert!(archive
            .windows(b"sentinel-token".len())
            .all(|part| part != b"sentinel-token"));
        assert!(archive
            .windows(b"private".len())
            .all(|part| part != b"private"));
        assert!(archive
            .windows(b"journal entry".len())
            .all(|part| part != b"journal entry"));
        assert!(archive
            .windows(b"relution-debug".len())
            .all(|part| part != b"relution-debug"));
        assert!(archive
            .windows(b"C:\\\\Users".len())
            .all(|part| part != b"C:\\\\Users"));
        assert!(archive
            .windows(b"[profile-path]".len())
            .any(|part| part == b"[profile-path]"));
        assert!(archive
            .windows(b"schemaVersion".len())
            .any(|part| part == b"schemaVersion"));
        assert!(archive
            .windows(b"support-details.json".len())
            .any(|part| part == b"support-details.json"));
        assert_eq!(
            &archive[archive.len() - 22..archive.len() - 18],
            &[0x50, 0x4b, 0x05, 0x06]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn log_limit_and_root_containment_are_enforced() {
        let _test_lock = TEST_GENERATION_LOCK.lock().unwrap();
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let log = root.join("large.log");
        fs::write(&log, vec![b'x'; MAX_LOG_BYTES + 100]).unwrap();
        let result = generate_support_bundle_in(&root, &request(Some(log))).unwrap();
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning == "client_log_truncated"));
        assert_eq!(
            ensure_safe_root(Path::new("relative")).unwrap_err(),
            SupportError::Containment
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_reparse_root() {
        use std::os::unix::fs::symlink;
        let root = root();
        let target = root.with_extension("target");
        fs::create_dir_all(&target).unwrap();
        symlink(&target, &root).unwrap();
        assert_eq!(
            ensure_safe_root(&root).unwrap_err(),
            SupportError::Containment
        );
        fs::remove_file(&root).unwrap();
        fs::remove_dir_all(target).unwrap();
    }
}
