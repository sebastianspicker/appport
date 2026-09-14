use super::input::{read_bounded_regular, MAX_JSON_BYTES};
use relution_appport_lib::qualification::QualificationBinding;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateEvidence {
    schema_version: u8,
    candidate_ready: bool,
    profile: String,
    writes_enabled: bool,
    repository: CandidateRepository,
    qualification_configuration: CandidateConfiguration,
    windows_artifact: CandidateArtifact,
    qualification_utility: CandidateArtifact,
}

#[derive(Deserialize)]
struct CandidateRepository {
    commit: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateConfiguration {
    fingerprint_sha256: String,
}

#[derive(Deserialize)]
struct CandidateArtifact {
    sha256: String,
}

struct EmbeddedBinding {
    profile: &'static str,
    writes_enabled: bool,
    configuration_fingerprint_sha256: &'static str,
    source_revision: &'static str,
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn load_binding(path: &Path) -> Result<QualificationBinding, String> {
    let evidence = load_candidate_evidence(path)?;
    let embedded = embedded_binding();
    if !evidence.matches(&embedded) {
        return Err("candidate evidence does not match this qualification build".into());
    }
    Ok(QualificationBinding {
        candidate_msi_sha256: evidence.windows_artifact.sha256,
        qualification_utility_sha256: evidence.qualification_utility.sha256,
        configuration_fingerprint_sha256: evidence.qualification_configuration.fingerprint_sha256,
        source_revision: evidence.repository.commit,
    })
}

fn load_candidate_evidence(path: &Path) -> Result<CandidateEvidence, String> {
    serde_json::from_slice(&read_bounded_regular(
        path,
        "candidate evidence",
        MAX_JSON_BYTES,
    )?)
    .map_err(|_| "candidate evidence is invalid JSON".to_owned())
}

fn embedded_binding() -> EmbeddedBinding {
    EmbeddedBinding {
        profile: option_env!("APPPORT_QUALIFICATION_PROFILE").unwrap_or("invalid"),
        writes_enabled: option_env!("APPPORT_RELUTION_WRITES_ENABLED") == Some("true"),
        configuration_fingerprint_sha256: option_env!("APPPORT_CONFIGURATION_FINGERPRINT_SHA256")
            .unwrap_or("invalid"),
        source_revision: option_env!("APPPORT_SOURCE_REVISION").unwrap_or("invalid"),
    }
}

impl CandidateEvidence {
    fn matches(&self, embedded: &EmbeddedBinding) -> bool {
        [
            self.schema_version == 6,
            self.candidate_ready,
            self.profile == embedded.profile,
            self.writes_enabled == embedded.writes_enabled,
            is_sha256(&self.windows_artifact.sha256),
            is_sha256(&self.qualification_configuration.fingerprint_sha256),
            self.qualification_configuration.fingerprint_sha256
                == embedded.configuration_fingerprint_sha256,
            self.repository.commit == embedded.source_revision,
            is_sha256(&self.qualification_utility.sha256),
        ]
        .into_iter()
        .all(|condition| condition)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CandidateArtifact, CandidateConfiguration, CandidateEvidence, CandidateRepository,
        EmbeddedBinding,
    };

    fn matching_candidate_evidence() -> (CandidateEvidence, EmbeddedBinding) {
        let source_revision = "701aa9a";
        let configuration_fingerprint =
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        (
            CandidateEvidence {
                schema_version: 6,
                candidate_ready: true,
                profile: "read_only".into(),
                writes_enabled: false,
                repository: CandidateRepository {
                    commit: source_revision.into(),
                },
                qualification_configuration: CandidateConfiguration {
                    fingerprint_sha256: configuration_fingerprint.into(),
                },
                windows_artifact: CandidateArtifact {
                    sha256: "b".repeat(64),
                },
                qualification_utility: CandidateArtifact {
                    sha256: "d".repeat(64),
                },
            },
            EmbeddedBinding {
                profile: "read_only",
                writes_enabled: false,
                configuration_fingerprint_sha256: configuration_fingerprint,
                source_revision,
            },
        )
    }

    #[test]
    fn candidate_evidence_matches_embedded_build_without_path_self_attestation() {
        let (evidence, embedded) = matching_candidate_evidence();
        assert!(evidence.matches(&embedded));
    }

    #[test]
    fn candidate_evidence_rejects_malformed_or_mismatched_binding_fields() {
        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.qualification_utility.sha256 = "not-a-digest".into();
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.candidate_ready = false;
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.profile = "write_qualification".into();
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.writes_enabled = true;
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.qualification_configuration.fingerprint_sha256 = "e".repeat(64);
        assert!(!evidence.matches(&embedded));

        let (mut evidence, embedded) = matching_candidate_evidence();
        evidence.repository.commit = "other".into();
        assert!(!evidence.matches(&embedded));
    }
}
