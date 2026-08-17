//! Durable, fail-closed local action ledger. A reservation is the action.
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
const RETENTION_DAYS: i64 = 90;
const SCHEMA: &str = "PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS actions (
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, device_id TEXT NOT NULL, app_id TEXT NOT NULL,
 version_id TEXT NOT NULL, package_id TEXT, intent TEXT NOT NULL, baseline TEXT NOT NULL,
 correlation TEXT, state TEXT NOT NULL CHECK(state IN ('reserved','queued','sent','deferred','verifying','succeeded','failed','cancelled','unknown')),
 error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS active_action_per_app ON actions(device_id,app_id)
 WHERE state IN ('reserved','queued','sent','deferred','verifying','unknown');";
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum State {
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
impl State {
    pub(crate) fn as_str(self) -> &'static str {
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

    fn decode(value: &str) -> Result<Self, String> {
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

    pub(crate) fn terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Unknown
        )
    }

    fn catalog_active(self) -> bool {
        matches!(
            self,
            Self::Reserved
                | Self::Queued
                | Self::Sent
                | Self::Deferred
                | Self::Verifying
                | Self::Unknown
        )
    }
}
pub(crate) enum Transition<'a> {
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
    fn target(&self) -> State {
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

    fn detail(&self) -> (Option<&str>, Option<&str>, Option<&str>) {
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

    fn allowed_from(&self, state: State) -> bool {
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
            Self::RemoteMissing { .. } => {
                matches!(
                    state,
                    State::Queued | State::Sent | State::Deferred | State::Verifying
                )
            }
        }
    }
}
pub struct Action {
    pub id: String,
    pub device_id: String,
    pub app_id: String,
    pub version_id: String,
    pub package_id: Option<String>,
    pub intent: String,
    pub baseline: String,
    pub correlation: Option<String>,
    pub state: State,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub(crate) struct ActiveAction {
    pub id: String,
    pub app_id: String,
    pub state: State,
}
pub(crate) struct Reservation<'a> {
    pub id: &'a str,
    pub tenant: &'a str,
    pub device: &'a str,
    pub app: &'a str,
    pub version: &'a str,
    pub package: Option<&'a str>,
    pub intent: &'a str,
    pub baseline: &'a str,
}
fn path() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("unknown: LOCALAPPDATA is unavailable")?;
    let directory = PathBuf::from(base).join("Relution").join("Appport");
    fs::create_dir_all(&directory)
        .map_err(|_| "unknown: action journal directory is unavailable")?;
    secure_current_user(&directory)?;
    Ok(directory.join("actions.sqlite3"))
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn open() -> Result<Connection, String> {
    let journal_path = path()?;
    let connection =
        Connection::open(&journal_path).map_err(|_| "unknown: action journal is unavailable")?;
    initialize(&connection)?;
    secure_current_user(&journal_path)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", journal_path.display()));
        if sidecar.exists() {
            secure_current_user(&sidecar)?;
        }
    }
    Ok(connection)
}
fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(SCHEMA)
        .map_err(|_| "unknown: action journal is unavailable".into())
}
/// Startup-only recovery. Normal reads and writes never mutate reservations.
pub(crate) fn recover_interrupted_reservations() -> Result<(), String> {
    let connection = open()?;
    connection
        .execute(
            "UPDATE actions SET state='unknown', error_code='SUBMISSION_INTERRUPTED', error_message='The submission status could not be confirmed. Do not retry.', updated_at=?1 WHERE state='reserved'",
            params![now()],
        )
        .map_err(|_| "unknown: action journal could not recover interrupted actions")?;
    best_effort_prune(&connection, now());
    Ok(())
}
pub fn reserve(reservation: Reservation<'_>) -> Result<(), String> {
    let connection = open()?;
    let timestamp = now();
    let inserted = connection.execute(
        "INSERT INTO actions(id,tenant,device_id,app_id,version_id,package_id,intent,baseline,state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'reserved',?9,?9)",
        params![reservation.id,reservation.tenant,reservation.device,reservation.app,reservation.version,reservation.package,reservation.intent,reservation.baseline,timestamp],
    ).map_err(|_| "server: an active application action already exists")?;
    if inserted != 1 {
        return Err("unknown: action journal reservation did not persist".into());
    }
    best_effort_prune(&connection, timestamp);
    Ok(())
}

/// Compare-and-set transition. It changes exactly one existing action or fails.
pub(crate) fn transition(id: &str, expected: State, event: Transition<'_>) -> Result<(), String> {
    let connection = open()?;
    transition_in(&connection, id, expected, event, now())?;
    best_effort_prune(&connection, now());
    Ok(())
}

fn transition_in(
    connection: &Connection,
    id: &str,
    expected: State,
    event: Transition<'_>,
    timestamp: i64,
) -> Result<(), String> {
    if !event.allowed_from(expected) {
        return Err("server: illegal application action transition".into());
    }
    let target = event.target();
    let (correlation, code, message) = event.detail();
    let changed = connection
        .execute(
            "UPDATE actions SET state=?2, correlation=COALESCE(?3,correlation), error_code=?4, error_message=?5, updated_at=?6 WHERE id=?1 AND state=?7 AND (?3 IS NULL OR correlation IS NULL OR correlation=?3)",
            params![id, target.as_str(), correlation, code, message, timestamp, expected.as_str()],
        )
        .map_err(|_| "unknown: action journal could not be updated")?;
    if changed == 1 {
        return Ok(());
    }
    let exists = connection
        .query_row("SELECT 1 FROM actions WHERE id=?1", params![id], |_| Ok(()))
        .optional()
        .map_err(|_| "unknown: action journal is unavailable")?
        .is_some();
    Err(if exists {
        "server: stale application action transition".into()
    } else {
        "server: application action was not found".into()
    })
}

pub fn action(id: &str) -> Result<Option<Action>, String> {
    let connection = open()?;
    connection
        .query_row(
            "SELECT id,device_id,app_id,version_id,package_id,intent,baseline,correlation,state,error_code,error_message,created_at,updated_at FROM actions WHERE id=?1",
            params![id],
            action_from_row,
        )
        .optional()
        .map_err(|_| "unknown: action journal is unavailable".into())
}

/// Read-only catalog visibility lookup; it includes Unknown because it remains active.
pub(crate) fn active_actions(device_id: &str) -> Result<Vec<ActiveAction>, String> {
    active_actions_in(&open()?, device_id)
}

fn active_actions_in(
    connection: &Connection,
    device_id: &str,
) -> Result<Vec<ActiveAction>, String> {
    let rows = connection
        .prepare("SELECT id,app_id,state FROM actions WHERE device_id=?1 ORDER BY created_at,id")
        .and_then(|mut statement| {
            statement
                .query_map(params![device_id], active_action_from_row)
                .map(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        });
    rows.and_then(|actions| {
        actions.map(|actions| {
            actions
                .into_iter()
                .filter(|action| action.state.catalog_active())
                .collect()
        })
    })
    .map_err(|_| "unknown: action journal is unavailable".into())
}

fn active_action_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActiveAction> {
    Ok(ActiveAction {
        id: row.get(0)?,
        app_id: row.get(1)?,
        state: State::decode(&row.get::<_, String>(2)?)
            .map_err(|_| rusqlite::Error::InvalidColumnName("state".into()))?,
    })
}

fn action_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Action> {
    let state = State::decode(&row.get::<_, String>(8)?)
        .map_err(|_| rusqlite::Error::InvalidColumnName("state".into()))?;
    Ok(Action {
        id: row.get(0)?,
        device_id: row.get(1)?,
        app_id: row.get(2)?,
        version_id: row.get(3)?,
        package_id: row.get(4)?,
        intent: row.get(5)?,
        baseline: row.get(6)?,
        correlation: row.get(7)?,
        state,
        error_code: row.get(9)?,
        error_message: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn prune(connection: &Connection, timestamp: i64) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM actions WHERE state IN ('succeeded','failed','cancelled') AND updated_at < ?1",
            params![timestamp - RETENTION_DAYS * 86400],
        )
        .map_err(|_| "unknown: action journal could not be pruned")?;
    Ok(())
}

// Retention failure must not obscure a successfully persisted action outcome.
fn best_effort_prune(connection: &Connection, timestamp: i64) {
    let _ = prune(connection, timestamp);
}

#[cfg(windows)]
fn current_user_sid() -> Result<String, String> {
    let output = crate::system_tools::command("whoami.exe")
        .map_err(|_| "unknown: current-user security identity is unavailable")?
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|_| "unknown: current-user security identity is unavailable")?;
    if !output.status.success() {
        return Err("unknown: current-user security identity is unavailable".into());
    }
    String::from_utf8_lossy(&output.stdout)
        .split(',')
        .nth(1)
        .map(|value| value.trim().trim_matches('"').to_owned())
        .filter(|value| value.starts_with("S-1-"))
        .ok_or_else(|| "unknown: current-user security identity is unavailable".into())
}

#[cfg(windows)]
pub(crate) fn secure_current_user(path: &std::path::Path) -> Result<(), String> {
    let sid = current_user_sid()?;
    let grant = if path.is_dir() {
        format!("*{sid}:(OI)(CI)F")
    } else {
        format!("*{sid}:F")
    };
    let status = crate::system_tools::command("icacls.exe")
        .map_err(|_| "unknown: action journal ACL could not be applied")?
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(grant)
        .args(["/remove:g", "*S-1-1-0", "*S-1-5-11", "*S-1-5-32-545", "/q"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| "unknown: action journal ACL could not be applied")?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "unknown: action journal ACL could not be applied".into())
}

#[cfg(not(windows))]
fn secure_current_user(_: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn qualification_acl_self_check() -> Result<(), String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("unknown: LOCALAPPDATA is unavailable")?;
    let directory = PathBuf::from(base)
        .join("Relution")
        .join("Appport")
        .join(format!("qualification-acl-{}", std::process::id()));
    fs::create_dir_all(&directory)
        .map_err(|_| "unknown: qualification ACL directory unavailable")?;
    let result = secure_current_user(&directory).and_then(|_| {
        let probe = directory.join("probe");
        fs::write(&probe, b"appport qualification")
            .map_err(|_| "unknown: qualification ACL write failed")?;
        secure_current_user(&probe)?;
        (fs::read(&probe).ok().as_deref() == Some(b"appport qualification"))
            .then_some(())
            .ok_or_else(|| "unknown: qualification ACL read failed".into())
    });
    result.and(
        fs::remove_dir_all(&directory)
            .map_err(|_| "unknown: qualification ACL cleanup failed".to_owned()),
    )
}

#[cfg(not(windows))]
pub fn qualification_acl_self_check() -> Result<(), String> {
    Err("unknown: Windows ACLs are unavailable".into())
}

#[cfg(test)]
#[path = "journal_tests.rs"]
mod tests;
