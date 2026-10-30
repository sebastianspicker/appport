use super::tests::ALL_STATES;
use super::{
    remote_actions_block, unknown_release_due, Action, Intent, RemoteAction, RemoteActionDetails,
    State, Transition, UNKNOWN_RELEASE_AFTER_SECONDS,
};

fn unknown_action(updated_at: i64) -> Action {
    Action {
        id: "action-1".into(),
        device_id: "device".into(),
        app_id: "app-1".into(),
        version_id: "ver-1".into(),
        package_id: Some("Pkg.Id".into()),
        intent: Intent::Install,
        baseline: String::new(),
        correlation: Some("remote-1".into()),
        state: State::Unknown,
        error_code: Some("SUBMISSION_UNCERTAIN".into()),
        error_message: None,
        created_at: 1,
        updated_at,
    }
}

fn remote(id: &str, state: &str, details: Option<RemoteActionDetails>) -> RemoteAction {
    RemoteAction {
        id: id.into(),
        state: state.into(),
        created_at: 1,
        details,
    }
}

fn target_details() -> Option<RemoteActionDetails> {
    Some(RemoteActionDetails {
        app_id: Some("APP-1".into()),
        version_id: Some("ver-1".into()),
        package_id: Some("Pkg.Id".into()),
    })
}

fn blocks(actions: &[RemoteAction], correlation: Option<&str>) -> bool {
    remote_actions_block(actions, "app-1", "ver-1", Some("Pkg.Id"), correlation)
}

#[test]
fn unknown_release_moves_only_unknown_to_failed_with_an_explicit_code() {
    let release = Transition::UnknownReleased;
    assert_eq!(release.target(), State::Failed);
    assert_eq!(
        release.detail(),
        (
            None,
            Some("UNKNOWN_RELEASED"),
            Some(
                "Relution shows no active request for this application. You can request it again."
            )
        )
    );
    for state in ALL_STATES {
        assert_eq!(release.allowed_from(state), state == State::Unknown);
    }
}

#[test]
fn inventory_confirmation_is_allowed_from_verifying_and_unknown_only() {
    let allowed: Vec<_> = ALL_STATES
        .into_iter()
        .filter(|state| Transition::InventoryConfirmed.allowed_from(*state))
        .collect();
    assert_eq!(allowed, [State::Verifying, State::Unknown]);
}

#[test]
fn unknown_release_waits_for_the_full_delay_after_the_last_change() {
    let action = unknown_action(1_000);
    assert!(!unknown_release_due(
        &action,
        1_000 + UNKNOWN_RELEASE_AFTER_SECONDS - 1
    ));
    assert!(unknown_release_due(
        &action,
        1_000 + UNKNOWN_RELEASE_AFTER_SECONDS
    ));
    let verifying = Action {
        state: State::Verifying,
        ..unknown_action(1_000)
    };
    assert!(!unknown_release_due(&verifying, i64::MAX));
}

#[test]
fn matching_active_remote_actions_block_and_terminal_ones_do_not() {
    for (state, expected) in [
        ("PENDING", true),
        ("DELIVERED", true),
        ("NOT_NOW", true),
        ("EXECUTED", true),
        ("FUTURE_STATE", true),
        ("ERROR", false),
        ("CANCELLED", false),
    ] {
        let actions = [remote("other", state, target_details())];
        assert_eq!(blocks(&actions, None), expected, "{state}");
    }
    let other_app = Some(RemoteActionDetails {
        app_id: Some("app-2".into()),
        version_id: None,
        package_id: None,
    });
    assert!(!blocks(&[remote("other", "PENDING", other_app)], None));
    assert!(!blocks(&[], None));
}

#[test]
fn a_correlated_remote_action_blocks_even_without_details() {
    let actions = [remote("remote-1", "PENDING", None)];
    assert!(blocks(&actions, Some("remote-1")));
    assert!(!blocks(&actions, Some("remote-2")));
    assert!(!blocks(&actions, None));
    assert!(!blocks(
        &[remote("remote-1", "ERROR", None)],
        Some("remote-1")
    ));
}
