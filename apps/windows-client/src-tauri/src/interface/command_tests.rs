use super::{native_error, wire, COMMAND_NAMES};
use crate::{
    application::{desktop, session},
    error::{Error, ErrorKind},
};
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
    let started = wire::ConnectStarted::from(desktop::ConnectStarted {
        background_check_registered: false,
    });
    assert!(!started.background_check_registered);
}

#[test]
fn stale_sign_in_completion_preserves_the_public_session_expired_error() {
    let error = native_error(desktop::sign_in_completion_error(
        session::SignInCompletionError::StaleCredential,
    ));
    assert_eq!(error.code, "SESSION_EXPIRED");
    assert_eq!(error.message, "session-expired: sign-in was superseded");
}

#[test]
fn every_error_kind_maps_to_its_public_code_and_unchanged_message() {
    let table = [
        (ErrorKind::Offline, "OFFLINE", "offline: sample detail"),
        (
            ErrorKind::SessionExpired,
            "SESSION_EXPIRED",
            "session-expired: sample detail",
        ),
        (
            ErrorKind::Authorization,
            "AUTHORIZATION_DENIED",
            "authorization: sample detail",
        ),
        (
            ErrorKind::DeviceMatchFailed,
            "DEVICE_MATCH_FAILED",
            "device_match_failed: sample detail",
        ),
        (ErrorKind::Server, "SERVER", "server: sample detail"),
        (ErrorKind::Support, "SUPPORT", "support: sample detail"),
        (
            ErrorKind::Configuration,
            "UNKNOWN",
            "configuration: sample detail",
        ),
        (ErrorKind::Unknown, "UNKNOWN", "unknown: sample detail"),
    ];
    assert_eq!(table.map(|(kind, _, _)| kind), ErrorKind::ALL);
    for (kind, code, message) in table {
        let error = native_error(Error::new(kind, "sample detail"));
        assert_eq!((error.code, error.message.as_str()), (code, message));
    }
}
