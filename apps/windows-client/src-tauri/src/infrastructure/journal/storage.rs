use crate::domain::action::{Action, ActionRequest, ActiveAction, Reservation, State, Transition};
use rusqlite::{params, Connection, OptionalExtension};
use std::time::Duration;

pub(super) const RETENTION_DAYS: i64 = 90;
const SCHEMA: &str = "PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS actions (
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, device_id TEXT NOT NULL, app_id TEXT NOT NULL,
 version_id TEXT NOT NULL, package_id TEXT, intent TEXT NOT NULL, baseline TEXT NOT NULL,
 correlation TEXT, state TEXT NOT NULL CHECK(state IN ('reserved','queued','sent','deferred','verifying','succeeded','failed','cancelled','unknown')),
 error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS active_action_per_app ON actions(device_id,app_id)
 WHERE state IN ('reserved','queued','sent','deferred','verifying','unknown');";

pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_secs(5))
        .and_then(|()| connection.execute_batch(SCHEMA))
        .map_err(|_| "unknown: action journal is unavailable".into())
}

pub(super) fn recover_in(connection: &Connection, timestamp: i64) -> Result<(), String> {
    connection
        .execute(
            "UPDATE actions SET state='unknown', error_code='SUBMISSION_INTERRUPTED', error_message='The submission status could not be confirmed. Do not retry.', updated_at=?1 WHERE state='reserved'",
            params![timestamp],
        )
        .map_err(|_| "unknown: action journal could not recover interrupted actions")?;
    Ok(())
}

pub(super) fn reserve_in(
    connection: &Connection,
    reservation: Reservation<'_>,
    timestamp: i64,
) -> Result<(), String> {
    let inserted = connection.execute(
        "INSERT INTO actions(id,tenant,device_id,app_id,version_id,package_id,intent,baseline,state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'reserved',?9,?9)",
        params![reservation.id,reservation.tenant,reservation.device,reservation.app,reservation.version,reservation.package,reservation.intent.as_str(),reservation.baseline,timestamp],
    ).map_err(|_| "server: an active application action already exists")?;
    if inserted != 1 {
        return Err("unknown: action journal reservation did not persist".into());
    }
    Ok(())
}

pub(super) fn transition_in(
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

pub(super) fn action_in(connection: &Connection, id: &str) -> Result<Option<Action>, String> {
    connection
        .query_row(
            "SELECT id,device_id,app_id,version_id,package_id,intent,baseline,correlation,state,error_code,error_message,created_at,updated_at FROM actions WHERE id=?1",
            params![id],
            action_from_row,
        )
        .optional()
        .map_err(|_| "unknown: action journal is unavailable".into())
}

pub(super) fn active_actions_in(
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
        state: decode_state(row, 2)?,
    })
}

fn action_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Action> {
    let request = action_request_fields(row)?;
    let outcome = action_outcome_fields(row)?;
    Ok(Action {
        id: request.id,
        device_id: request.device_id,
        app_id: request.app_id,
        version_id: request.version_id,
        package_id: request.package_id,
        intent: request.intent,
        baseline: request.baseline,
        correlation: outcome.correlation,
        state: outcome.state,
        error_code: outcome.error_code,
        error_message: outcome.error_message,
        created_at: outcome.created_at,
        updated_at: outcome.updated_at,
    })
}

fn action_request_fields(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionRequest> {
    Ok(ActionRequest {
        id: row.get(0)?,
        device_id: row.get(1)?,
        app_id: row.get(2)?,
        version_id: row.get(3)?,
        package_id: row.get(4)?,
        intent: crate::domain::action::Intent::decode(&row.get::<_, String>(5)?),
        baseline: row.get(6)?,
    })
}

struct ActionOutcomeFields {
    correlation: Option<String>,
    state: State,
    error_code: Option<String>,
    error_message: Option<String>,
    created_at: i64,
    updated_at: i64,
}

fn action_outcome_fields(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionOutcomeFields> {
    Ok(ActionOutcomeFields {
        correlation: row.get(7)?,
        state: decode_state(row, 8)?,
        error_code: row.get(9)?,
        error_message: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn decode_state(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<State> {
    State::decode(&row.get::<_, String>(index)?)
        .map_err(|_| rusqlite::Error::InvalidColumnName("state".into()))
}

pub(super) fn prune(connection: &Connection, timestamp: i64) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM actions WHERE state IN ('succeeded','failed','cancelled') AND updated_at < ?1",
            params![timestamp - RETENTION_DAYS * 86400],
        )
        .map_err(|_| "unknown: action journal could not be pruned")?;
    Ok(())
}

// Retention failure must not obscure a successfully persisted action outcome.
pub(super) fn best_effort_prune(connection: &Connection, timestamp: i64) {
    let _ = prune(connection, timestamp);
}
