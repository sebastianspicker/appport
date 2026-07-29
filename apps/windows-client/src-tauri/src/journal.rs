//! Durable, fail-closed local action ledger. A reservation is the action.
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

const RETENTION_DAYS: i64 = 90;
fn path() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("unknown: LOCALAPPDATA is unavailable")?;
    let d = PathBuf::from(base).join("Relution").join("Appport");
    fs::create_dir_all(&d).map_err(|_| "unknown: action journal directory is unavailable")?;
    secure_current_user(&d)?;
    Ok(d.join("actions.sqlite3"))
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn open() -> Result<Connection, String> {
    let journal_path = path()?;
    let c =
        Connection::open(&journal_path).map_err(|_| "unknown: action journal is unavailable")?;
    c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, device_id TEXT NOT NULL, app_id TEXT NOT NULL, version_id TEXT NOT NULL, package_id TEXT, intent TEXT NOT NULL, baseline TEXT NOT NULL, correlation TEXT, state TEXT NOT NULL, error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS active_action_per_app ON actions(device_id,app_id) WHERE state IN ('reserved','queued','sent','deferred','verifying','unknown'); UPDATE actions SET state='unknown', error_code='SUBMISSION_INTERRUPTED', error_message='The submission status could not be confirmed. Do not retry.', updated_at=strftime('%s','now') WHERE state='reserved';").map_err(|_|"unknown: action journal is unavailable")?;
    secure_current_user(&journal_path)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", journal_path.display()));
        if sidecar.exists() {
            secure_current_user(&sidecar)?;
        }
    }
    Ok(c)
}

#[cfg(windows)]
fn current_user_sid() -> Result<String, String> {
    let output = std::process::Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|_| "unknown: current-user security identity is unavailable")?;
    if !output.status.success() {
        return Err("unknown: current-user security identity is unavailable".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split(',')
        .nth(1)
        .map(|value| value.trim().trim_matches('"').to_owned())
        .filter(|value| value.starts_with("S-1-"))
        .ok_or_else(|| "unknown: current-user security identity is unavailable".into())
}

#[cfg(windows)]
fn secure_current_user(path: &std::path::Path) -> Result<(), String> {
    let sid = current_user_sid()?;
    let grant = if path.is_dir() {
        format!("*{sid}:(OI)(CI)F")
    } else {
        format!("*{sid}:F")
    };
    let status = std::process::Command::new("icacls.exe")
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(grant)
        .args(["/remove:g", "*S-1-1-0", "*S-1-5-11", "*S-1-5-32-545", "/q"])
        .status()
        .map_err(|_| "unknown: action journal ACL could not be applied")?;
    if status.success() {
        Ok(())
    } else {
        Err("unknown: action journal ACL could not be applied".into())
    }
}

#[cfg(not(windows))]
fn secure_current_user(_: &std::path::Path) -> Result<(), String> {
    Ok(())
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
    pub state: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[allow(clippy::too_many_arguments)]
pub fn reserve(
    id: &str,
    tenant: &str,
    device: &str,
    app: &str,
    version: &str,
    package: Option<&str>,
    intent: &str,
    baseline: &str,
) -> Result<(), String> {
    let c = open()?;
    let t = now();
    c.execute("INSERT INTO actions(id,tenant,device_id,app_id,version_id,package_id,intent,baseline,state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'reserved',?9,?9)",params![id,tenant,device,app,version,package,intent,baseline,t]).map_err(|_|"server: an active application action already exists")?;
    prune(&c, t)
}
pub fn update(
    id: &str,
    state: &str,
    correlation: Option<&str>,
    code: Option<&str>,
    message: Option<&str>,
) -> Result<(), String> {
    let c = open()?;
    let t = now();
    c.execute("UPDATE actions SET state=?2, correlation=COALESCE(?3,correlation), error_code=?4,error_message=?5,updated_at=?6 WHERE id=?1",params![id,state,correlation,code,message,t]).map_err(|_|"unknown: action journal could not be updated")?;
    prune(&c, t)
}
pub fn record(id: &str, _app: &str, state: &str) -> Result<(), String> {
    update(id, state, None, None, None)
}
pub fn action(id: &str) -> Result<Option<Action>, String> {
    let c = open()?;
    c.query_row(
        "SELECT id,device_id,app_id,version_id,package_id,intent,baseline,correlation,state,error_code,error_message,created_at,updated_at FROM actions WHERE id=?1",
        params![id],
        action_from_row,
    )
    .optional()
    .map_err(|_| "unknown: action journal is unavailable".into())
}
fn action_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Action> {
    let identity = action_identity(row)?;
    let detail = action_detail(row)?;
    let state = action_state(row)?;
    let times = action_times(row)?;
    Ok(Action {
        id: identity.0,
        device_id: identity.1,
        app_id: identity.2,
        version_id: identity.3,
        package_id: detail.0,
        intent: detail.1,
        baseline: detail.2,
        correlation: detail.3,
        state: state.0,
        error_code: state.1,
        error_message: state.2,
        created_at: times.0,
        updated_at: times.1,
    })
}
fn action_identity(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}
fn action_detail(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(Option<String>, String, String, Option<String>)> {
    Ok((row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
}
fn action_state(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(String, Option<String>, Option<String>)> {
    Ok((row.get(8)?, row.get(9)?, row.get(10)?))
}
fn action_times(row: &rusqlite::Row<'_>) -> rusqlite::Result<(i64, i64)> {
    Ok((row.get(11)?, row.get(12)?))
}
fn prune(c: &Connection, t: i64) -> Result<(), String> {
    c.execute(
        "DELETE FROM actions WHERE state IN ('succeeded','failed','cancelled') AND updated_at < ?1",
        params![t - RETENTION_DAYS * 86400],
    )
    .map_err(|_| "unknown: action journal could not be pruned")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_enforces_active_lock_recovers_reserved_and_keeps_unknown() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE actions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, device_id TEXT NOT NULL, app_id TEXT NOT NULL, version_id TEXT NOT NULL, package_id TEXT, intent TEXT NOT NULL, baseline TEXT NOT NULL, correlation TEXT, state TEXT NOT NULL, error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE UNIQUE INDEX active_action_per_app ON actions(device_id,app_id) WHERE state IN ('reserved','queued','sent','deferred','verifying','unknown');").unwrap();
        c.execute("INSERT INTO actions VALUES ('one','t','d','a','v',NULL,'install','',NULL,'reserved',NULL,NULL,1,1)", []).unwrap();
        assert!(c.execute("INSERT INTO actions VALUES ('two','t','d','a','v',NULL,'install','',NULL,'queued',NULL,NULL,1,1)", []).is_err());
        c.execute(
            "UPDATE actions SET state='unknown' WHERE state='reserved'",
            [],
        )
        .unwrap();
        assert_eq!(
            c.query_row("SELECT state FROM actions WHERE id='one'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "unknown"
        );
        c.execute("INSERT INTO actions VALUES ('old','t','d','b','v',NULL,'install','',NULL,'succeeded',NULL,NULL,1,1)", []).unwrap();
        c.execute("DELETE FROM actions WHERE state IN ('succeeded','failed','cancelled') AND updated_at < 10", []).unwrap();
        assert!(c
            .query_row("SELECT id FROM actions WHERE id='old'", [], |r| r
                .get::<_, String>(0))
            .optional()
            .unwrap()
            .is_none());
        assert!(c
            .query_row("SELECT id FROM actions WHERE id='one'", [], |r| r
                .get::<_, String>(0))
            .optional()
            .unwrap()
            .is_some());
    }

    #[cfg(windows)]
    #[test]
    fn journal_acl_preserves_current_user_access() {
        let directory = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(format!("appport-acl-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        secure_current_user(&directory).unwrap();
        let probe = directory.join("write-probe");
        std::fs::write(&probe, b"current-user-only").unwrap();
        assert_eq!(std::fs::read(&probe).unwrap(), b"current-user-only");
        let verified = std::process::Command::new("icacls.exe")
            .arg(&directory)
            .args(["/verify", "/q"])
            .status()
            .unwrap();
        assert!(verified.success());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
