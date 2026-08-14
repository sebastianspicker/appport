use super::*;

fn connection() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    initialize(&c).unwrap();
    c
}

fn insert(c: &Connection, id: &str, device: &str, app: &str, state: State) {
    c.execute(
        "INSERT INTO actions VALUES (?1,'t',?2,?3,'v',NULL,'install','',NULL,?4,NULL,NULL,1,1)",
        params![id, device, app, state.as_str()],
    )
    .unwrap();
}

#[test]
fn transitions_are_typed_atomic_and_terminal_states_do_not_reopen() {
    let c = connection();
    insert(&c, "one", "d", "a", State::Reserved);
    transition_in(
        &c,
        "one",
        State::Reserved,
        Transition::SubmissionAccepted,
        2,
    )
    .unwrap();
    assert_eq!(
        transition_in(
            &c,
            "one",
            State::Reserved,
            Transition::SubmissionAccepted,
            3
        )
        .unwrap_err(),
        "server: stale application action transition"
    );
    transition_in(
        &c,
        "one",
        State::Queued,
        Transition::RemoteObserved {
            state: State::Verifying,
            correlation: "remote",
            error_code: None,
        },
        3,
    )
    .unwrap();
    transition_in(
        &c,
        "one",
        State::Verifying,
        Transition::InventoryConfirmed,
        4,
    )
    .unwrap();
    assert!(transition_in(
        &c,
        "one",
        State::Succeeded,
        Transition::RemoteObserved {
            state: State::Queued,
            correlation: "remote",
            error_code: None
        },
        5
    )
    .is_err());
    assert_eq!(
        transition_in(
            &c,
            "missing",
            State::Reserved,
            Transition::SubmissionAccepted,
            5
        )
        .unwrap_err(),
        "server: application action was not found"
    );
}

#[test]
fn correlation_is_assigned_once_and_remote_transition_is_atomic() {
    let c = connection();
    insert(&c, "one", "d", "a", State::Queued);
    transition_in(
        &c,
        "one",
        State::Queued,
        Transition::RemoteObserved {
            state: State::Sent,
            correlation: "remote-one",
            error_code: None,
        },
        2,
    )
    .unwrap();
    assert!(transition_in(
        &c,
        "one",
        State::Sent,
        Transition::RemoteObserved {
            state: State::Verifying,
            correlation: "remote-two",
            error_code: None
        },
        3
    )
    .is_err());
    let values: (String, String) = c
        .query_row(
            "SELECT correlation,state FROM actions WHERE id='one'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(values, ("remote-one".into(), "sent".into()));
}

#[test]
fn recovery_is_explicit_once_and_unknown_actions_remain_active() {
    let c = connection();
    insert(&c, "one", "d", "a", State::Reserved);
    recover_in(&c, 2).unwrap();
    recover_in(&c, 3).unwrap();
    let recovered: (String, i64) = c
        .query_row(
            "SELECT state,updated_at FROM actions WHERE id='one'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(recovered, ("unknown".into(), 2));
    assert!(c.execute("INSERT INTO actions VALUES ('two','t','d','a','v',NULL,'install','',NULL,'queued',NULL,NULL,1,1)", []).is_err());
    c.execute("UPDATE actions SET updated_at=0 WHERE id='one'", [])
        .unwrap();
    prune(&c, RETENTION_DAYS * 86400 + 1).unwrap();
    assert!(c
        .query_row("SELECT 1 FROM actions WHERE id='one'", [], |_| Ok(()))
        .optional()
        .unwrap()
        .is_some());
}

#[test]
fn action_visibility_is_device_scoped_and_includes_unknown_only_when_active() {
    let c = connection();
    insert(&c, "queued", "device-one", "app-one", State::Queued);
    insert(&c, "terminal", "device-one", "app-two", State::Succeeded);
    insert(&c, "unknown", "device-two", "app-one", State::Unknown);
    let one = active_actions_in(&c, "device-one").unwrap();
    assert_eq!(one.len(), 1);
    assert_eq!(
        (&one[0].id, &one[0].app_id, one[0].state),
        (&"queued".into(), &"app-one".into(), State::Queued)
    );
    let two = active_actions_in(&c, "device-two").unwrap();
    assert_eq!(
        (two[0].id.as_str(), two[0].state),
        ("unknown", State::Unknown)
    );
    assert!(State::decode("future").is_err());
}

#[test]
fn visibility_fails_closed_when_a_persisted_state_cannot_be_decoded() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE actions (id TEXT, device_id TEXT, app_id TEXT, state TEXT, created_at INTEGER);").unwrap();
    c.execute(
        "INSERT INTO actions VALUES ('bad','device','app','future',1)",
        [],
    )
    .unwrap();
    assert!(active_actions_in(&c, "device").is_err());
}

#[test]
fn ambiguous_submission_persists_unknown_without_losing_its_action_id() {
    let c = connection();
    insert(&c, "saved-id", "d", "a", State::Reserved);
    transition_in(
        &c,
        "saved-id",
        State::Reserved,
        Transition::SubmissionUncertain,
        2,
    )
    .unwrap();
    let saved: (String, String, String) = c
        .query_row(
            "SELECT id,state,error_code FROM actions WHERE id='saved-id'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        saved,
        (
            "saved-id".into(),
            "unknown".into(),
            "SUBMISSION_UNCERTAIN".into()
        )
    );
}

#[test]
fn retention_failure_does_not_become_a_transition_failure() {
    let c = connection();
    c.execute("DROP TABLE actions", []).unwrap();
    best_effort_prune(&c, 2);
}

fn recover_in(connection: &Connection, timestamp: i64) -> Result<(), String> {
    connection.execute("UPDATE actions SET state='unknown', error_code='SUBMISSION_INTERRUPTED', error_message='The submission status could not be confirmed. Do not retry.', updated_at=?1 WHERE state='reserved'", params![timestamp]).map_err(|_| "unknown: action journal could not recover interrupted actions")?;
    Ok(())
}
