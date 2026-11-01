//! Managed Windows device evidence collection.

use crate::domain::device::DeviceEvidence;
use crate::error::Error;

pub fn collect() -> Result<DeviceEvidence, Error> {
    let hostname =
        hostname().ok_or_else(|| Error::device_match_failed("Windows hostname is unavailable"))?;
    let (smbios_uuid, bios_serial) = firmware();
    let ent_dmid = ent_dmid();
    if ent_dmid.is_none() && smbios_uuid.is_none() && bios_serial.is_none() {
        return Err(Error::device_match_failed(
            "no stable Windows identifier is available",
        ));
    }
    Ok(DeviceEvidence {
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
    // Same bounded SMBIOS type-1 reader as the support page, so both report the same PC.
    let smbios = super::support_collectors::read_smbios_type1().unwrap_or_default();
    (smbios.uuid, smbios.serial)
}

#[cfg(not(windows))]
fn firmware() -> (Option<String>, Option<String>) {
    (None, None)
}
