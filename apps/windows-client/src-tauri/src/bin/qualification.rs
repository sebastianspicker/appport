//! Operator-only live qualification. Tokens are read once from a masked console and
//! are never accepted from arguments, environment variables, files, logs, or reports.

use relution_appport_lib::qualification::{
    run, CheckStatus, QualificationBinding, QualificationCheck, QualificationCredentials,
    QualificationPlan, QualificationReport,
};
use serde::Deserialize;
use sha2::Digest as _;
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
};

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
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() % 2 != 0 {
        return Err("every option requires a non-secret JSON path".into());
    }
    let mut candidate_evidence = None;
    let mut plan = None;
    for pair in arguments.chunks_exact(2) {
        if pair[0] == "--candidate-evidence" && candidate_evidence.is_none() {
            candidate_evidence = Some(PathBuf::from(&pair[1]));
        } else if pair[0] == "--plan" && plan.is_none() {
            plan = Some(PathBuf::from(&pair[1]));
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

fn read_bounded_regular(path: &PathBuf, label: &str, maximum: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("{label} is unavailable"))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(format!("{label} must be a regular non-symlink file"));
    }
    let bytes = fs::read(path).map_err(|_| format!("{label} is unreadable"))?;
    if bytes.len() > maximum {
        return Err(format!("{label} exceeds its size limit"));
    }
    Ok(bytes)
}

fn load_plan(path: Option<PathBuf>) -> Result<Option<QualificationPlan>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes = read_bounded_regular(&path, "qualification plan", 1024 * 1024)?;
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

fn load_binding(path: &PathBuf) -> Result<QualificationBinding, String> {
    let evidence = load_candidate_evidence(path)?;
    let embedded = embedded_binding();
    let executable_sha256 = qualification_executable_sha256()?;
    if !evidence.matches(&embedded, &executable_sha256) {
        return Err("candidate evidence does not match this qualification build".into());
    }
    Ok(QualificationBinding {
        candidate_msi_sha256: evidence.windows_artifact.sha256,
        qualification_utility_sha256: evidence.qualification_utility.sha256,
        configuration_fingerprint_sha256: evidence.qualification_configuration.fingerprint_sha256,
        source_revision: evidence.repository.commit,
    })
}

fn load_candidate_evidence(path: &PathBuf) -> Result<CandidateEvidence, String> {
    serde_json::from_slice(&read_bounded_regular(
        path,
        "candidate evidence",
        1024 * 1024,
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

fn qualification_executable_sha256() -> Result<String, String> {
    let current_executable = std::env::current_exe()
        .map_err(|_| "qualification executable identity is unavailable".to_owned())?;
    Ok(format!(
        "{:x}",
        sha2::Sha256::digest(read_bounded_regular(
            &current_executable,
            "qualification executable",
            256 * 1024 * 1024,
        )?)
    ))
}

impl CandidateEvidence {
    fn matches(&self, embedded: &EmbeddedBinding, executable_sha256: &str) -> bool {
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
            self.qualification_utility.sha256 == executable_sha256,
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

    #[test]
    fn setup_failures_are_redacted_and_fail_closed() {
        let report = setup_failure("invalid plan");
        let json = serde_json::to_string(&report).unwrap();
        assert!(!report.qualified);
        assert!(report.token_redacted);
        assert!(!json.contains("access_token"));
    }
}
