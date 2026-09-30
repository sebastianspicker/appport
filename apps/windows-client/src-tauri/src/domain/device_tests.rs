use super::{match_device, same_evidence_value, same_uuid, AssignedDevice, DeviceEvidence};
use crate::error::Error;

fn evidence() -> DeviceEvidence {
    DeviceEvidence {
        version: 1,
        ent_dmid: None,
        smbios_uuid: None,
        bios_serial: None,
        hostname: "HOST-1".into(),
    }
}

fn device(uuid: &str) -> AssignedDevice {
    AssignedDevice {
        uuid: uuid.into(),
        device_id: None,
        name: "HOST-1".into(),
        status: "COMPLIANT".into(),
        platform: "WINDOWS".into(),
        user_uuid: "user".into(),
        organization_uuid: "org".into(),
        serial_number: None,
    }
}

fn with_id(uuid: &str, id: &str) -> AssignedDevice {
    AssignedDevice {
        device_id: Some(id.into()),
        ..device(uuid)
    }
}

fn with_serial(uuid: &str, name: &str, serial: &str) -> AssignedDevice {
    AssignedDevice {
        name: name.into(),
        serial_number: Some(serial.into()),
        ..device(uuid)
    }
}

fn matched(evidence: &DeviceEvidence, devices: &[AssignedDevice]) -> Option<String> {
    match_device(evidence, devices).ok().map(|d| d.uuid)
}

#[test]
fn no_devices_or_no_evidence_fails_closed() {
    let mut by_id = evidence();
    by_id.ent_dmid = Some("ID-1".into());
    assert_eq!(matched(&by_id, &[]), None);
    assert_eq!(matched(&evidence(), &[with_id("a", "ID-1")]), None);
    let error = match_device(&evidence(), &[]).unwrap_err();
    assert_eq!(
        error,
        Error::device_match_failed(
            "device evidence did not identify exactly one assigned Windows device"
        )
    );
}

#[test]
fn exactly_one_identifier_match_is_selected_case_insensitively() {
    let mut by_id = evidence();
    by_id.ent_dmid = Some(" id-1 ".into());
    let devices = [with_id("a", "other"), with_id("b", "ID-1"), device("c")];
    assert_eq!(matched(&by_id, &devices), Some("b".into()));
}

#[test]
fn multiple_identifier_matches_are_ambiguous() {
    let mut by_id = evidence();
    by_id.ent_dmid = Some("ID-1".into());
    let devices = [with_id("a", "ID-1"), with_id("b", "id-1")];
    assert_eq!(matched(&by_id, &devices), None);
}

#[test]
fn ent_dmid_takes_precedence_over_smbios_uuid_without_fallback() {
    let mut both = evidence();
    both.ent_dmid = Some("ENT".into());
    both.smbios_uuid = Some("SMBIOS".into());
    let devices = [with_id("a", "SMBIOS")];
    // characterization: current behavior
    assert_eq!(matched(&both, &devices), None);
    both.ent_dmid = None;
    assert_eq!(matched(&both, &devices), Some("a".into()));
}

#[test]
fn serial_match_requires_matching_hostname() {
    let mut by_serial = evidence();
    by_serial.bios_serial = Some("SN-1".into());
    assert_eq!(
        matched(&by_serial, &[with_serial("a", "host-1", "sn-1")]),
        Some("a".into())
    );
    assert_eq!(
        matched(&by_serial, &[with_serial("a", "OTHER", "SN-1")]),
        None
    );
    assert_eq!(
        matched(&by_serial, &[with_serial("a", "HOST-1", "SN-2")]),
        None
    );
}

#[test]
fn identifier_and_serial_paths_on_two_devices_are_ambiguous() {
    let mut both = evidence();
    both.ent_dmid = Some("ID-1".into());
    both.bios_serial = Some("SN-1".into());
    let devices = [with_id("a", "ID-1"), with_serial("b", "HOST-1", "SN-1")];
    assert_eq!(matched(&both, &devices), None);
}

#[test]
fn one_device_matching_both_paths_counts_once() {
    let mut both = evidence();
    both.ent_dmid = Some("ID-1".into());
    both.bios_serial = Some("SN-1".into());
    let mut single = with_serial("a", "HOST-1", "SN-1");
    single.device_id = Some("ID-1".into());
    assert_eq!(matched(&both, &[single]), Some("a".into()));
}

#[test]
fn status_and_platform_do_not_affect_matching() {
    let mut by_id = evidence();
    by_id.ent_dmid = Some("ID-1".into());
    let mut inactive = with_id("a", "ID-1");
    inactive.status = "INACTIVE".into();
    inactive.platform = "ANDROID".into();
    // characterization: current behavior
    assert_eq!(matched(&by_id, &[inactive]), Some("a".into()));
}

#[test]
fn blank_values_never_match() {
    let mut blank = evidence();
    blank.ent_dmid = Some("  ".into());
    blank.bios_serial = Some("".into());
    blank.hostname = "".into();
    let devices = [with_id("a", ""), with_serial("b", "", "")];
    assert_eq!(matched(&blank, &devices), None);
}

#[test]
fn comparison_helpers_are_case_insensitive_and_blank_safe() {
    assert!(same_uuid("ABC", "abc"));
    assert!(!same_uuid(" abc", "abc"));
    assert!(same_evidence_value(" ABC ", "abc"));
    assert!(!same_evidence_value("", ""));
    assert!(!same_evidence_value("  ", "  "));
}

#[test]
fn evidence_serializes_camel_case_and_omits_missing_identifiers() {
    let mut full = evidence();
    full.ent_dmid = Some("ID".into());
    full.smbios_uuid = Some("UUID".into());
    full.bios_serial = Some("SN".into());
    assert_eq!(
        serde_json::to_value(&full).unwrap(),
        serde_json::json!({
            "version": 1, "entDmid": "ID", "smbiosUuid": "UUID",
            "biosSerial": "SN", "hostname": "HOST-1"
        })
    );
    assert_eq!(
        serde_json::to_value(evidence()).unwrap(),
        serde_json::json!({"version": 1, "hostname": "HOST-1"})
    );
}
