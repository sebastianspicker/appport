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
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::{
            Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS},
            System::Registry::{
                RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
            },
        },
    };

    let accounts = wide(r"SOFTWARE\Microsoft\Provisioning\OMADM\Accounts");
    let mut root = HKEY::default();
    if unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(accounts.as_ptr()),
            None,
            KEY_READ,
            &mut root,
        )
    } != ERROR_SUCCESS
    {
        return None;
    }

    let mut result = None;
    for index in 0..128 {
        let mut name = [0_u16; 256];
        let mut length = name.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                root,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut length,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status != ERROR_SUCCESS {
            continue;
        }
        let account = String::from_utf16_lossy(&name[..length as usize]);
        let path = format!(r"SOFTWARE\Microsoft\Provisioning\OMADM\Accounts\{account}");
        if let Some(value) = registry_string(&path, "EntDMID") {
            if result.is_some() && result.as_ref() != Some(&value) {
                result = None;
                break;
            }
            result = Some(value);
        }
    }
    unsafe {
        let _ = RegCloseKey(root);
    }
    result
}

#[cfg(not(windows))]
fn ent_dmid() -> Option<String> {
    None
}

#[cfg(windows)]
fn registry_string(key: &str, value: &str) -> Option<String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
        },
    };
    let key = wide(key);
    let value = wide(value);
    unsafe {
        let mut length = 0_u32;
        if RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut length),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        let mut output = vec![0_u16; length as usize / 2];
        if RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(output.as_mut_ptr().cast()),
            Some(&mut length),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        String::from_utf16(&output)
            .ok()
            .map(|result| result.trim_matches('\0').trim().to_owned())
            .filter(|result| !result.is_empty())
    }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

#[cfg(windows)]
fn firmware() -> (Option<String>, Option<String>) {
    use windows::Win32::System::SystemInformation::GetSystemFirmwareTable;
    unsafe {
        let provider = u32::from_le_bytes(*b"RSMB");
        let size = GetSystemFirmwareTable(provider, 0, None, 0);
        if size == 0 {
            return (None, None);
        }
        let mut buffer = vec![0_u8; size as usize];
        if GetSystemFirmwareTable(provider, 0, Some(buffer.as_mut_ptr().cast()), size) != size {
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
        if length < 4 || offset + length > raw.len() {
            break;
        }
        let strings_offset = offset + length;
        let mut end = strings_offset;
        while end + 1 < raw.len() && !(raw[end] == 0 && raw[end + 1] == 0) {
            end += 1;
        }
        if end + 1 >= raw.len() {
            break;
        }
        if kind == 1 {
            let serial = raw
                .get(offset + 7)
                .and_then(|index| smbios_string(raw, strings_offset, *index, end));
            let uuid = raw.get(offset + 8..offset + 24).and_then(|bytes| {
                if bytes.iter().all(|value| *value == 0 || *value == 255) {
                    None
                } else {
                    Some(format!(
                        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
                        bytes[3],
                        bytes[2],
                        bytes[1],
                        bytes[0],
                        bytes[5],
                        bytes[4],
                        bytes[7],
                        bytes[6],
                        bytes[8],
                        bytes[9],
                        bytes[10],
                        bytes[11],
                        bytes[12],
                        bytes[13],
                        bytes[14],
                        bytes[15]
                    ))
                }
            });
            return (uuid, serial);
        }
        offset = end + 2;
    }
    (None, None)
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
