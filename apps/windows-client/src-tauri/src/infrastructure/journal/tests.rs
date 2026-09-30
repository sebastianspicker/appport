use super::{
    storage::{active_actions_in, best_effort_prune, initialize, prune, RETENTION_DAYS},
    ActionJournal,
};
use crate::domain::action::{Intent, Reservation, State, Transition};
use crate::error::Error;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;

#[test]
fn clone_reuses_the_successful_connection() {
    let fixture = Fixture::new();
    let journal = ActionJournal::at_path(fixture.path.clone());
    journal
        .with_connection(|connection| {
            connection
                .execute("CREATE TEMP TABLE connection_probe(value INTEGER)", [])
                .map_err(|error| Error::unknown(error.to_string()))?;
            connection
                .execute("INSERT INTO connection_probe VALUES (7)", [])
                .map_err(|error| Error::unknown(error.to_string()))?;
            Ok(())
        })
        .unwrap();

    let value: i64 = journal
        .clone()
        .with_connection(|connection| {
            connection
                .query_row("SELECT value FROM connection_probe", [], |row| row.get(0))
                .map_err(|error| Error::unknown(error.to_string()))
        })
        .unwrap();
    assert_eq!(value, 7);
}

#[test]
fn failed_initialization_is_retried() {
    let fixture = Fixture::new();
    std::fs::create_dir(&fixture.path).unwrap();
    let journal = ActionJournal::at_path(fixture.path.clone());
    let runtime = runtime();
    assert!(runtime.block_on(journal.active_actions("device")).is_err());

    std::fs::remove_dir(&fixture.path).unwrap();
    assert_eq!(
        runtime.block_on(journal.active_actions("device")).unwrap(),
        []
    );
}

#[cfg(unix)]
#[test]
fn database_and_sidecar_symbolic_links_are_rejected() {
    for suffix in ["", "-wal", "-shm"] {
        let fixture = Fixture::new();
        let linked = PathBuf::from(format!("{}{suffix}", fixture.path.display()));
        std::os::unix::fs::symlink(fixture.root.join("missing-target"), linked).unwrap();
        let journal = ActionJournal::at_path(fixture.path.clone());
        assert!(runtime()
            .block_on(journal.active_actions("device"))
            .is_err());
    }
}

#[cfg(unix)]
#[test]
fn sidecar_replacement_is_rejected_after_initialization() {
    let fixture = Fixture::new();
    let journal = ActionJournal::at_path(fixture.path.clone());
    let runtime = runtime();
    runtime.block_on(journal.active_actions("device")).unwrap();
    let sidecar = PathBuf::from(format!("{}-wal", fixture.path.display()));
    std::fs::remove_file(&sidecar).unwrap();
    std::os::unix::fs::symlink(fixture.root.join("missing-target"), sidecar).unwrap();
    assert!(runtime.block_on(journal.active_actions("device")).is_err());
}

#[test]
fn reservations_are_durable_and_unique_across_connections() {
    let fixture = Fixture::new();
    let first = ActionJournal::at_path(fixture.path.clone());
    let second = ActionJournal::at_path(fixture.path.clone());
    let runtime = runtime();

    runtime
        .block_on(first.reserve(reservation("one", "device", "app")))
        .unwrap();
    let action = runtime.block_on(second.action("one")).unwrap().unwrap();
    assert_eq!((action.id.as_str(), action.state), ("one", State::Reserved));
    assert_eq!(
        runtime
            .block_on(second.active_actions("device"))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        runtime
            .block_on(second.reserve(reservation("two", "device", "app")))
            .unwrap_err(),
        Error::server("an active application action already exists")
    );
}

#[test]
fn transitions_are_compare_and_set_and_own_borrowed_details() {
    let fixture = Fixture::new();
    let journal = ActionJournal::at_path(fixture.path.clone());
    let runtime = runtime();
    runtime
        .block_on(journal.reserve(reservation("one", "device", "app")))
        .unwrap();
    runtime
        .block_on(journal.transition("one", State::Reserved, Transition::SubmissionAccepted))
        .unwrap();
    let correlation = String::from("remote-one");
    runtime
        .block_on(journal.transition(
            "one",
            State::Queued,
            Transition::RemoteObserved {
                state: State::Verifying,
                correlation: &correlation,
                error_code: None,
            },
        ))
        .unwrap();
    assert_eq!(
        runtime
            .block_on(journal.transition(
                "one",
                State::Queued,
                Transition::RemoteObserved {
                    state: State::Sent,
                    correlation: "different",
                    error_code: None,
                },
            ))
            .unwrap_err(),
        Error::server("stale application action transition")
    );
    assert_eq!(
        runtime
            .block_on(journal.action("one"))
            .unwrap()
            .unwrap()
            .correlation
            .as_deref(),
        Some("remote-one")
    );
    assert_eq!(
        runtime
            .block_on(journal.transition(
                "missing",
                State::Reserved,
                Transition::SubmissionAccepted,
            ))
            .unwrap_err(),
        Error::server("application action was not found")
    );
    assert_eq!(
        runtime
            .block_on(journal.transition("one", State::Verifying, Transition::SubmissionAccepted,))
            .unwrap_err(),
        Error::server("illegal application action transition")
    );
}

#[test]
fn schema_preserves_wal_timeout_and_active_index() {
    let fixture = Fixture::new();
    let journal = ActionJournal::at_path(fixture.path.clone());
    runtime()
        .block_on(journal.active_actions("device"))
        .unwrap();
    journal
        .with_connection(|connection| {
            let busy: i64 = connection
                .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
                .map_err(|error| Error::unknown(error.to_string()))?;
            let mode: String = connection
                .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                .map_err(|error| Error::unknown(error.to_string()))?;
            let index: String = connection
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='index' AND name='active_action_per_app'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| Error::unknown(error.to_string()))?;
            assert_eq!(busy, 5_000);
            assert_eq!(mode, "wal");
            assert!(index.contains("WHERE state IN"));
            Ok(())
        })
        .unwrap();
}

#[test]
fn startup_recovery_is_explicit_and_idempotent() {
    let fixture = Fixture::new();
    let journal = ActionJournal::at_path(fixture.path.clone());
    let runtime = runtime();
    runtime
        .block_on(journal.reserve(reservation("one", "device", "app-one")))
        .unwrap();
    journal.recover_interrupted_reservations().unwrap();
    let recovered = runtime.block_on(journal.action("one")).unwrap().unwrap();
    assert_eq!(recovered.state, State::Unknown);
    assert_eq!(
        recovered.error_code.as_deref(),
        Some("SUBMISSION_INTERRUPTED")
    );

    runtime
        .block_on(journal.reserve(reservation("two", "device", "app-two")))
        .unwrap();
    assert_eq!(
        runtime
            .block_on(journal.action("two"))
            .unwrap()
            .unwrap()
            .state,
        State::Reserved
    );
}

#[test]
fn retention_prunes_only_old_terminal_actions() {
    let connection = connection();
    insert(
        &connection,
        "terminal",
        "device",
        "one",
        State::Succeeded,
        0,
    );
    insert(&connection, "active", "device", "two", State::Unknown, 0);
    prune(&connection, RETENTION_DAYS * 86_400 + 1).unwrap();
    assert!(!exists(&connection, "terminal"));
    assert!(exists(&connection, "active"));

    connection.execute("DROP TABLE actions", []).unwrap();
    best_effort_prune(&connection, RETENTION_DAYS * 86_400 + 1);
}

#[test]
fn visibility_fails_closed_for_an_invalid_persisted_state() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE actions (id TEXT, device_id TEXT, app_id TEXT, state TEXT, created_at INTEGER);",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO actions VALUES ('bad','device','app','future',1)",
            [],
        )
        .unwrap();
    assert!(active_actions_in(&connection, "device").is_err());
}

fn reservation<'a>(id: &'a str, device: &'a str, app: &'a str) -> Reservation<'a> {
    Reservation {
        id,
        tenant: "tenant",
        device,
        app,
        version: "version",
        package: None,
        intent: Intent::Install,
        baseline: "",
    }
}

fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    initialize(&connection).unwrap();
    connection
}

fn insert(
    connection: &Connection,
    id: &str,
    device: &str,
    app: &str,
    state: State,
    updated_at: i64,
) {
    connection
        .execute(
            "INSERT INTO actions VALUES (?1,'tenant',?2,?3,'version',NULL,'install','',NULL,?4,NULL,NULL,1,?5)",
            params![id, device, app, state.as_str(), updated_at],
        )
        .unwrap();
}

fn exists(connection: &Connection, id: &str) -> bool {
    connection
        .query_row("SELECT 1 FROM actions WHERE id=?1", params![id], |_| Ok(()))
        .optional()
        .unwrap()
        .is_some()
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
}

struct Fixture {
    root: PathBuf,
    path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("appport-journal-{}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("actions.sqlite3");
        Self { root, path }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
