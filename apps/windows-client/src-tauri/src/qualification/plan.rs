use crate::build_config::validate_uuid;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionFixture {
    pub application_uuid: String,
    pub version_uuid: String,
    pub expected_version: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnauthorizedFixture {
    pub application_uuid: String,
    pub version_uuid: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualificationPlan {
    pub schema_version: u8,
    pub disposable_device_uuid: String,
    pub cleanup_owner: String,
    pub install: ActionFixture,
    pub update: ActionFixture,
    pub unauthorized: UnauthorizedFixture,
}

impl QualificationPlan {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let plan: Self = serde_json::from_slice(bytes)
            .map_err(|_| "qualification plan must be valid strict JSON".to_owned())?;
        plan.validate()?;
        Ok(plan)
    }

    fn validate(&self) -> Result<(), String> {
        self.validate_schema_version()?;
        self.validate_identifiers()?;
        self.validate_required_text()?;
        self.validate_distinct_applications()
    }

    fn validate_schema_version(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("qualification plan schemaVersion must be 1".into());
        }
        Ok(())
    }

    fn validate_identifiers(&self) -> Result<(), String> {
        for value in [
            &self.disposable_device_uuid,
            &self.install.application_uuid,
            &self.install.version_uuid,
            &self.update.application_uuid,
            &self.update.version_uuid,
            &self.unauthorized.application_uuid,
            &self.unauthorized.version_uuid,
        ] {
            validate_uuid(value).map_err(str::to_owned)?;
        }
        Ok(())
    }

    fn validate_required_text(&self) -> Result<(), String> {
        if self.cleanup_owner.trim().is_empty() {
            return Err("qualification plan ownership and expected versions are required".into());
        }
        if self.cleanup_owner.len() > 200 {
            return Err("qualification plan ownership and expected versions are required".into());
        }
        self.validate_expected_version(&self.install.expected_version)?;
        self.validate_expected_version(&self.update.expected_version)
    }

    fn validate_expected_version(&self, expected_version: &str) -> Result<(), String> {
        if expected_version.trim().is_empty() {
            return Err("qualification plan ownership and expected versions are required".into());
        }
        Ok(())
    }

    fn validate_distinct_applications(&self) -> Result<(), String> {
        self.validate_distinct_application_pair(
            &self.install.application_uuid,
            &self.update.application_uuid,
        )?;
        self.validate_distinct_application_pair(
            &self.unauthorized.application_uuid,
            &self.install.application_uuid,
        )?;
        self.validate_distinct_application_pair(
            &self.unauthorized.application_uuid,
            &self.update.application_uuid,
        )
    }

    fn validate_distinct_application_pair(&self, left: &str, right: &str) -> Result<(), String> {
        if left.eq_ignore_ascii_case(right) {
            return Err("qualification fixtures must use distinct applications".into());
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(serde_json::to_vec(self).unwrap_or_default());
        format!("{:x}", hash.finalize())
    }
}

impl Serialize for QualificationPlan {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("QualificationPlan", 6)?;
        state.serialize_field("schemaVersion", &self.schema_version)?;
        state.serialize_field(
            "disposableDeviceSha256",
            &digest(&self.disposable_device_uuid),
        )?;
        state.serialize_field("cleanupOwnerSha256", &digest(&self.cleanup_owner))?;
        state.serialize_field("install", &RedactedFixture::from(&self.install))?;
        state.serialize_field("update", &RedactedFixture::from(&self.update))?;
        state.serialize_field(
            "unauthorized",
            &RedactedUnauthorized::from(&self.unauthorized),
        )?;
        state.end()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedFixture {
    application_sha256: String,
    version_sha256: String,
    expected_version_sha256: String,
}

impl From<&ActionFixture> for RedactedFixture {
    fn from(value: &ActionFixture) -> Self {
        Self {
            application_sha256: digest(&value.application_uuid),
            version_sha256: digest(&value.version_uuid),
            expected_version_sha256: digest(&value.expected_version),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactedUnauthorized {
    application_sha256: String,
    version_sha256: String,
}

impl From<&UnauthorizedFixture> for RedactedUnauthorized {
    fn from(value: &UnauthorizedFixture) -> Self {
        Self {
            application_sha256: digest(&value.application_uuid),
            version_sha256: digest(&value.version_uuid),
        }
    }
}

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::QualificationPlan;

    const UUIDS: [&str; 7] = [
        "10000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
        "30000000-0000-4000-8000-000000000003",
        "40000000-0000-4000-8000-000000000004",
        "50000000-0000-4000-8000-000000000005",
        "60000000-0000-4000-8000-000000000006",
        "70000000-0000-4000-8000-000000000007",
    ];
    const REDACTED_PLAN: &str = r#"{"schemaVersion":1,"disposableDeviceSha256":"576f18824476444ff24bae34d68eafc7ad5576c4c6df591e96d025e930fadfeb","cleanupOwnerSha256":"8c5de5251ad78571b013d2ea2d3748f6072f6aa2ae507cdf164f017a96561342","install":{"applicationSha256":"951c747b3afcabb3d518a5da732894760c9ce2da6faa6cdc13c7e3ca5ae5bebd","versionSha256":"b62b874557d643b96ea7ed3eec66f489ef559979294adc6816bd7460e8c3401a","expectedVersionSha256":"d0ff5974b6aa52cf562bea5921840c032a860a91a3512f7fe8f768f6bbe005f6"},"update":{"applicationSha256":"131f2cfdc8090b5cd61056530ba733065b5034a821540087f5a9422f6f5fb9eb","versionSha256":"342ace7df588b4b741e10d57aeab9d9a79dab7cc931ddc50204c5bf381c96415","expectedVersionSha256":"d84bdb34d4eeef4034d77e5403f850e35bc4a51b1143e3a83510e1aaad839748"},"unauthorized":{"applicationSha256":"f6c057d8678575cacce75205c5417f46841c4bf3f801c871d80e50337fcaf56c","versionSha256":"5ad6ed01a14379a8a778f149588ac7f3bd0bfc9bc424ec8df68ba69e3ba9c66b"}}"#;
    const PLAN_FINGERPRINT: &str =
        "650684135b79b1686c80cde40a3ce2302b7f01262d6cfd7de09ae98a669d9594";

    fn plan_json() -> String {
        format!(
            r#"{{"schemaVersion":1,"disposableDeviceUuid":"{}","cleanupOwner":"tenant fixture team","install":{{"applicationUuid":"{}","versionUuid":"{}","expectedVersion":"1.0"}},"update":{{"applicationUuid":"{}","versionUuid":"{}","expectedVersion":"2.0"}},"unauthorized":{{"applicationUuid":"{}","versionUuid":"{}"}}}}"#,
            UUIDS[0], UUIDS[1], UUIDS[2], UUIDS[3], UUIDS[4], UUIDS[5], UUIDS[6]
        )
    }

    #[test]
    fn validates_and_redacts_qualification_plan() {
        let plan = QualificationPlan::parse(plan_json().as_bytes()).unwrap();
        let serialized = serde_json::to_string(&plan).unwrap();
        for value in UUIDS
            .into_iter()
            .chain(["tenant fixture team", "1.0", "2.0"])
        {
            assert!(!serialized.contains(value));
        }
        assert_eq!(serialized, REDACTED_PLAN);
        assert_eq!(plan.fingerprint(), PLAN_FINGERPRINT);
    }

    #[test]
    fn plan_rejects_unsupported_schema_versions() {
        let unsupported = plan_json().replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        assert_eq!(
            QualificationPlan::parse(unsupported.as_bytes()).unwrap_err(),
            "qualification plan schemaVersion must be 1"
        );
    }

    #[test]
    fn plan_rejects_invalid_identifiers() {
        for identifier in UUIDS {
            let invalid = plan_json().replace(identifier, "not-a-uuid");
            assert_eq!(
                QualificationPlan::parse(invalid.as_bytes()).unwrap_err(),
                "must be a canonical UUID"
            );
        }
    }

    #[test]
    fn plan_rejects_nil_and_repeated_placeholder_identifiers() {
        for placeholder in [
            "00000000-0000-0000-0000-000000000000",
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        ] {
            let invalid = plan_json().replace(UUIDS[0], placeholder);
            assert_eq!(
                QualificationPlan::parse(invalid.as_bytes()).unwrap_err(),
                "must not be a nil or repeated placeholder UUID"
            );
        }
    }

    #[test]
    fn plan_rejects_missing_or_overlong_ownership_and_expected_versions() {
        let whitespace_owner = plan_json().replace("tenant fixture team", "   ");
        let overlong_owner = plan_json().replace("tenant fixture team", &"x".repeat(201));
        let blank_expected_version =
            plan_json().replace("\"expectedVersion\":\"1.0\"", "\"expectedVersion\":\" \"");

        for invalid in [whitespace_owner, overlong_owner, blank_expected_version] {
            assert_eq!(
                QualificationPlan::parse(invalid.as_bytes()).unwrap_err(),
                "qualification plan ownership and expected versions are required"
            );
        }
    }

    #[test]
    fn plan_rejects_every_application_uuid_collision() {
        for (reused, original) in [
            (UUIDS[3], UUIDS[1]),
            (UUIDS[5], UUIDS[1]),
            (UUIDS[5], UUIDS[3]),
        ] {
            let invalid = plan_json().replace(reused, original);
            assert_eq!(
                QualificationPlan::parse(invalid.as_bytes()).unwrap_err(),
                "qualification fixtures must use distinct applications"
            );
        }
        let case_insensitive_collision =
            plan_json().replace(UUIDS[3], &UUIDS[1].to_ascii_uppercase());
        assert_eq!(
            QualificationPlan::parse(case_insensitive_collision.as_bytes()).unwrap_err(),
            "qualification fixtures must use distinct applications"
        );
    }

    #[test]
    fn plan_rejects_unknown_secret_shaped_fields_in_all_fixture_types() {
        let with_token = plan_json().replace(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"accessToken\":\"secret\"",
        );
        assert!(QualificationPlan::parse(with_token.as_bytes()).is_err());
        let nested_secret = plan_json().replace(
            "\"expectedVersion\":\"1.0\"",
            "\"expectedVersion\":\"1.0\",\"clientSecret\":\"secret\"",
        );
        assert!(QualificationPlan::parse(nested_secret.as_bytes()).is_err());
        let unauthorized_secret = plan_json().replace(
            "\"unauthorized\":{\"applicationUuid\":",
            "\"unauthorized\":{\"accessToken\":\"secret\",\"applicationUuid\":",
        );
        assert!(QualificationPlan::parse(unauthorized_secret.as_bytes()).is_err());
    }
}
