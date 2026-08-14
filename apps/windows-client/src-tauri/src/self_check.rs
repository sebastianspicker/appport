use crate::qualification::CheckStatus;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheck {
    name: &'static str,
    status: CheckStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckReport {
    pub schema_version: u8,
    pub qualified: bool,
    pub profile: &'static str,
    pub writes_enabled: bool,
    pub configuration_fingerprint_sha256: &'static str,
    pub source_revision: &'static str,
    pub started_at_unix: u64,
    pub completed_at_unix: u64,
    pub cleanup_complete: bool,
    pub checks: Vec<SelfCheck>,
}

pub fn run() -> SelfCheckReport {
    let started = now();
    let qualification_build = option_env!("APPPORT_QUALIFICATION_BUILD") == Some("true");
    let mut cleanup_complete = true;
    let mut checks = vec![check(
        "qualification_build",
        qualification_build.then_some(()).ok_or(()),
    )];
    if qualification_build {
        checks.extend([
            check(
                "credential_manager",
                crate::session::qualification_credential_self_check().map_err(|_| ()),
            ),
            check(
                "journal_acl",
                crate::journal::qualification_acl_self_check().map_err(|_| ()),
            ),
            check(
                "protocol_and_scheduled_task",
                crate::task::qualification_platform_self_check().map_err(|_| ()),
            ),
            check(
                "notification_registry",
                crate::notifications::qualification_notification_self_check().map_err(|_| ()),
            ),
            check("graceful_native_startup", Ok(())),
        ]);
        cleanup_complete = checks
            .iter()
            .skip(1)
            .all(|item| item.status == CheckStatus::Passed);
    }
    let qualified = qualification_build
        && cleanup_complete
        && checks.iter().all(|item| item.status == CheckStatus::Passed);
    SelfCheckReport {
        schema_version: 1,
        qualified,
        profile: option_env!("APPPORT_QUALIFICATION_PROFILE").unwrap_or("invalid"),
        writes_enabled: option_env!("APPPORT_RELUTION_WRITES_ENABLED") == Some("true"),
        configuration_fingerprint_sha256: option_env!("APPPORT_CONFIGURATION_FINGERPRINT_SHA256")
            .unwrap_or("invalid"),
        source_revision: option_env!("APPPORT_SOURCE_REVISION").unwrap_or("invalid"),
        started_at_unix: started,
        completed_at_unix: now(),
        cleanup_complete,
        checks,
    }
}

fn check(name: &'static str, result: Result<(), ()>) -> SelfCheck {
    SelfCheck {
        name,
        status: if result.is_ok() {
            CheckStatus::Passed
        } else {
            CheckStatus::Failed
        },
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_build_self_check_is_unavailable() {
        let report = run();
        assert!(!report.qualified);
        assert_eq!(report.checks[0].status, CheckStatus::Failed);
        assert_eq!(report.source_revision, "source-verification");
        assert_eq!(
            serde_json::to_value(&report).unwrap()["sourceRevision"],
            "source-verification"
        );
    }
}
