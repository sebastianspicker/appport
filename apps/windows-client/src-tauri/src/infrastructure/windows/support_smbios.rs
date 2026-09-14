//! Bounded parsing for the SMBIOS type-one support record.

use serde::Serialize;

pub(crate) const MAX_SMBIOS_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SmbiosType1 {
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub uuid: Option<String>,
}

/// Parses the SMBIOS table payload, not the eight-byte RawSMBIOSData header.
pub(crate) fn parse_smbios_type1(table: &[u8]) -> Result<SmbiosType1, &'static str> {
    if table.len() > MAX_SMBIOS_BYTES {
        return Err("smbios_too_large");
    }
    let mut offset = 0;
    while offset < table.len() {
        let structure = smbios_structure(table, offset)?;
        if structure.structure_type == 1 {
            return parse_type1_structure(table, &structure);
        }
        offset = structure.strings_end;
        if structure.structure_type == 127 {
            break;
        }
    }
    Err("smbios_type1_unavailable")
}

struct SmbiosStructure<'a> {
    structure_type: u8,
    formatted: &'a [u8],
    strings_start: usize,
    strings_end: usize,
}

fn smbios_structure(table: &[u8], offset: usize) -> Result<SmbiosStructure<'_>, &'static str> {
    if table.len() - offset < 4 {
        return Err("smbios_malformed");
    }
    let formatted_len = table[offset + 1] as usize;
    if formatted_len < 4 || formatted_len > table.len() - offset {
        return Err("smbios_malformed");
    }
    let strings_start = offset + formatted_len;
    let strings_end = string_set_end(table, strings_start).ok_or("smbios_malformed")?;
    Ok(SmbiosStructure {
        structure_type: table[offset],
        formatted: &table[offset..strings_start],
        strings_start,
        strings_end,
    })
}

fn parse_type1_structure(
    table: &[u8],
    structure: &SmbiosStructure<'_>,
) -> Result<SmbiosType1, &'static str> {
    if structure.formatted.len() < 8 {
        return Err("smbios_malformed");
    }
    Ok(SmbiosType1 {
        manufacturer: smbios_string(table, structure, 4),
        model: smbios_string(table, structure, 5),
        serial: smbios_string(table, structure, 7),
        uuid: structure.formatted.get(8..24).and_then(|value| {
            (!value.iter().all(|byte| *byte == 0 || *byte == 0xff)).then(|| format_uuid(value))
        }),
    })
}

fn string_set_end(table: &[u8], start: usize) -> Option<usize> {
    let mut cursor = start;
    while cursor + 1 < table.len() {
        if table[cursor] == 0 && table[cursor + 1] == 0 {
            return Some(cursor + 2);
        }
        cursor += 1;
    }
    None
}

fn smbios_string(table: &[u8], structure: &SmbiosStructure<'_>, index: usize) -> Option<String> {
    let string_index = structure.formatted[index];
    if string_index == 0 {
        return None;
    }
    table[structure.strings_start..structure.strings_end.saturating_sub(1)]
        .split(|byte| *byte == 0)
        .nth(string_index.saturating_sub(1) as usize)
        .and_then(|value| std::str::from_utf8(value).ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(256).collect())
}

fn format_uuid(bytes: &[u8]) -> String {
    // SMBIOS stores the first UUID fields little-endian in the common modern form.
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        bytes[3], bytes[2], bytes[1], bytes[0], bytes[5], bytes[4], bytes[7], bytes[6],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}
