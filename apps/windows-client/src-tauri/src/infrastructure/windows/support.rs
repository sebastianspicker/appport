//! Privacy-bounded Windows support bundle assembly.
//!
//! Archives contain only the files named by `BUNDLE_FILES`.  In particular,
//! credentials, request bodies, journals, Relution diagnostics, installed-app
//! inventory, security logs, proof files, and profile paths are not collected.

use crate::infrastructure::windows::support_archive::{
    manifest_bytes, zip_stored, ManifestMetadata,
};
use crate::infrastructure::windows::support_collectors::{
    validate_matched_relution_ip, NetworkSummary,
};
use crate::infrastructure::windows::support_files::{
    ensure_fixed_output_root, ensure_safe_root, generated_bundle_file_name, make_temp_directory,
    read_sanitized_log, secure_current_user, valid_warning_code, write_new_file,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) const MAX_LOG_BYTES: usize = 256 * 1024;
pub(crate) const MAX_ARCHIVE_BYTES: usize = 4 * 1024 * 1024;

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
    let mut warnings = collect_warnings(request);
    let mut files = bundle_payloads(request, &mut warnings)?;
    files.push((
        "manifest.json",
        manifest_bytes(
            ManifestMetadata {
                created_at: &request.created_at,
                app_version: &request.details.app_version,
                source_revision: &request.details.source_revision,
            },
            &warnings,
            &files,
        )?,
    ));
    let archive = zip_stored(&files, MAX_ARCHIVE_BYTES)?;
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

fn collect_warnings(request: &SupportBundleRequest) -> Vec<String> {
    request
        .collector_warnings
        .iter()
        .chain(&request.network_summary.warnings)
        .filter(|warning| valid_warning_code(warning))
        .cloned()
        .collect()
}

fn bundle_payloads(
    request: &SupportBundleRequest,
    warnings: &mut Vec<String>,
) -> Result<Vec<(&'static str, Vec<u8>)>, SupportError> {
    Ok(vec![
        ("support-details.json", json_bytes(&request.details)?),
        (
            "catalog-summary.json",
            json_bytes(&request.catalog_summary)?,
        ),
        (
            "network-summary.json",
            json_bytes(&request.network_summary)?,
        ),
        (
            "client.log",
            read_sanitized_log(
                request.client_log.as_deref(),
                "client_log_missing",
                warnings,
            )?,
        ),
        (
            "client.log.1",
            read_sanitized_log(
                request.client_log_1.as_deref(),
                "client_log_1_missing",
                warnings,
            )?,
        ),
    ])
}

fn json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, SupportError> {
    serde_json::to_vec_pretty(value).map_err(|_| SupportError::AssemblyFailed)
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
