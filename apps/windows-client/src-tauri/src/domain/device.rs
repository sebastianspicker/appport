//! Pure matching of local device evidence to assigned devices.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvidence {
    pub version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ent_dmid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smbios_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bios_serial: Option<String>,
    pub hostname: String,
}

#[derive(Clone, Debug)]
pub struct AssignedDevice {
    pub uuid: String,
    pub device_id: Option<String>,
    pub name: String,
    pub status: String,
    pub platform: String,
    pub user_uuid: String,
    pub organization_uuid: String,
    pub serial_number: Option<String>,
}

pub fn match_device(
    evidence: &DeviceEvidence,
    devices: &[AssignedDevice],
) -> Result<AssignedDevice, String> {
    let signature = evidence
        .ent_dmid
        .as_deref()
        .or(evidence.smbios_uuid.as_deref());
    let matches: Vec<_> = devices
        .iter()
        .filter(|device| {
            signature.is_some_and(|value| {
                device
                    .device_id
                    .as_deref()
                    .is_some_and(|candidate| same_evidence_value(candidate, value))
            }) || evidence.bios_serial.as_deref().is_some_and(|serial| {
                device
                    .serial_number
                    .as_deref()
                    .is_some_and(|candidate| same_evidence_value(candidate, serial))
                    && same_evidence_value(&device.name, &evidence.hostname)
            })
        })
        .collect();
    if matches.len() == 1 {
        Ok(matches[0].clone())
    } else {
        Err("device_match_failed: device evidence did not identify exactly one assigned Windows device".into())
    }
}

pub fn same_uuid(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

pub fn same_evidence_value(left: &str, right: &str) -> bool {
    let left = left.trim();
    let right = right.trim();
    !left.is_empty() && !right.is_empty() && left.eq_ignore_ascii_case(right)
}
