//! Side-effect-free action models, transition legality, and reconciliation policy.

use crate::domain::catalog::{AppInstallState, AvailableApp, InstalledApp};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Reserved,
    Queued,
    Sent,
    Deferred,
    Verifying,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

/// User-visible action state. Durable `Reserved` is intentionally exposed as queued.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionState {
    Queued,
    Sent,
    Deferred,
    Verifying,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

impl From<State> for ActionState {
    fn from(value: State) -> Self {
        match value {
            State::Reserved | State::Queued => Self::Queued,
            State::Sent => Self::Sent,
            State::Deferred => Self::Deferred,
            State::Verifying => Self::Verifying,
            State::Succeeded => Self::Succeeded,
            State::Failed => Self::Failed,
            State::Cancelled => Self::Cancelled,
            State::Unknown => Self::Unknown,
        }
    }
}
impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Queued => "queued",
            Self::Sent => "sent",
            Self::Deferred => "deferred",
            Self::Verifying => "verifying",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }
    pub fn decode(value: &str) -> Result<Self, String> {
        match value {
            "reserved" => Ok(Self::Reserved),
            "queued" => Ok(Self::Queued),
            "sent" => Ok(Self::Sent),
            "deferred" => Ok(Self::Deferred),
            "verifying" => Ok(Self::Verifying),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "unknown" => Ok(Self::Unknown),
            _ => Err("unknown: action journal contains an invalid state".into()),
        }
    }
    pub fn terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Unknown
        )
    }
    pub fn catalog_active(self) -> bool {
        !matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Intent {
    Install,
    Update,
}
impl Intent {
    pub fn as_str(self) -> &'static str {
        if self == Self::Install {
            "install"
        } else {
            "update"
        }
    }
    pub fn decode(value: &str) -> Self {
        if value == "update" {
            Self::Update
        } else {
            Self::Install
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub id: String,
    pub device_id: String,
    pub app_id: String,
    pub version_id: String,
    pub package_id: Option<String>,
    pub intent: Intent,
    pub baseline: String,
    pub correlation: Option<String>,
    pub state: State,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveAction {
    pub id: String,
    pub app_id: String,
    pub state: State,
}
pub struct Reservation<'a> {
    pub id: &'a str,
    pub tenant: &'a str,
    pub device: &'a str,
    pub app: &'a str,
    pub version: &'a str,
    pub package: Option<&'a str>,
    pub intent: Intent,
    pub baseline: &'a str,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAction {
    pub id: String,
    pub device_id: String,
    pub app_id: String,
    pub intent: Intent,
    pub state: ActionState,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteAction {
    pub id: String,
    pub state: String,
    pub created_at: i64,
    pub details: Option<RemoteActionDetails>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteActionDetails {
    pub app_id: Option<String>,
    pub version_id: Option<String>,
    pub package_id: Option<String>,
}
pub enum Transition<'a> {
    SubmissionAccepted,
    SubmissionRejected,
    SubmissionUncertain,
    RemoteObserved {
        state: State,
        correlation: &'a str,
        error_code: Option<&'a str>,
    },
    VerificationTimedOut,
    InventoryConfirmed,
    RemoteMissing {
        correlation_known: bool,
    },
}
impl Transition<'_> {
    pub fn target(&self) -> State {
        match self {
            Self::SubmissionAccepted => State::Queued,
            Self::SubmissionRejected => State::Failed,
            Self::SubmissionUncertain | Self::VerificationTimedOut | Self::RemoteMissing { .. } => {
                State::Unknown
            }
            Self::RemoteObserved { state, .. } => *state,
            Self::InventoryConfirmed => State::Succeeded,
        }
    }
    pub fn detail(&self) -> (Option<&str>, Option<&str>, Option<&str>) {
        match self {
            Self::SubmissionRejected => (
                None,
                Some("SUBMISSION_REJECTED"),
                Some("Relution rejected the application request."),
            ),
            Self::SubmissionUncertain => (
                None,
                Some("SUBMISSION_UNCERTAIN"),
                Some("The submission status could not be confirmed. Do not retry."),
            ),
            Self::RemoteObserved {
                correlation,
                error_code,
                ..
            } => (Some(*correlation), *error_code, None),
            Self::VerificationTimedOut => (
                None,
                Some("INVENTORY_VERIFICATION_TIMEOUT"),
                Some("The installed version could not be confirmed. Do not retry."),
            ),
            Self::RemoteMissing { correlation_known } => (
                None,
                Some(if *correlation_known {
                    "RELUTION_ACTION_NOT_FOUND"
                } else {
                    "AMBIGUOUS_RELUTION_ACTION"
                }),
                Some("The submission status could not be confirmed. Do not retry."),
            ),
            Self::SubmissionAccepted | Self::InventoryConfirmed => (None, None, None),
        }
    }
    pub fn allowed_from(&self, state: State) -> bool {
        match self {
            Self::SubmissionAccepted | Self::SubmissionRejected | Self::SubmissionUncertain => {
                state == State::Reserved
            }
            Self::InventoryConfirmed | Self::VerificationTimedOut => state == State::Verifying,
            Self::RemoteObserved { state: target, .. } => {
                matches!(
                    state,
                    State::Queued | State::Sent | State::Deferred | State::Verifying
                ) && matches!(
                    target,
                    State::Queued
                        | State::Sent
                        | State::Deferred
                        | State::Verifying
                        | State::Failed
                        | State::Cancelled
                        | State::Unknown
                )
            }
            Self::RemoteMissing { .. } => matches!(
                state,
                State::Queued | State::Sent | State::Deferred | State::Verifying
            ),
        }
    }
}
pub fn to_action(action: Action) -> AppAction {
    AppAction {
        id: action.id,
        device_id: action.device_id,
        app_id: action.app_id,
        intent: action.intent,
        state: action.state.into(),
        error_code: action.error_code,
        error_message: action.error_message,
        created_at: action.created_at.to_string(),
        updated_at: action.updated_at.to_string(),
    }
}
pub fn attach_active_actions(apps: &mut [AvailableApp], actions: Vec<ActiveAction>) {
    let active: HashMap<_, _> = actions
        .into_iter()
        .map(|action| (action.app_id, (action.id, action.state)))
        .collect();
    for app in apps {
        if let Some((id, state)) = active.get(&app.id) {
            app.active_action_id = Some(id.clone());
            app.active_action_state = Some((*state).into());
        }
    }
}
pub fn request_intent(app: &AvailableApp) -> Result<Intent, String> {
    if app.installed_version_id.as_deref() == Some(&app.released_version_id)
        || app.installed_version_id.is_some()
            && app.install_state != AppInstallState::UpdateAvailable
    {
        return Err("server: application is already current or update is not approved".into());
    }
    Ok(if app.installed_version_id.is_some() {
        Intent::Update
    } else {
        Intent::Install
    })
}
pub fn remote_state(value: &str) -> State {
    match value {
        "NEW" | "PENDING" | "PUSH_SENT" => State::Queued,
        "DELIVERED_CANCELABLE" | "DELIVERED" | "DELIVERY_CONFIRMED" => State::Sent,
        "NOT_NOW" => State::Deferred,
        "EXECUTED" => State::Verifying,
        "ERROR" => State::Failed,
        "CANCELLED" => State::Cancelled,
        _ => State::Unknown,
    }
}
pub fn action_details_match(
    details: Option<&RemoteActionDetails>,
    app_id: &str,
    version_id: &str,
    package_id: Option<&str>,
) -> bool {
    let Some(details) = details else { return false };
    let mut matched = false;
    for (candidate, expected) in [
        (details.app_id.as_deref(), Some(app_id)),
        (details.version_id.as_deref(), Some(version_id)),
    ] {
        if let (Some(candidate), Some(expected)) = (candidate, expected) {
            if !same_uuid(candidate, expected) {
                return false;
            };
            matched = true;
        }
    }
    if let (Some(candidate), Some(expected)) = (details.package_id.as_deref(), package_id) {
        if candidate != expected {
            return false;
        };
        matched = true;
    }
    matched
}
pub fn inventory_matches(
    inventory: &InstalledApp,
    app_id: &str,
    version_id: &str,
    package_id: Option<&str>,
) -> bool {
    inventory
        .app_id
        .as_deref()
        .is_some_and(|app| same_uuid(app, app_id))
        && inventory
            .version_id
            .as_deref()
            .is_some_and(|version| same_uuid(version, version_id))
        && (package_id.is_none() || inventory.identifier.as_deref() == package_id)
}
pub fn correlation_candidates(
    actions: Vec<RemoteAction>,
    baseline: &HashSet<&str>,
    action: &Action,
) -> Vec<RemoteAction> {
    actions
        .into_iter()
        .filter(|candidate| {
            !baseline.contains(candidate.id.as_str())
                && candidate.created_at >= action.created_at - 5
                && action_details_match(
                    candidate.details.as_ref(),
                    &action.app_id,
                    &action.version_id,
                    action.package_id.as_deref(),
                )
        })
        .collect()
}
pub fn remote_action_blocks_request(state: State) -> bool {
    matches!(
        state,
        State::Queued | State::Sent | State::Deferred | State::Verifying | State::Unknown
    )
}
pub fn select_correlation(action: &Action, candidates: Vec<RemoteAction>) -> Option<RemoteAction> {
    match action.correlation.as_deref() {
        Some(correlation) => candidates
            .into_iter()
            .find(|candidate| candidate.id == correlation),
        None if candidates.len() == 1 => candidates.into_iter().next(),
        None => None,
    }
}
pub fn baseline(action: &Action) -> HashSet<&str> {
    action
        .baseline
        .split(',')
        .filter(|value| !value.is_empty())
        .collect()
}
fn same_uuid(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}
