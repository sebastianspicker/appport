use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeviceEvidenceV1 {
    pub version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ent_dmid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smbios_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bios_serial: Option<String>,
    pub hostname: String,
}

pub fn collect() -> Result<NativeDeviceEvidenceV1, String> {
    let hostname = hostname().ok_or("device_match_failed: Windows hostname is unavailable")?;
    let (smbios_uuid, bios_serial) = firmware();
    let ent_dmid = ent_dmid();
    if ent_dmid.is_none() && smbios_uuid.is_none() && bios_serial.is_none() {
        return Err("device_match_failed: no stable Windows identifier is available".into());
    }
    Ok(NativeDeviceEvidenceV1 {
        version: 1,
        ent_dmid,
        smbios_uuid,
        bios_serial,
        hostname,
    })
}

fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::env::var("HOSTNAME").ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn ent_dmid() -> Option<String> {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let accounts = machine
        .open_subkey(r"SOFTWARE\Microsoft\Provisioning\OMADM\Accounts")
        .ok()?;
    account_ent_dmid(&accounts)
}

#[cfg(windows)]
fn account_ent_dmid(root: &winreg::RegKey) -> Option<String> {
    let mut result = None;
    for account in root.enum_keys().take(128).flatten() {
        if let Some(value) = root
            .open_subkey(account)
            .ok()
            .and_then(|key| key.get_value::<String, _>("EntDMID").ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
        {
            if result.is_some() && result.as_ref() != Some(&value) {
                return None;
            }
            result = Some(value);
        }
    }
    result
}

#[cfg(not(windows))]
fn ent_dmid() -> Option<String> {
    None
}

#[cfg(windows)]
fn firmware() -> (Option<String>, Option<String>) {
    use windows::Win32::System::SystemInformation::{
        GetSystemFirmwareTable, FIRMWARE_TABLE_PROVIDER,
    };
    unsafe {
        let provider = FIRMWARE_TABLE_PROVIDER(u32::from_le_bytes(*b"RSMB"));
        let size = GetSystemFirmwareTable(provider, 0, None);
        if size == 0 {
            return (None, None);
        }
        let mut buffer = vec![0_u8; size as usize];
        if GetSystemFirmwareTable(provider, 0, Some(&mut buffer)) != size {
            return (None, None);
        }
        parse_raw_smbios(&buffer)
    }
}

#[cfg(not(windows))]
fn firmware() -> (Option<String>, Option<String>) {
    (None, None)
}

pub fn parse_raw_smbios(raw: &[u8]) -> (Option<String>, Option<String>) {
    if raw.len() < 8 {
        return (None, None);
    }
    let mut offset = 8;
    while offset + 4 <= raw.len() {
        let kind = raw[offset];
        let length = raw[offset + 1] as usize;
        let Some((strings_offset, end)) = structure_strings(raw, offset, length) else {
            break;
        };
        if kind == 1 {
            return type_one(raw, offset, strings_offset, end);
        }
        offset = end + 2;
    }
    (None, None)
}

fn structure_strings(raw: &[u8], offset: usize, length: usize) -> Option<(usize, usize)> {
    (length >= 4 && offset + length <= raw.len()).then_some(())?;
    let strings_offset = offset + length;
    let end = raw[strings_offset..]
        .windows(2)
        .position(|bytes| bytes == [0, 0])
        .map(|index| strings_offset + index)?;
    Some((strings_offset, end))
}

fn type_one(
    raw: &[u8],
    offset: usize,
    start: usize,
    end: usize,
) -> (Option<String>, Option<String>) {
    let serial = raw
        .get(offset + 7)
        .and_then(|index| smbios_string(raw, start, *index, end));
    let uuid = raw.get(offset + 8..offset + 24).filter(|bytes| !bytes.iter().all(|value| *value == 0 || *value == 255)).map(|bytes| format!("{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}", bytes[3],bytes[2],bytes[1],bytes[0],bytes[5],bytes[4],bytes[7],bytes[6],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]));
    (uuid, serial)
}

fn smbios_string(raw: &[u8], start: usize, index: u8, end: usize) -> Option<String> {
    if index == 0 {
        return None;
    }
    raw[start..end]
        .split(|byte| *byte == 0)
        .nth(index as usize - 1)
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_type_one_uuid_and_serial() {
        let mut bytes = vec![0; 8];
        bytes.extend([
            1, 0x18, 0, 0, 1, 2, 3, 1, 0x33, 0x22, 0x11, 0, 0x55, 0x44, 0x77, 0x66, 8, 9, 10, 11,
            12, 13, 14, 15,
        ]);
        bytes.extend(b"SERIAL-42\0\0");
        assert_eq!(
            parse_raw_smbios(&bytes),
            (
                Some("00112233-4455-6677-0809-0A0B0C0D0E0F".into()),
                Some("SERIAL-42".into())
            )
        );
    }

    #[test]
    fn rejects_truncated_data() {
        assert_eq!(parse_raw_smbios(&[0; 7]), (None, None));
    }
}
