//! Golden wire payloads shared with `apps/windows-client/wire-fixtures.json`.

use super::{native_error, wire, NativeError};
use crate::{
    application::desktop,
    domain::{action, catalog, support},
    error::Error,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn fixtures() -> Value {
    serde_json::from_str(include_str!("../../../wire-fixtures.json")).unwrap()
}

fn fixture(name: &str) -> Value {
    fixtures()
        .get(name)
        .unwrap_or_else(|| panic!("missing fixture {name}"))
        .clone()
}

fn assert_wire(value: impl Serialize, name: &str) {
    assert_eq!(
        serde_json::to_value(value).unwrap(),
        fixture(name),
        "{name}"
    );
}

fn assert_round_trip<T: DeserializeOwned + Serialize>(name: &str) {
    let value: T = serde_json::from_value(fixture(name)).unwrap();
    assert_wire(value, name);
}

fn with_extra_field(name: &str) -> Value {
    let mut value = fixture(name);
    value["unexpected"] = json!("value");
    value
}

fn domain_app() -> catalog::AvailableApp {
    catalog::AvailableApp {
        id: "app-1".into(),
        name: "Example App 1".into(),
        description: Some("Example description".into()),
        publisher: Some("Example Publisher".into()),
        source: catalog::AppSource::Winget,
        package_identifier: Some("Example.App1".into()),
        released_version_id: "version-1-2".into(),
        released_version_label: Some("2.0.0".into()),
        installed_version_id: Some("version-1-1".into()),
        installed_version_label: Some("1.0.0".into()),
        install_state: catalog::AppInstallState::UpdateAvailable,
        active_action_id: Some("action-1".into()),
        active_action_state: Some(action::ActionState::Queued),
        has_icon: true,
    }
}

fn domain_bootstrap() -> catalog::CatalogBootstrap {
    catalog::CatalogBootstrap {
        username: "Ada Lovelace".into(),
        device: catalog::DeviceSummary {
            id: "device-1".into(),
            name: "WIN-DEVICE-01".into(),
            status: "COMPLIANT".into(),
        },
        assigned_eligible_count: 3,
        available_count: 2,
        update_keys: vec![format!("sha256:{}", "ab".repeat(32))],
        writes_enabled: false,
    }
}

fn support_details(full: bool) -> support::SupportDetails {
    let text = |value: &str| full.then(|| value.to_string());
    support::SupportDetails {
        app_version: "1.0.0".into(),
        source_revision: "0123456789abcdef".into(),
        username: "ada".into(),
        device_name: "WIN-DEVICE-01".into(),
        device_status: "COMPLIANT".into(),
        windows_display: "Windows 11 Pro 24H2".into(),
        manufacturer: text("Example Corp"),
        model: text("Example Model"),
        smbios_serial: text("SN-0001"),
        matched_relution_last_ip: text("192.0.2.10"),
        matched_relution_last_connection_at: text("2026-01-01T00:00:00Z"),
        assigned_eligible_count: if full { 3 } else { 0 },
        available_count: if full { 2 } else { 0 },
        update_count: u32::from(full),
    }
}

#[test]
fn fixture_keys_are_the_reviewed_wire_types() {
    let mut keys: Vec<_> = fixtures().as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "AppAction",
            "AppActionVariants",
            "AvailableApp",
            "AvailableAppVariants",
            "CatalogSnapshot",
            "CatalogViews",
            "ConnectRequest",
            "ConnectStarted",
            "LoadCatalogRequest",
            "NativeBootstrap",
            "NativeErrors",
            "SignOutOutcome",
            "SupportBundleResult",
            "SupportDetails",
            "SupportDetailsMinimal",
        ]
    );
}

#[test]
fn simple_responses_match_the_golden_payloads() {
    assert_wire(
        wire::ConnectStarted::from(desktop::ConnectStarted {
            background_check_registered: true,
        }),
        "ConnectStarted",
    );
    assert_wire(
        wire::SignOutOutcome {
            token_revocation_required: true,
            credential_removed: true,
            scheduled_task_removed: false,
            notification_state_cleared: true,
        },
        "SignOutOutcome",
    );
    assert_wire(
        wire::SupportBundleResult::from(support::SupportBundleResult {
            bundle_file_name: "appport-support-20260101T000000Z.zip".into(),
            bytes: 2048,
            warnings: vec!["Example collector warning".into()],
        }),
        "SupportBundleResult",
    );
}

#[test]
fn catalog_responses_match_the_golden_payloads() {
    let app: wire::AvailableApp = domain_app().into();
    assert_wire(app.clone(), "AvailableApp");
    let bootstrap: wire::NativeBootstrap = domain_bootstrap().into();
    assert_wire(bootstrap, "NativeBootstrap");
    assert_wire(
        wire::CatalogSnapshot {
            bootstrap: domain_bootstrap().into(),
            apps: vec![app],
            catalog_revision: "opaque-revision".into(),
        },
        "CatalogSnapshot",
    );
}

#[test]
fn action_response_matches_the_golden_payload() {
    let journal = action::AppAction {
        id: "action-1".into(),
        device_id: "device-1".into(),
        app_id: "app-1".into(),
        intent: action::Intent::Install,
        state: action::ActionState::Queued,
        error_code: None,
        error_message: None,
        created_at: "1767225600".into(),
        updated_at: "1767225660".into(),
    };
    assert_wire(wire::AppAction::from(journal), "AppAction");
}

#[test]
fn support_details_match_the_golden_payloads() {
    assert_wire(
        wire::SupportDetails::from(support_details(true)),
        "SupportDetails",
    );
    assert_wire(
        wire::SupportDetails::from(support_details(false)),
        "SupportDetailsMinimal",
    );
}

#[test]
fn variant_fixtures_round_trip_and_cover_every_enum_value() {
    assert_round_trip::<Vec<wire::AvailableApp>>("AvailableAppVariants");
    assert_round_trip::<Vec<wire::AppAction>>("AppActionVariants");
    let apps = fixture("AvailableAppVariants");
    let actions = fixture("AppActionVariants");
    let seen = |list: &Value, key: &str| -> Vec<String> {
        let mut values: Vec<_> = list
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|item| item[key].as_str().map(String::from))
            .collect();
        values.sort();
        values.dedup();
        values
    };
    assert_eq!(
        seen(&apps, "source"),
        ["windows_exe", "windows_msi", "winget"]
    );
    assert_eq!(
        seen(&apps, "installState"),
        ["available", "update_available"]
    );
    let action_states = [
        "cancelled",
        "deferred",
        "failed",
        "queued",
        "sent",
        "succeeded",
        "unknown",
        "verifying",
    ];
    assert_eq!(seen(&apps, "activeActionState"), action_states);
    assert_eq!(seen(&actions, "state"), action_states);
    assert_eq!(seen(&actions, "intent"), ["install", "update"]);
    assert!(apps
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["activeActionState"].is_null()));
}

#[test]
fn native_errors_match_the_golden_payloads() {
    let errors = [
        Error::offline("unable to reach the service"),
        Error::session_expired("sign-in was superseded"),
        Error::authorization("account lacks required access"),
        Error::device_match_failed(
            "device evidence did not identify exactly one assigned Windows device",
        ),
        Error::server("unexpected response"),
        Error::support("unable to create support bundle"),
        Error::unknown("something else"),
    ];
    let fixtures = fixture("NativeErrors");
    assert_eq!(fixtures.as_array().unwrap().len(), errors.len());
    let mut codes = Vec::new();
    for (error, expected) in errors.into_iter().zip(fixtures.as_array().unwrap()) {
        let error: NativeError = native_error(error);
        assert_eq!(&serde_json::to_value(&error).unwrap(), expected);
        codes.push(error.code);
    }
    codes.sort();
    codes.dedup();
    let contract: Value =
        serde_json::from_str(include_str!("../../../native-contract.json")).unwrap();
    let mut listed: Vec<_> = contract["nativeErrorCodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|code| code.as_str().unwrap().to_string())
        .collect();
    listed.sort();
    assert_eq!(codes, listed);
}

#[test]
fn catalog_view_values_match_the_golden_list() {
    assert_wire(
        [wire::CatalogView::Apps, wire::CatalogView::Updates],
        "CatalogViews",
    );
}

#[test]
fn request_fixtures_deserialize_and_reject_unknown_fields() {
    let connect: wire::ConnectRequest = serde_json::from_value(fixture("ConnectRequest")).unwrap();
    assert!(matches!(
        connect,
        wire::ConnectRequest::PersonalToken { relution_username, access_token }
            if relution_username == "ada" && access_token == "example-token"
    ));
    assert!(
        serde_json::from_value::<wire::ConnectRequest>(with_extra_field("ConnectRequest")).is_err()
    );
    let load: wire::LoadCatalogRequest =
        serde_json::from_value(fixture("LoadCatalogRequest")).unwrap();
    assert_eq!(load.view, wire::CatalogView::Updates);
    assert!(load.force_refresh);
    assert!(
        serde_json::from_value::<wire::LoadCatalogRequest>(with_extra_field("LoadCatalogRequest"))
            .is_err()
    );
}
