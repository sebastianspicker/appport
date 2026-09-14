//! Operator-only live qualification. Tokens are read once from a masked console and
//! are never accepted from arguments, environment variables, files, logs, or reports.

use relution_appport_lib::qualification::{
    run, CheckStatus, QualificationCheck, QualificationCredentials, QualificationPlan,
    QualificationReport,
};
use std::{
    io::{self, Write},
    path::PathBuf,
};

#[path = "qualification/binding.rs"]
mod binding;
#[path = "qualification/input.rs"]
mod input;

use binding::load_binding;
use input::{input_paths, read_bounded_regular, MAX_JSON_BYTES};

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

fn load_plan(path: Option<PathBuf>) -> Result<Option<QualificationPlan>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes = read_bounded_regular(&path, "qualification plan", MAX_JSON_BYTES)?;
    QualificationPlan::parse(&bytes).map(Some)
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
        diagnostics_enabled: option_env!("APPPORT_RELUTION_DIAGNOSTICS") == Some("true"),
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
    use super::setup_failure;

    #[test]
    fn setup_failures_are_redacted_and_fail_closed() {
        let report = setup_failure("invalid plan");
        let json = serde_json::to_string(&report).unwrap();
        assert!(!report.qualified);
        assert!(report.token_redacted);
        assert!(!json.contains("access_token"));
    }
}
