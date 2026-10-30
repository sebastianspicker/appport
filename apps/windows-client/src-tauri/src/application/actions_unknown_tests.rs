use super::actions_tests::service_with_test_evidence;
use crate::{
    application::{
        action_test_support::{journal_environment, JournalSandbox, ASSIGNED_DEVICE},
        test_support::{client, run, server, Response},
    },
    domain::action::{
        ActionState, Intent, Reservation, State, Transition, UNKNOWN_RELEASE_AFTER_SECONDS,
    },
    error::Error,
    infrastructure::journal::ActionJournal,
};
use std::sync::{Arc, Mutex};

const MATCHING_INVENTORY: &str = r#"{"results":[{"identifier":"app.package","name":"App","appUuid":"app","versionUuid":"version","versionToShow":"2","versionName":null,"hasUpdateAvailable":false}]}"#;
const NO_INVENTORY: &str = r#"{"results":[]}"#;
const PENDING_REMOTE: &str = r#"{"results":[{"uuid":"remote","state":"PENDING","creationDate":1,"details":{"appUuid":"app","versionUuid":"version","appInternalName":"app.package"}}]}"#;
const FAILED_REMOTE: &str = r#"{"results":[{"uuid":"remote","state":"ERROR","creationDate":1,"details":{"appUuid":"app","versionUuid":"version","appInternalName":"app.package"}}]}"#;

fn reservation(id: &str) -> Reservation<'_> {
    Reservation {
        id,
        tenant: "tenant",
        device: "device",
        app: "app",
        version: "version",
        package: Some("app.package"),
        intent: Intent::Install,
        baseline: "",
    }
}

fn persist_unknown(age_seconds: i64) {
    let journal = ActionJournal::new();
    run(journal.reserve(reservation("action"))).expect("reserve");
    run(journal.transition("action", State::Reserved, Transition::SubmissionUncertain))
        .expect("uncertain submission");
    run(journal.backdate("action", age_seconds)).expect("backdate");
}

/// Answers device, inventory, and device-action reads and records which paths were requested.
fn relution(
    expected: usize,
    inventory: &'static str,
    remote_actions: &'static str,
) -> (
    url::Url,
    Arc<Mutex<Vec<String>>>,
    std::thread::JoinHandle<()>,
) {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&observed);
    let (base, _, handle) = server(expected, move |request| {
        let line = request.lines().next().expect("request line").to_owned();
        let body = if line.contains("/api/management/v2/devices/baseInfo/query") {
            ASSIGNED_DEVICE
        } else if line.contains("/installedApps/baseInfo/query") {
            inventory
        } else {
            assert!(
                line.contains("/api/management/v1/devices/device/actions"),
                "{line}"
            );
            remote_actions
        };
        recorded.lock().expect("observed lock").push(line);
        Response::json(200, body)
    });
    (base, observed, handle)
}

fn get_unknown_action(
    expected_requests: usize,
    inventory: &'static str,
    remote_actions: &'static str,
) -> (ActionState, Vec<String>) {
    let (base, observed, handle) = relution(expected_requests, inventory, remote_actions);
    let (service, _) = service_with_test_evidence(client(base, true));
    let action = run(service.get_action("token", "user", "action", 1)).expect("action");
    // Checked before joining so a missing request fails instead of blocking the mock server.
    assert_eq!(
        observed.lock().expect("observed lock").len(),
        expected_requests
    );
    handle.join().expect("mock server");
    let observed = observed.lock().expect("observed lock").clone();
    (action.state, observed)
}

fn saved() -> crate::domain::action::Action {
    run(ActionJournal::new().action("action"))
        .expect("journal read")
        .expect("saved action")
}

fn new_request_allowed() -> Result<(), Error> {
    run(ActionJournal::new().reserve(reservation("second-action")))
}

#[test]
fn unknown_action_succeeds_when_inventory_shows_the_exact_target() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    persist_unknown(0);

    let (state, observed) = get_unknown_action(2, MATCHING_INVENTORY, NO_INVENTORY);

    assert_eq!(state, ActionState::Succeeded);
    assert_eq!(saved().state, State::Succeeded);
    assert!(!observed.iter().any(|line| line.contains("/actions")));
    new_request_allowed().expect("lock released");
}

#[test]
fn recent_unknown_action_without_inventory_evidence_stays_locked() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    persist_unknown(UNKNOWN_RELEASE_AFTER_SECONDS - 60);

    let (state, observed) = get_unknown_action(2, NO_INVENTORY, NO_INVENTORY);

    assert_eq!(state, ActionState::Unknown);
    assert_eq!(saved().error_code.as_deref(), Some("SUBMISSION_UNCERTAIN"));
    assert!(!observed.iter().any(|line| line.contains("/actions")));
    assert_eq!(
        new_request_allowed().unwrap_err(),
        Error::server("an active application action already exists")
    );
}

#[test]
fn old_unknown_action_is_released_when_no_matching_relution_action_is_active() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    persist_unknown(UNKNOWN_RELEASE_AFTER_SECONDS + 1);

    let (state, observed) = get_unknown_action(3, NO_INVENTORY, FAILED_REMOTE);

    assert_eq!(state, ActionState::Failed);
    let action = saved();
    assert_eq!(action.state, State::Failed);
    assert_eq!(action.error_code.as_deref(), Some("UNKNOWN_RELEASED"));
    assert_eq!(
        observed
            .iter()
            .filter(|line| line.contains("/api/management/v1/devices/device/actions"))
            .count(),
        1
    );
    new_request_allowed().expect("lock released");
}

#[test]
fn old_unknown_action_stays_locked_while_a_matching_relution_action_is_active() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    persist_unknown(UNKNOWN_RELEASE_AFTER_SECONDS + 1);

    let (state, _) = get_unknown_action(3, NO_INVENTORY, PENDING_REMOTE);

    assert_eq!(state, ActionState::Unknown);
    assert_eq!(saved().state, State::Unknown);
    assert_eq!(
        new_request_allowed().unwrap_err(),
        Error::server("an active application action already exists")
    );
}
