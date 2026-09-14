//! Bounded, non-sensitive Windows platform data for support bundles.
//!
//! This module deliberately never returns local interface addresses.  A matched
//! Relution address is remote service data supplied by the caller instead.

use serde::Serialize;
use std::net::IpAddr;

#[cfg(any(test, windows))]
use super::support_smbios::parse_smbios_type1;
#[cfg(windows)]
use super::support_smbios::{SmbiosType1, MAX_SMBIOS_BYTES};

pub(crate) const MAX_NETWORK_ADAPTERS: usize = 16;
#[cfg(windows)]
const MAX_IP_HELPER_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformCollectorData {
    pub windows_display: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub smbios_serial: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkAdapterSummary {
    pub name: String,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkSummary {
    pub status: String,
    pub adapters: Vec<NetworkAdapterSummary>,
    pub local_addresses_included: bool,
    pub warnings: Vec<String>,
}

pub(crate) fn format_windows_release(
    display_version: Option<&str>,
    build: Option<&str>,
    ubr: Option<u32>,
) -> String {
    let version = display_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(32).collect::<String>())
        .unwrap_or_else(|| "unknown".into());
    let build = build
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 16
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .unwrap_or("unknown");
    match ubr {
        Some(ubr) if build != "unknown" && !build.is_empty() => {
            format!("{version} (10.0.{build}.{ubr})")
        }
        _ if build != "unknown" && !build.is_empty() => format!("{version} (10.0.{build})"),
        _ => version.to_owned(),
    }
}

pub(crate) fn bounded_network_summary(
    adapters: impl IntoIterator<Item = NetworkAdapterSummary>,
) -> NetworkSummary {
    let mut adapters = adapters
        .into_iter()
        .take(MAX_NETWORK_ADAPTERS)
        .collect::<Vec<_>>();
    for adapter in &mut adapters {
        adapter.name = adapter.name.chars().take(128).collect();
        adapter.status = adapter.status.chars().take(32).collect();
    }
    NetworkSummary {
        status: if adapters.is_empty() {
            "unavailable"
        } else {
            "available"
        }
        .to_owned(),
        adapters,
        local_addresses_included: false,
        warnings: Vec::new(),
    }
}

pub(crate) fn validate_matched_relution_ip(
    value: Option<&str>,
) -> Result<Option<String>, &'static str> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let parsed = value
        .parse::<IpAddr>()
        .map_err(|_| "relution_last_ip_invalid")?;
    if parsed.is_unspecified() || parsed.is_multicast() || parsed.is_loopback() {
        return Err("relution_last_ip_invalid");
    }
    Ok(Some(parsed.to_string()))
}

#[cfg(windows)]
pub(crate) fn collect_platform_data() -> PlatformCollectorData {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let mut warnings = Vec::new();
    let registry = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let (display, build, ubr) = match registry {
        Ok(key) => (
            key.get_value::<String, _>("DisplayVersion").ok(),
            key.get_value::<String, _>("CurrentBuildNumber").ok(),
            key.get_value::<u32, _>("UBR").ok(),
        ),
        Err(_) => {
            warnings.push("windows_registry_unavailable".to_owned());
            (None, None, None)
        }
    };
    let smbios = read_smbios_type1().unwrap_or_else(|warning| {
        warnings.push(warning.to_owned());
        SmbiosType1::default()
    });
    PlatformCollectorData {
        windows_display: format_windows_release(display.as_deref(), build.as_deref(), ubr),
        manufacturer: smbios.manufacturer,
        model: smbios.model,
        smbios_serial: smbios.serial,
        warnings,
    }
}

#[cfg(windows)]
fn read_smbios_type1() -> Result<SmbiosType1, &'static str> {
    use windows::Win32::System::SystemInformation::{
        GetSystemFirmwareTable, FIRMWARE_TABLE_PROVIDER,
    };
    let provider = FIRMWARE_TABLE_PROVIDER(u32::from_be_bytes(*b"RSMB"));
    let size = unsafe { GetSystemFirmwareTable(provider, 0, None) } as usize;
    if size < 9 || size > MAX_SMBIOS_BYTES + 8 {
        return Err("smbios_unavailable");
    }
    let mut raw = vec![0_u8; size];
    let received = unsafe { GetSystemFirmwareTable(provider, 0, Some(&mut raw)) } as usize;
    if received != size {
        return Err("smbios_unavailable");
    }
    parse_smbios_type1(&raw[8..])
}

#[cfg(not(windows))]
pub(crate) fn collect_platform_data() -> PlatformCollectorData {
    PlatformCollectorData {
        windows_display: "unsupported".to_owned(),
        manufacturer: None,
        model: None,
        smbios_serial: None,
        warnings: vec!["windows_collectors_unsupported".to_owned()],
    }
}

#[cfg(windows)]
pub(crate) fn collect_network_summary() -> NetworkSummary {
    match native_adapter_summaries() {
        Ok((adapters, truncated)) => {
            let mut summary = bounded_network_summary(adapters);
            if truncated {
                summary.warnings.push("network_adapter_limit".to_owned());
            }
            summary
        }
        Err(warning) => NetworkSummary {
            status: "unavailable".to_owned(),
            adapters: Vec::new(),
            local_addresses_included: false,
            warnings: vec![warning.to_owned()],
        },
    }
}

#[cfg(windows)]
fn native_adapter_summaries() -> Result<(Vec<NetworkAdapterSummary>, bool), &'static str> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, GAA_FLAG_SKIP_UNICAST, IP_ADAPTER_ADDRESSES_LH,
    };

    const ERROR_BUFFER_OVERFLOW: u32 = 111;
    let flags = GAA_FLAG_SKIP_UNICAST
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size = 16 * 1024_u32;
    for _ in 0..3 {
        if size as usize > MAX_IP_HELPER_BYTES {
            return Err("network_buffer_too_large");
        }
        let mut buffer = adapter_buffer(size)?;
        let status = unsafe {
            GetAdaptersAddresses(
                0,
                flags,
                None,
                Some(buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>()),
                &mut size,
            )
        };
        if status == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if status != 0 {
            return Err("network_ip_helper_unavailable");
        }
        return collect_native_adapters(&mut buffer);
    }
    Err("network_ip_helper_unavailable")
}

#[cfg(windows)]
fn adapter_buffer(size: u32) -> Result<Vec<usize>, &'static str> {
    let word_bytes = std::mem::size_of::<usize>();
    let words = (size as usize)
        .checked_add(word_bytes - 1)
        .ok_or("network_buffer_too_large")?
        / word_bytes;
    Ok(vec![0_usize; words])
}

#[cfg(windows)]
fn collect_native_adapters(
    buffer: &mut [usize],
) -> Result<(Vec<NetworkAdapterSummary>, bool), &'static str> {
    use windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_ADDRESSES_LH;

    let start = buffer.as_ptr() as usize;
    let end = start
        .checked_add(std::mem::size_of_val(buffer))
        .ok_or("network_ip_helper_unavailable")?;
    let mut current = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
    let mut adapters = Vec::new();
    while !current.is_null() && adapters.len() < MAX_NETWORK_ADAPTERS {
        if !valid_adapter_pointer(current, start, end) {
            return Err("network_ip_helper_malformed");
        }
        let adapter = unsafe { &*current };
        adapters.push(NetworkAdapterSummary {
            name: bounded_wide_string(adapter.FriendlyName.0, start, end, 128),
            status: adapter_status(adapter.OperStatus.0),
        });
        current = adapter.Next;
    }
    Ok((adapters, !current.is_null()))
}

#[cfg(windows)]
fn valid_adapter_pointer(
    pointer: *mut windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_ADDRESSES_LH,
    start: usize,
    end: usize,
) -> bool {
    use windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_ADDRESSES_LH;

    let address = pointer as usize;
    address % std::mem::align_of::<IP_ADAPTER_ADDRESSES_LH>() == 0
        && address >= start
        && address
            .checked_add(std::mem::size_of::<IP_ADAPTER_ADDRESSES_LH>())
            .is_some_and(|value| value <= end)
}

#[cfg(windows)]
fn adapter_status(status: i32) -> String {
    if status == 1 { "up" } else { "down" }.to_owned()
}

#[cfg(windows)]
fn bounded_wide_string(pointer: *mut u16, start: usize, end: usize, max_units: usize) -> String {
    if pointer.is_null() {
        return "unnamed".to_owned();
    }
    let address = pointer as usize;
    if address % std::mem::align_of::<u16>() != 0 || address < start || address >= end {
        return "unnamed".to_owned();
    }
    let mut units = Vec::with_capacity(max_units);
    for offset in 0..max_units {
        let Some(unit_address) = address.checked_add(offset * std::mem::size_of::<u16>()) else {
            break;
        };
        if unit_address + std::mem::size_of::<u16>() > end {
            break;
        }
        let unit = unsafe { *pointer.add(offset) };
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    let value = String::from_utf16_lossy(&units);
    (!value.trim().is_empty())
        .then_some(value)
        .unwrap_or_else(|| "unnamed".to_owned())
}

#[cfg(not(windows))]
pub(crate) fn collect_network_summary() -> NetworkSummary {
    NetworkSummary {
        status: "unavailable".to_owned(),
        adapters: Vec::new(),
        local_addresses_included: false,
        warnings: vec!["network_collectors_unsupported".to_owned()],
    }
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_network_summary, collect_network_summary, collect_platform_data,
        format_windows_release, parse_smbios_type1, validate_matched_relution_ip,
        NetworkAdapterSummary, MAX_NETWORK_ADAPTERS,
    };

    #[test]
    fn formats_windows_release() {
        assert_eq!(
            format_windows_release(Some("25H2"), Some("26200"), Some(8973)),
            "25H2 (10.0.26200.8973)"
        );
    }

    #[test]
    fn parses_valid_type_one() {
        let mut bytes = vec![1, 24, 0, 0, 1, 2, 0, 3];
        bytes.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        bytes.extend_from_slice(b"Contoso\0Model X\0SN-42\0\0");
        let parsed = parse_smbios_type1(&bytes).unwrap();
        assert_eq!(parsed.manufacturer.as_deref(), Some("Contoso"));
        assert_eq!(parsed.model.as_deref(), Some("Model X"));
        assert_eq!(parsed.serial.as_deref(), Some("SN-42"));
        assert_eq!(
            parsed.uuid.as_deref(),
            Some("04030201-0605-0807-090A-0B0C0D0E0F10")
        );
    }

    #[test]
    fn rejects_malformed_and_truncated_smbios() {
        assert_eq!(
            parse_smbios_type1(&[1, 24, 0, 0]).unwrap_err(),
            "smbios_malformed"
        );
        assert_eq!(
            parse_smbios_type1(&[1, 8, 0, 0, 1, 2, 0, 3, b'x']).unwrap_err(),
            "smbios_malformed"
        );
    }

    #[test]
    fn bounds_network_and_excludes_addresses() {
        let summary = bounded_network_summary((0..20).map(|index| NetworkAdapterSummary {
            name: format!("adapter-{index}"),
            status: "up".into(),
        }));
        assert_eq!(summary.adapters.len(), MAX_NETWORK_ADAPTERS);
        assert!(!summary.local_addresses_included);
    }

    #[test]
    fn validates_remote_relution_ip() {
        assert_eq!(validate_matched_relution_ip(None).unwrap(), None);
        assert_eq!(
            validate_matched_relution_ip(Some("192.0.2.4"))
                .unwrap()
                .as_deref(),
            Some("192.0.2.4")
        );
        assert_eq!(
            validate_matched_relution_ip(Some("not-an-ip")).unwrap_err(),
            "relution_last_ip_invalid"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_collectors_are_stable() {
        assert_eq!(collect_platform_data().windows_display, "unsupported");
        assert_eq!(collect_network_summary().status, "unavailable");
    }
}
