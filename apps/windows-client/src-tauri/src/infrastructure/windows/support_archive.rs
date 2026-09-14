use super::support::SupportError;
use serde::Serialize;
use sha2::{Digest, Sha256};

const BUNDLE_SCHEMA: u32 = 1;
pub(super) const BUNDLE_FILES: [&str; 6] = [
    "support-details.json",
    "catalog-summary.json",
    "network-summary.json",
    "client.log",
    "client.log.1",
    "manifest.json",
];

pub(super) struct ManifestMetadata<'a> {
    pub(super) created_at: &'a str,
    pub(super) app_version: &'a str,
    pub(super) source_revision: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    schema_version: u32,
    created_at: String,
    app_version: String,
    source_revision: String,
    consent: bool,
    warnings: Vec<String>,
    files: Vec<ManifestFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    name: String,
    bytes: usize,
    sha256: String,
}

pub(super) fn manifest_bytes(
    metadata: ManifestMetadata<'_>,
    warnings: &[String],
    files: &[(&str, Vec<u8>)],
) -> Result<Vec<u8>, SupportError> {
    let manifest = BundleManifest {
        schema_version: BUNDLE_SCHEMA,
        created_at: metadata.created_at.to_owned(),
        app_version: metadata.app_version.to_owned(),
        source_revision: metadata.source_revision.to_owned(),
        consent: true,
        warnings: warnings.to_vec(),
        files: files
            .iter()
            .map(|(name, contents)| ManifestFile {
                name: (*name).to_owned(),
                bytes: contents.len(),
                sha256: hex_sha256(contents),
            })
            .collect(),
    };
    serde_json::to_vec_pretty(&manifest).map_err(|_| SupportError::AssemblyFailed)
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn zip_stored(
    files: &[(&str, Vec<u8>)],
    maximum: usize,
) -> Result<Vec<u8>, SupportError> {
    if files.len() != BUNDLE_FILES.len()
        || files
            .iter()
            .enumerate()
            .any(|(index, (name, _))| *name != BUNDLE_FILES[index])
    {
        return Err(SupportError::AssemblyFailed);
    }
    let mut archive = Vec::new();
    let mut central = Vec::new();
    for (name, contents) in files {
        let offset = u32::try_from(archive.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
        let name = name.as_bytes();
        let size = u32::try_from(contents.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
        let crc = crc32(contents);
        append_local_header(&mut archive, name, contents, size, crc);
        append_central_header(&mut central, name, size, crc, offset);
    }
    let central_offset = u32::try_from(archive.len()).map_err(|_| SupportError::ArchiveTooLarge)?;
    archive.extend_from_slice(&central);
    append_end_record(&mut archive, files.len(), central.len(), central_offset);
    if archive.len() > maximum {
        return Err(SupportError::ArchiveTooLarge);
    }
    Ok(archive)
}

fn append_local_header(archive: &mut Vec<u8>, name: &[u8], contents: &[u8], size: u32, crc: u32) {
    put_u32(archive, 0x04034b50);
    put_u16(archive, 20);
    put_u16(archive, 0);
    put_u16(archive, 0);
    put_u16(archive, 0);
    put_u16(archive, 0);
    put_u32(archive, crc);
    put_u32(archive, size);
    put_u32(archive, size);
    put_u16(archive, name.len() as u16);
    put_u16(archive, 0);
    archive.extend_from_slice(name);
    archive.extend_from_slice(contents);
}

fn append_central_header(central: &mut Vec<u8>, name: &[u8], size: u32, crc: u32, offset: u32) {
    put_u32(central, 0x02014b50);
    put_u16(central, 20);
    put_u16(central, 20);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u32(central, crc);
    put_u32(central, size);
    put_u32(central, size);
    put_u16(central, name.len() as u16);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u16(central, 0);
    put_u32(central, 0);
    put_u32(central, offset);
    central.extend_from_slice(name);
}

fn append_end_record(
    archive: &mut Vec<u8>,
    file_count: usize,
    central_size: usize,
    central_offset: u32,
) {
    put_u32(archive, 0x06054b50);
    put_u16(archive, 0);
    put_u16(archive, 0);
    put_u16(archive, file_count as u16);
    put_u16(archive, file_count as u16);
    put_u32(archive, central_size as u32);
    put_u32(archive, central_offset);
    put_u16(archive, 0);
}

fn put_u16(target: &mut Vec<u8>, value: u16) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & (0_u32.wrapping_sub(crc & 1)));
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::{manifest_bytes, zip_stored, ManifestMetadata, BUNDLE_FILES};
    use crate::infrastructure::windows::support::SupportError;

    fn files() -> Vec<(&'static str, Vec<u8>)> {
        BUNDLE_FILES
            .iter()
            .map(|name| (*name, name.as_bytes().to_vec()))
            .collect()
    }

    #[test]
    fn manifest_preserves_file_order_lengths_and_hashes() {
        let files = vec![("first", b"abc".to_vec()), ("second", Vec::new())];
        let bytes = manifest_bytes(
            ManifestMetadata {
                created_at: "2026-08-21T12:00:00Z",
                app_version: "0.1.0",
                source_revision: "abc123",
            },
            &["smbios_unavailable".into()],
            &files,
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let entries = manifest["files"].as_array().unwrap();
        assert_eq!(entries[0]["name"], "first");
        assert_eq!(entries[0]["bytes"], 3);
        assert_eq!(
            entries[0]["sha256"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(entries[1]["name"], "second");
        assert_eq!(entries[1]["bytes"], 0);
    }

    #[test]
    fn stored_archive_requires_the_exact_allowlist_order() {
        let mut files = files();
        files.swap(0, 1);
        assert_eq!(
            zip_stored(&files, usize::MAX).unwrap_err(),
            SupportError::AssemblyFailed
        );
    }

    #[test]
    fn stored_archive_enforces_the_serialized_size_limit() {
        assert_eq!(
            zip_stored(&files(), 21).unwrap_err(),
            SupportError::ArchiveTooLarge
        );
    }
}
