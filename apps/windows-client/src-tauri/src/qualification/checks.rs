use serde::{Deserialize, Serialize};

pub(super) fn add_not_run_write_checks(checks: &mut Vec<QualificationCheck>) {
    for name in [
        "approved_install",
        "approved_update",
        "remote_attribution",
        "unauthorized_application",
        "substituted_version",
        "cross_user_action",
        "cleanup",
        "uninstall_and_administrative_probes",
    ] {
        checks.push(not_run(name, "outside the read_only profile"));
    }
}

pub(super) fn result_check<T>(
    name: &'static str,
    result: &Result<T, String>,
) -> QualificationCheck {
    if result.is_ok() {
        passed(name, "production native client request completed")
    } else {
        failed(name, "production native client request failed")
    }
}

pub(super) fn passed(name: &'static str, detail: &'static str) -> QualificationCheck {
    QualificationCheck {
        name: name.into(),
        status: CheckStatus::Passed,
        detail: detail.into(),
    }
}

pub(super) fn failed(name: &'static str, detail: &'static str) -> QualificationCheck {
    QualificationCheck {
        name: name.into(),
        status: CheckStatus::Failed,
        detail: detail.into(),
    }
}

pub(super) fn not_run(name: &'static str, detail: &'static str) -> QualificationCheck {
    QualificationCheck {
        name: name.into(),
        status: CheckStatus::NotRun,
        detail: detail.into(),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Passed,
    Failed,
    NotRun,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualificationCheck {
    pub name: String,
    pub status: CheckStatus,
    pub detail: String,
}
