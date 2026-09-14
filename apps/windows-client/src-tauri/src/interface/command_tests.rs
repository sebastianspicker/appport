use super::{connect_started, native_error, sign_in_completion_error, COMMAND_NAMES};
use crate::application::session;
use serde::Deserialize;

#[derive(Deserialize)]
struct NativeContract {
    commands: Vec<String>,
    #[serde(rename = "nativeErrorCodes")]
    native_error_codes: Vec<String>,
}

#[test]
fn registered_commands_match_the_shared_manifest() {
    let manifest: NativeContract =
        serde_json::from_str(include_str!("../../../native-contract.json")).unwrap();
    assert_eq!(
        manifest.commands,
        COMMAND_NAMES
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        manifest.native_error_codes,
        [
            "OFFLINE",
            "SESSION_EXPIRED",
            "AUTHORIZATION_DENIED",
            "DEVICE_MATCH_FAILED",
            "SERVER",
            "SUPPORT",
            "UNKNOWN",
        ]
    );
}

#[test]
fn task_registration_is_an_additive_partial_outcome() {
    let started = connect_started(false);
    assert!(!started.background_check_registered);
}

#[test]
fn stale_sign_in_completion_preserves_the_public_session_expired_error() {
    let error = sign_in_completion_error(session::SignInCompletionError::StaleCredential);
    assert_eq!(error.code, "SESSION_EXPIRED");
    assert_eq!(error.message, "session-expired: sign-in was superseded");
}

#[test]
fn authorization_error_has_a_distinct_public_code() {
    let error = native_error("authorization: account lacks required access".into());
    assert_eq!(error.code, "AUTHORIZATION_DENIED");
}

#[test]
fn support_errors_have_a_distinct_public_code() {
    let error = native_error("support: unable to create support bundle".into());
    assert_eq!(error.code, "SUPPORT");
}
