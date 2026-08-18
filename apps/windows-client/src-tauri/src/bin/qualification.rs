//! Operator-only live qualification. Tokens are read once from a masked console and
//! are never accepted from arguments, environment variables, files, logs, or reports.

use relution_appport_lib::qualification::{
    run, CheckStatus, QualificationBinding, QualificationCheck, QualificationCredentials,
    QualificationPlan, QualificationReport,
};
use serde::Deserialize;
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MAX_JSON_BYTES: usize = 1024 * 1024;

fn prompt(label: &str) -> Result<String, String> {
    eprint!("{label}: ");
    io::stderr().flush().map_err(|_| "console unavailable")?;
    let mut value = String::new();
    io::stdin()
        .read_line(&mut value)
        .map_err(|_| "console unavailable")?;
    let value = value.trim().to_owned();
    if value.is_empty() {
        Err("required console value missing".into())
    } else {
        Ok(value)
    }
}

#[cfg(windows)]
fn token(label: &str) -> Result<String, String> {
    eprint!("{label}: ");
    io::stderr().flush().map_err(|_| "console unavailable")?;
    let value = rpassword::read_password().map_err(|_| "secure console input unavailable")?;
    if value.trim().is_empty() {
        Err("empty token".into())
    } else {
        Ok(value)
    }
}

#[cfg(not(windows))]
fn token(_: &str) -> Result<String, String> {
    Err("masked token input is available only on Windows".into())
}

struct InputPaths {
    candidate_evidence: PathBuf,
    plan: Option<PathBuf>,
}

fn input_paths() -> Result<InputPaths, String> {
    parse_input_paths(std::env::args_os().skip(1))
}

fn parse_input_paths<I, S>(arguments: I) -> Result<InputPaths, String>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    let arguments = arguments.into_iter().map(Into::into).collect::<Vec<_>>();
    if arguments.len() % 2 != 0 {
        return Err("every option requires a non-secret JSON path".into());
    }
    let mut candidate_evidence = None;
    let mut plan = None;
    for pair in arguments.chunks_exact(2) {
        if pair[0] == "--candidate-evidence" && candidate_evidence.is_none() {
            candidate_evidence = Some(absolute_input_path(&pair[1])?);
        } else if pair[0] == "--plan" && plan.is_none() {
            plan = Some(absolute_input_path(&pair[1])?);
        } else {
            return Err("only --candidate-evidence and --plan may be supplied once".into());
        }
    }
    Ok(InputPaths {
        candidate_evidence: candidate_evidence
            .ok_or_else(|| "--candidate-evidence is required".to_owned())?,
        plan,
    })
}

fn absolute_input_path(value: &std::ffi::OsString) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    path.is_absolute()
        .then_some(path)
        .ok_or_else(|| "qualification input paths must be absolute".into())
}

fn read_bounded_regular(path: &Path, label: &str, maximum: usize) -> Result<Vec<u8>, String> {
    let file = open_regular_input(path, label, maximum)?;
    read_open_bounded_regular(file, label, maximum)
}

fn open_regular_input(path: &Path, label: &str, maximum: usize) -> Result<fs::File, String> {
    let file = open_input_without_following(path).map_err(|_| format!("{label} is unavailable"))?;
    let metadata = file
        .metadata()
        .map_err(|_| format!("{label} is unreadable"))?;
    if !metadata.is_file() || input_handle_is_reparse_point(&metadata) {
        return Err(format!("{label} must be a regular non-symlink file"));
    }
    if metadata.len() > maximum as u64 {
        return Err(format!("{label} exceeds its size limit"));
    }
    Ok(file)
}

fn read_open_bounded_regular(
    file: fs::File,
    label: &str,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let capacity = usize::try_from(
        file.metadata()
            .map_err(|_| format!("{label} is unreadable"))?
            .len(),
    )
    .map_err(|_| format!("{label} exceeds its size limit"))?;
    let mut bytes = Vec::with_capacity(capacity.min(maximum));
    let mut reader = file.take(maximum as u64 + 1);
    reader
        .read_to_end(&mut bytes)
        .map_err(|_| format!("{label} is unreadable"))?;
    if bytes.len() > maximum {
        return Err(format!("{label} exceeds its size limit"));
    }
    Ok(bytes)
}

#[cfg(windows)]
fn open_input_without_following(path: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    // Keep the handle as the sole byte source. Opening the final path as the
    // reparse object and denying write/delete sharing makes substitutions fail
    // closed instead of resolving a symlink/reparse point or swapping files.
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0x0000_0001) // FILE_SHARE_READ
        .custom_flags(0x0020_0000) // FILE_FLAG_OPEN_REPARSE_POINT
        .open(path)
}

#[cfg(windows)]
fn input_handle_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_attributes() & 0x0000_0400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
}

#[cfg(unix)]
fn open_input_without_following(path: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(unix_no_follow_nonblocking_flags())
        .open(path)
}

#[cfg(unix)]
fn input_handle_is_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "linux")]
const fn unix_no_follow_nonblocking_flags() -> i32 {
    0x0002_0000 | 0x0000_0800 // O_NOFOLLOW | O_NONBLOCK
}

#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
const fn unix_no_follow_nonblocking_flags() -> i32 {
    0x0000_0100 | 0x0000_0004 // O_NOFOLLOW | O_NONBLOCK
}

fn load_plan(path: Option<PathBuf>) -> Result<Option<QualificationPlan>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes = read_bounded_regular(&path, "qualification plan", MAX_JSON_BYTES)?;
    QualificationPlan::parse(&bytes).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateEvidence {
    schema_version: u8,
    candidate_ready: bool,
    profile: String,
    writes_enabled: bool,
    repository: CandidateRepository,
    qualification_configuration: CandidateConfiguration,
    windows_artifact: CandidateArtifact,
    qualification_utility: CandidateArtifact,
}

#[derive(Deserialize)]
struct CandidateRepository {
    commit: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateConfiguration {
    fingerprint_sha256: String,
}

#[derive(Deserialize)]
struct CandidateArtifact {
    sha256: String,
}

struct EmbeddedBinding {
    profile: &'static str,
    writes_enabled: bool,
    configuration_fingerprint_sha256: &'static str,
    source_revision: &'static str,
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn load_binding(path: &Path) -> Result<QualificationBinding, String> {
    let evidence = load_candidate_evidence(path)?;
    let embedded = embedded_binding();
    if !evidence.matches(&embedded) {
        return Err("candidate evidence does not match this qualification build".into());
    }
    Ok(QualificationBinding {
        candidate_msi_sha256: evidence.windows_artifact.sha256,
        qualification_utility_sha256: evidence.qualification_utility.sha256,
        configuration_fingerprint_sha256: evidence.qualification_configuration.fingerprint_sha256,
        source_revision: evidence.repository.commit,
    })
}

fn load_candidate_evidence(path: &Path) -> Result<CandidateEvidence, String> {
    serde_json::from_slice(&read_bounded_regular(
        path,
        "candidate evidence",
        MAX_JSON_BYTES,
    )?)
    .map_err(|_| "candidate evidence is invalid JSON".to_owned())
}

fn embedded_binding() -> EmbeddedBinding {
    EmbeddedBinding {
        profile: option_env!("APPPORT_QUALIFICATION_PROFILE").unwrap_or("invalid"),
        writes_enabled: option_env!("APPPORT_RELUTION_WRITES_ENABLED") == Some("true"),
        configuration_fingerprint_sha256: option_env!("APPPORT_CONFIGURATION_FINGERPRINT_SHA256")
            .unwrap_or("invalid"),
        source_revision: option_env!("APPPORT_SOURCE_REVISION").unwrap_or("invalid"),
    }
}

impl CandidateEvidence {
    fn matches(&self, embedded: &EmbeddedBinding) -> bool {
        [
            self.schema_version == 5,
            self.candidate_ready,
            self.profile == embedded.profile,
            self.writes_enabled == embedded.writes_enabled,
            is_sha256(&self.windows_artifact.sha256),
            is_sha256(&self.qualification_configuration.fingerprint_sha256),
            self.qualification_configuration.fingerprint_sha256
                == embedded.configuration_fingerprint_sha256,
            self.repository.commit == embedded.source_revision,
            is_sha256(&self.qualification_utility.sha256),
        ]
        .into_iter()
        .all(|condition| condition)
    }
}

fn credentials() -> Result<QualificationCredentials, String> {
    let user_a_username = prompt("Unassigned ordinary user A username")?;
    let user_b_username = prompt("Assigned ordinary user B username")?;
    let expected_device_uuid = prompt("Expected disposable user B device UUID")?;
    let user_a_token = token("Ordinary user A Relution access token")?;
    let user_b_token = token("Ordinary user B Relution access token")?;
    Ok(QualificationCredentials {
        user_a_username,
        user_a_token,
        user_b_username,
        user_b_token,
        expected_device_uuid,
    })
}

fn required_confirmation() -> &'static str {
    match option_env!("APPPORT_QUALIFICATION_PROFILE") {
        Some("write_qualification") => "QUALIFY_DISPOSABLE_INSTALL_AND_UPDATE",
        _ => "QUALIFY_READ_ONLY",
    }
}

fn setup_failure(reason: &str) -> QualificationReport {
    QualificationReport {
        schema_version: 1,
        profile: option_env!("APPPORT_QUALIFICATION_PROFILE").unwrap_or("invalid"),
        qualified: false,
        started_at_unix: 0,
        completed_at_unix: 0,
        token_redacted: true,
        writes_enabled: false,
        plan_fingerprint_sha256: None,
        candidate_msi_sha256: None,
        qualification_utility_sha256: None,
        configuration_fingerprint_sha256: None,
        source_revision: None,
        checks: vec![QualificationCheck {
            name: "qualification_setup".into(),
            status: CheckStatus::Failed,
            detail: reason.into(),
        }],
    }
}

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build();
    let result: Result<QualificationReport, String> = (|| {
        let runtime = runtime.map_err(|_| "runtime unavailable".to_owned())?;
        let paths = input_paths()?;
        let binding = load_binding(&paths.candidate_evidence)?;
        let plan = load_plan(paths.plan)?;
        let credentials = credentials()?;
        let required = required_confirmation();
        if prompt(&format!("Type {required} to continue"))? != required {
            return Err("typed operator confirmation did not match".to_owned());
        }
        Ok(runtime.block_on(run(credentials, plan, binding)))
    })();
    let report = result.unwrap_or_else(|reason| setup_failure(&reason));
    println!(
        "{}",
        serde_json::to_string(&report).unwrap_or_else(|_| {
            "{\"schemaVersion\":1,\"qualified\":false,\"tokenRedacted\":true}".into()
        })
    );
    if !report.qualified {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_directory() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "appport-qualification-input-{}-{suffix}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        directory
    }

    fn parse(arguments: Vec<std::ffi::OsString>) -> Result<InputPaths, String> {
        parse_input_paths(arguments)
    }

    fn matching_candidate_evidence() -> (CandidateEvidence, EmbeddedBinding) {
        let source_revision = "701aa9a";
        let configuration_fingerprint =
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        (
            CandidateEvidence {
                schema_version: 5,
                candidate_ready: true,
                profile: "read_only".into(),
                writes_enabled: false,
                repository: CandidateRepository {
                    commit: source_revision.into(),
                },
                qualification_configuration: CandidateConfiguration {
                    fingerprint_sha256: configuration_fingerprint.into(),
                },
                windows_artifact: CandidateArtifact {
                    sha256: "b".repeat(64),
                },
                qualification_utility: CandidateArtifact {
                    sha256: "d".repeat(64),
                },
            },
            EmbeddedBinding {
                profile: "read_only",
                writes_enabled: false,
                configuration_fingerprint_sha256: configuration_fingerprint,
                source_revision,
            },
        )
    }

    #[test]
    fn setup_failures_are_redacted_and_fail_closed() {
        let report = setup_failure("invalid plan");
        let json = serde_json::to_string(&report).unwrap();
        assert!(!report.qualified);
        assert!(report.token_redacted);
        assert!(!json.contains("access_token"));
    }

    #[test]
    fn candidate_evidence_matches_embedded_build_without_path_self_attestation() {
        let (evidence, embedded) = matching_candidate_evidence();
        assert!(evidence.matches(&embedded));
    }

    #[test]
    fn candidate_evidence_rejects_malformed_or_mismatched_binding_fields() {
        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.qualification_utility.sha256 = "not-a-digest".into();
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.candidate_ready = false;
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.profile = "write_qualification".into();
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.writes_enabled = true;
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.qualification_configuration.fingerprint_sha256 = "e".repeat(64);
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.repository.commit = "other".into();
        assert!(!evidence.matches(&embedded));
    }

    #[test]
    fn input_grammar_requires_only_absolute_unique_paths() {
        let absolute = std::env::temp_dir().join("candidate-evidence.json");
        let valid = parse(vec![
            "--candidate-evidence".into(),
            absolute.clone().into_os_string(),
            "--plan".into(),
            absolute.clone().into_os_string(),
        ])
        .unwrap();
        assert_eq!(valid.candidate_evidence, absolute);
        assert_eq!(valid.plan, Some(absolute));

        for arguments in [
            vec!["--candidate-evidence".into()],
            vec!["--unknown".into(), "/candidate.json".into()],
            vec!["--candidate-evidence".into(), "candidate.json".into()],
            vec![
                "--candidate-evidence".into(),
                "/candidate.json".into(),
                "--candidate-evidence".into(),
                "/second.json".into(),
            ],
        ] {
            assert!(parse(arguments).is_err());
        }
    }

    #[test]
    fn bounded_reader_accepts_a_valid_regular_file() {
        let directory = test_directory();
        let input = directory.join("candidate.json");
        fs::write(&input, br#"{"schemaVersion":5}"#).unwrap();

        assert_eq!(
            read_bounded_regular(&input, "candidate evidence", MAX_JSON_BYTES).unwrap(),
            br#"{"schemaVersion":5}"#
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bounded_reader_rejects_oversized_and_non_regular_inputs() {
        let directory = test_directory();
        let oversized = directory.join("oversized.json");
        fs::write(&oversized, vec![b'x'; MAX_JSON_BYTES + 1]).unwrap();

        assert!(read_bounded_regular(&oversized, "candidate evidence", MAX_JSON_BYTES).is_err());
        assert!(read_bounded_regular(&directory, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn bounded_reader_rejects_a_final_symlink() {
        use std::os::unix::fs::symlink;

        let directory = test_directory();
        let target = directory.join("target.json");
        let link = directory.join("candidate.json");
        fs::write(&target, b"trusted").unwrap();
        symlink(&target, &link).unwrap();

        assert!(read_bounded_regular(&link, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn bounded_reader_rejects_a_final_reparse_point() {
        use std::os::windows::fs::symlink_file;
        use windows::Win32::Foundation::ERROR_PRIVILEGE_NOT_HELD;

        let directory = test_directory();
        let target = directory.join("target.json");
        let link = directory.join("candidate.json");
        fs::write(&target, b"trusted").unwrap();
        match symlink_file(&target, &link) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD.0 as i32) => {
                fs::remove_dir_all(directory).unwrap();
                return;
            }
            Err(error) => panic!("failed to create test symlink: {error}"),
        }

        assert!(read_bounded_regular(&link, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn opened_handle_cannot_be_redirected_by_a_path_replacement() {
        let directory = test_directory();
        let input = directory.join("candidate.json");
        let replacement = directory.join("replacement.json");
        fs::write(&input, b"original").unwrap();
        fs::write(&replacement, b"replacement").unwrap();

        let file = open_regular_input(&input, "candidate evidence", MAX_JSON_BYTES).unwrap();
        fs::rename(&replacement, &input).unwrap();
        assert_eq!(
            read_open_bounded_regular(file, "candidate evidence", MAX_JSON_BYTES).unwrap(),
            b"original"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
