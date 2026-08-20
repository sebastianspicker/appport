use super::{CheckStatus, QualificationBinding, QualificationCheck};
use crate::build_config::QualificationProfile;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualificationReport {
    pub schema_version: u8,
    pub profile: &'static str,
    pub qualified: bool,
    pub started_at_unix: u64,
    pub completed_at_unix: u64,
    pub token_redacted: bool,
    pub writes_enabled: bool,
    pub diagnostics_enabled: bool,
    pub password_auth_enabled: bool,
    pub password_auth_contract: &'static str,
    pub plan_fingerprint_sha256: Option<String>,
    pub candidate_msi_sha256: Option<String>,
    pub qualification_utility_sha256: Option<String>,
    pub configuration_fingerprint_sha256: Option<String>,
    pub source_revision: Option<String>,
    pub checks: Vec<QualificationCheck>,
}

pub(super) fn finish_report(
    profile: QualificationProfile,
    started: u64,
    writes_enabled: bool,
    plan_fingerprint_sha256: Option<String>,
    binding: Option<QualificationBinding>,
    checks: Vec<QualificationCheck>,
) -> QualificationReport {
    let qualified = checks
        .iter()
        .all(|check| check.status != CheckStatus::Failed)
        && checks
            .iter()
            .any(|check| check.status == CheckStatus::Passed);
    QualificationReport {
        schema_version: 1,
        profile: profile.as_str(),
        qualified,
        started_at_unix: started,
        completed_at_unix: now(),
        token_redacted: true,
        writes_enabled,
        diagnostics_enabled: option_env!("APPPORT_RELUTION_DIAGNOSTICS") == Some("true"),
        password_auth_enabled: option_env!("APPPORT_RELUTION_PASSWORD_AUTH_ENABLED")
            == Some("true"),
        password_auth_contract: option_env!("APPPORT_RELUTION_PASSWORD_AUTH_CONTRACT")
            .unwrap_or("invalid"),
        plan_fingerprint_sha256,
        candidate_msi_sha256: binding
            .as_ref()
            .map(|value| value.candidate_msi_sha256.clone()),
        qualification_utility_sha256: binding
            .as_ref()
            .map(|value| value.qualification_utility_sha256.clone()),
        configuration_fingerprint_sha256: binding
            .as_ref()
            .map(|value| value.configuration_fingerprint_sha256.clone()),
        source_revision: binding.map(|value| value.source_revision),
        checks,
    }
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build_config::QualificationProfile;

    fn check(name: &str, status: CheckStatus) -> QualificationCheck {
        QualificationCheck {
            name: name.into(),
            status,
            detail: "test".into(),
        }
    }

    #[test]
    fn aggregation_ignores_not_run_but_fails_on_failed_checks() {
        let passed_report = finish_report(
            QualificationProfile::ReadOnly,
            1,
            false,
            None,
            None,
            vec![
                check("read", CheckStatus::Passed),
                check("write", CheckStatus::NotRun),
            ],
        );
        assert!(passed_report.qualified);
        let diagnostics_enabled = option_env!("APPPORT_RELUTION_DIAGNOSTICS") == Some("true");
        assert_eq!(passed_report.diagnostics_enabled, diagnostics_enabled);
        assert_eq!(
            serde_json::to_value(&passed_report).unwrap()["diagnosticsEnabled"],
            diagnostics_enabled
        );
        assert_eq!(
            serde_json::to_value(&passed_report).unwrap()["passwordAuthEnabled"],
            false
        );
        assert_eq!(
            serde_json::to_value(&passed_report).unwrap()["passwordAuthContract"],
            "none"
        );
        let failed_report = finish_report(
            QualificationProfile::ReadOnly,
            1,
            false,
            None,
            None,
            vec![
                check("read", CheckStatus::Passed),
                check("isolation", CheckStatus::Failed),
            ],
        );
        assert!(!failed_report.qualified);
    }
}
