use super::{
    action_details_match, attach_active_actions, baseline, correlation_candidates,
    inventory_matches, remote_action_blocks_request, remote_state, request_intent,
    select_correlation, to_action, Action, ActionState, ActiveAction, Intent, RemoteAction,
    RemoteActionDetails, State, Transition,
};
use crate::domain::catalog::{AppInstallState, AppSource, AvailableApp, InstalledApp};
use crate::error::Error;
use std::collections::HashSet;

const ALL_STATES: [State; 9] = [
    State::Reserved,
    State::Queued,
    State::Sent,
    State::Deferred,
    State::Verifying,
    State::Succeeded,
    State::Failed,
    State::Cancelled,
    State::Unknown,
];

fn action(correlation: Option<&str>) -> Action {
    Action {
        id: "action-1".into(),
        device_id: "device".into(),
        app_id: "app-1".into(),
        version_id: "ver-1".into(),
        package_id: Some("Pkg.Id".into()),
        intent: Intent::Install,
        baseline: "old-1,old-2".into(),
        correlation: correlation.map(Into::into),
        state: State::Reserved,
        error_code: None,
        error_message: None,
        created_at: 1_000,
        updated_at: 1_001,
    }
}

fn details(app: Option<&str>, version: Option<&str>, package: Option<&str>) -> RemoteActionDetails {
    RemoteActionDetails {
        app_id: app.map(Into::into),
        version_id: version.map(Into::into),
        package_id: package.map(Into::into),
    }
}

fn remote(id: &str, created_at: i64, details: Option<RemoteActionDetails>) -> RemoteAction {
    RemoteAction {
        id: id.into(),
        state: "NEW".into(),
        created_at,
        details,
    }
}

fn matching(id: &str) -> RemoteAction {
    remote(
        id,
        1_000,
        Some(details(Some("app-1"), Some("ver-1"), Some("Pkg.Id"))),
    )
}

fn catalog_app(installed: Option<&str>, state: AppInstallState) -> AvailableApp {
    AvailableApp {
        id: "app-1".into(),
        name: "App".into(),
        description: None,
        publisher: None,
        source: AppSource::Winget,
        package_identifier: None,
        released_version_id: "ver-2".into(),
        released_version_label: None,
        installed_version_id: installed.map(Into::into),
        installed_version_label: None,
        install_state: state,
        active_action_id: None,
        active_action_state: None,
        has_icon: false,
    }
}

fn ids(actions: Vec<RemoteAction>) -> Vec<String> {
    actions.into_iter().map(|action| action.id).collect()
}

#[test]
fn state_names_round_trip_and_invalid_names_fail() {
    for state in ALL_STATES {
        assert_eq!(State::decode(state.as_str()), Ok(state));
    }
    assert_eq!(
        State::decode("Queued"),
        Err(Error::unknown("action journal contains an invalid state"))
    );
}

#[test]
fn terminal_and_catalog_active_states_differ_for_unknown() {
    let terminal: Vec<_> = ALL_STATES.iter().filter(|s| s.terminal()).collect();
    assert_eq!(
        terminal,
        [
            &State::Succeeded,
            &State::Failed,
            &State::Cancelled,
            &State::Unknown
        ]
    );
    let active: Vec<_> = ALL_STATES.iter().filter(|s| s.catalog_active()).collect();
    // characterization: current behavior (Unknown is terminal yet still catalog-active)
    assert_eq!(
        active,
        [
            &State::Reserved,
            &State::Queued,
            &State::Sent,
            &State::Deferred,
            &State::Verifying,
            &State::Unknown
        ]
    );
}

#[test]
fn reserved_is_exposed_as_queued() {
    assert_eq!(ActionState::from(State::Reserved), ActionState::Queued);
    assert_eq!(ActionState::from(State::Queued), ActionState::Queued);
}

#[test]
fn intent_decodes_leniently_to_install() {
    assert_eq!(Intent::decode("update"), Intent::Update);
    assert_eq!(Intent::decode("install"), Intent::Install);
    // characterization: current behavior (anything but "update" decodes as install)
    assert_eq!(Intent::decode("UPDATE"), Intent::Install);
    assert_eq!(Intent::Update.as_str(), "update");
}

#[test]
fn remote_states_map_and_unrecognized_values_are_unknown() {
    for (value, state) in [
        ("NEW", State::Queued),
        ("PENDING", State::Queued),
        ("PUSH_SENT", State::Queued),
        ("DELIVERED_CANCELABLE", State::Sent),
        ("DELIVERED", State::Sent),
        ("DELIVERY_CONFIRMED", State::Sent),
        ("NOT_NOW", State::Deferred),
        ("EXECUTED", State::Verifying),
        ("ERROR", State::Failed),
        ("CANCELLED", State::Cancelled),
        ("new", State::Unknown),
        ("SOMETHING_ELSE", State::Unknown),
        ("", State::Unknown),
    ] {
        assert_eq!(remote_state(value), state, "{value}");
    }
}

#[test]
fn remote_actions_block_requests_except_terminal_success_failure_cancel() {
    let blocking: Vec<_> = ALL_STATES
        .iter()
        .filter(|s| remote_action_blocks_request(**s))
        .collect();
    // characterization: current behavior (Reserved does not block here)
    assert_eq!(
        blocking,
        [
            &State::Queued,
            &State::Sent,
            &State::Deferred,
            &State::Verifying,
            &State::Unknown
        ]
    );
}

#[test]
fn transition_targets_and_details_are_pinned() {
    let observed = Transition::RemoteObserved {
        state: State::Failed,
        correlation: "remote-1",
        error_code: Some("E1"),
    };
    assert_eq!(observed.target(), State::Failed);
    assert_eq!(observed.detail(), (Some("remote-1"), Some("E1"), None));
    assert_eq!(Transition::SubmissionAccepted.target(), State::Queued);
    assert_eq!(Transition::SubmissionAccepted.detail(), (None, None, None));
    assert_eq!(Transition::InventoryConfirmed.target(), State::Succeeded);
    assert_eq!(Transition::InventoryConfirmed.detail(), (None, None, None));
    assert_eq!(Transition::SubmissionRejected.target(), State::Failed);
    assert_eq!(
        Transition::SubmissionRejected.detail(),
        (
            None,
            Some("SUBMISSION_REJECTED"),
            Some("Relution rejected the application request.")
        )
    );
    assert_eq!(Transition::SubmissionUncertain.target(), State::Unknown);
    assert_eq!(
        Transition::SubmissionUncertain.detail(),
        (
            None,
            Some("SUBMISSION_UNCERTAIN"),
            Some("The submission status could not be confirmed. Do not retry.")
        )
    );
    assert_eq!(Transition::VerificationTimedOut.target(), State::Unknown);
    assert_eq!(
        Transition::VerificationTimedOut.detail(),
        (
            None,
            Some("INVENTORY_VERIFICATION_TIMEOUT"),
            Some("The installed version could not be confirmed. Do not retry.")
        )
    );
    for (known, code) in [
        (true, "RELUTION_ACTION_NOT_FOUND"),
        (false, "AMBIGUOUS_RELUTION_ACTION"),
    ] {
        let missing = Transition::RemoteMissing {
            correlation_known: known,
        };
        assert_eq!(missing.target(), State::Unknown);
        assert_eq!(
            missing.detail(),
            (
                None,
                Some(code),
                Some("The submission status could not be confirmed. Do not retry.")
            )
        );
    }
}

fn allowed(transition: &Transition) -> Vec<State> {
    ALL_STATES
        .into_iter()
        .filter(|state| transition.allowed_from(*state))
        .collect()
}

#[test]
fn transition_legality_matrix_is_pinned() {
    let active = [
        State::Queued,
        State::Sent,
        State::Deferred,
        State::Verifying,
    ];
    for transition in [
        Transition::SubmissionAccepted,
        Transition::SubmissionRejected,
        Transition::SubmissionUncertain,
    ] {
        assert_eq!(allowed(&transition), [State::Reserved]);
    }
    for transition in [
        Transition::InventoryConfirmed,
        Transition::VerificationTimedOut,
    ] {
        assert_eq!(allowed(&transition), [State::Verifying]);
    }
    assert_eq!(
        allowed(&Transition::RemoteMissing {
            correlation_known: true
        }),
        active
    );
    for target in ALL_STATES {
        let transition = Transition::RemoteObserved {
            state: target,
            correlation: "c",
            error_code: None,
        };
        let expected: &[State] = if matches!(target, State::Reserved | State::Succeeded) {
            &[]
        } else {
            &active
        };
        assert_eq!(allowed(&transition), expected, "{target:?}");
    }
}

#[test]
fn to_action_exposes_public_state_and_stringified_timestamps() {
    let mut journal = action(None);
    journal.intent = Intent::Update;
    journal.error_code = Some("E".into());
    journal.error_message = Some("M".into());
    let public = to_action(journal);
    assert_eq!(public.state, ActionState::Queued);
    assert_eq!(public.intent, Intent::Update);
    assert_eq!(
        (public.created_at.as_str(), public.updated_at.as_str()),
        ("1000", "1001")
    );
    assert_eq!(public.error_code.as_deref(), Some("E"));
}

#[test]
fn active_actions_attach_by_app_id_and_last_duplicate_wins() {
    let mut apps = vec![catalog_app(None, AppInstallState::Available)];
    let mut other = catalog_app(None, AppInstallState::Available);
    other.id = "app-2".into();
    apps.push(other);
    let active = |id: &str, app: &str, state| ActiveAction {
        id: id.into(),
        app_id: app.into(),
        state,
    };
    attach_active_actions(
        &mut apps,
        vec![
            active("a1", "app-1", State::Queued),
            active("a2", "app-1", State::Reserved),
            active("a3", "missing", State::Sent),
        ],
    );
    assert_eq!(apps[0].active_action_id.as_deref(), Some("a2"));
    assert_eq!(apps[0].active_action_state, Some(ActionState::Queued));
    assert_eq!(apps[1].active_action_id, None);
    assert_eq!(apps[1].active_action_state, None);
}

#[test]
fn request_intent_install_update_or_refusal() {
    let refused = Err(Error::server(
        "application is already current or update is not approved",
    ));
    assert_eq!(
        request_intent(&catalog_app(None, AppInstallState::Available)),
        Ok(Intent::Install)
    );
    assert_eq!(
        request_intent(&catalog_app(
            Some("ver-1"),
            AppInstallState::UpdateAvailable
        )),
        Ok(Intent::Update)
    );
    assert_eq!(
        request_intent(&catalog_app(
            Some("ver-2"),
            AppInstallState::UpdateAvailable
        )),
        refused
    );
    assert_eq!(
        request_intent(&catalog_app(Some("ver-1"), AppInstallState::Available)),
        refused
    );
    // characterization: current behavior (an update state without an installed version installs)
    assert_eq!(
        request_intent(&catalog_app(None, AppInstallState::UpdateAvailable)),
        Ok(Intent::Install)
    );
    // characterization: current behavior (installed version ids compare case-sensitively here)
    assert_eq!(
        request_intent(&catalog_app(
            Some("VER-2"),
            AppInstallState::UpdateAvailable
        )),
        Ok(Intent::Update)
    );
}

#[test]
fn details_match_requires_one_positive_and_no_contradicting_field() {
    let check = |d: Option<RemoteActionDetails>, package| {
        action_details_match(d.as_ref(), "app-1", "ver-1", package)
    };
    assert!(!check(None, Some("Pkg.Id")));
    assert!(!check(Some(details(None, None, None)), Some("Pkg.Id")));
    assert!(check(
        Some(details(Some("APP-1"), Some("Ver-1"), None)),
        None
    ));
    assert!(check(Some(details(Some("app-1"), None, None)), None));
    assert!(check(
        Some(details(None, None, Some("Pkg.Id"))),
        Some("Pkg.Id")
    ));
    assert!(!check(Some(details(None, None, Some("Pkg.Id"))), None));
    assert!(!check(
        Some(details(Some("app-2"), Some("ver-1"), None)),
        None
    ));
    assert!(!check(
        Some(details(Some("app-1"), Some("ver-2"), None)),
        None
    ));
    // package identifiers compare case-sensitively
    assert!(!check(
        Some(details(Some("app-1"), None, Some("pkg.id"))),
        Some("Pkg.Id")
    ));
}

fn inventory(app: Option<&str>, version: Option<&str>, identifier: Option<&str>) -> InstalledApp {
    InstalledApp {
        identifier: identifier.map(Into::into),
        app_id: app.map(Into::into),
        version_id: version.map(Into::into),
        version_label: None,
        has_update: None,
    }
}

#[test]
fn inventory_confirmation_needs_exact_app_version_and_package() {
    let check = |i: InstalledApp, package| inventory_matches(&i, "app-1", "ver-1", package);
    assert!(check(
        inventory(Some("APP-1"), Some("VER-1"), Some("Pkg.Id")),
        Some("Pkg.Id")
    ));
    assert!(check(inventory(Some("app-1"), Some("ver-1"), None), None));
    assert!(check(
        inventory(Some("app-1"), Some("ver-1"), Some("Other")),
        None
    ));
    assert!(!check(
        inventory(Some("app-1"), Some("ver-1"), None),
        Some("Pkg.Id")
    ));
    assert!(!check(
        inventory(Some("app-1"), Some("ver-1"), Some("pkg.id")),
        Some("Pkg.Id")
    ));
    assert!(!check(
        inventory(Some("app-1"), Some("ver-0"), Some("Pkg.Id")),
        Some("Pkg.Id")
    ));
    assert!(!check(
        inventory(Some("app-2"), Some("ver-1"), Some("Pkg.Id")),
        Some("Pkg.Id")
    ));
    assert!(!check(
        inventory(None, Some("ver-1"), Some("Pkg.Id")),
        Some("Pkg.Id")
    ));
    assert!(!check(
        inventory(Some("app-1"), None, Some("Pkg.Id")),
        Some("Pkg.Id")
    ));
}

#[test]
fn baseline_splits_on_commas_and_skips_empty_entries() {
    let mut journal = action(None);
    assert_eq!(baseline(&journal), HashSet::from(["old-1", "old-2"]));
    journal.baseline = ",a,,b,".into();
    assert_eq!(baseline(&journal), HashSet::from(["a", "b"]));
    journal.baseline = String::new();
    assert!(baseline(&journal).is_empty());
}

#[test]
fn correlation_candidates_filter_baseline_age_and_details() {
    let journal = action(None);
    let base = baseline(&journal);
    let candidates = vec![
        matching("new-1"),
        matching("old-1"),
        remote("edge-ok", 995, Some(details(Some("app-1"), None, None))),
        remote("too-old", 994, Some(details(Some("app-1"), None, None))),
        remote("other-app", 1_000, Some(details(Some("app-2"), None, None))),
        remote("no-details", 1_000, None),
        remote("later", 5_000, Some(details(None, Some("VER-1"), None))),
    ];
    assert_eq!(
        ids(correlation_candidates(candidates, &base, &journal)),
        ["new-1", "edge-ok", "later"]
    );
}

#[test]
fn correlation_selection_by_known_id_or_single_candidate_only() {
    let journal = action(None);
    assert!(select_correlation(&journal, vec![]).is_none());
    assert_eq!(
        select_correlation(&journal, vec![matching("only")]).map(|a| a.id),
        Some("only".into())
    );
    assert!(select_correlation(&journal, vec![matching("a"), matching("b")]).is_none());
    let known = action(Some("b"));
    assert_eq!(
        select_correlation(&known, vec![matching("a"), matching("b")]).map(|a| a.id),
        Some("b".into())
    );
    assert!(select_correlation(&known, vec![matching("a")]).is_none());
    assert!(select_correlation(&known, vec![]).is_none());
    // characterization: current behavior (known correlation ids compare case-sensitively)
    assert!(select_correlation(&known, vec![matching("B")]).is_none());
}
