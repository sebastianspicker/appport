use url::Url;

pub const BASE: &str = "APPPORT_RELUTION_API_BASE_URL";
pub const ORGANIZATION: &str = "APPPORT_RELUTION_ORGANIZATION_UUID";
pub const NATIVE_APP: &str = "APPPORT_NATIVE_APP_UUID";
pub const WRITES: &str = "APPPORT_RELUTION_WRITES_ENABLED";
pub const PROFILE: &str = "APPPORT_QUALIFICATION_PROFILE";
pub const TENANT_APPROVED: &str = "APPPORT_QUALIFICATION_TENANT_APPROVED";
pub const TENANT_CLASS: &str = "APPPORT_RELUTION_TENANT_CLASS";
pub const DISPOSABLE_APPROVED: &str = "APPPORT_DISPOSABLE_RESOURCES_APPROVED";
pub const DIAGNOSTICS: &str = "APPPORT_RELUTION_DIAGNOSTICS";

pub fn parse_exact_bool(value: &str) -> Result<bool, &'static str> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err("must be exactly true or false"),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QualificationProfile {
    ReadOnly,
    WriteQualification,
}

impl QualificationProfile {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "read_only" => Ok(Self::ReadOnly),
            "write_qualification" => Ok(Self::WriteQualification),
            _ => Err("must be exactly read_only or write_qualification"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::WriteQualification => "write_qualification",
        }
    }

    pub fn writes_enabled(self) -> bool {
        self == Self::WriteQualification
    }
}

pub fn validate_profile(
    profile: &str,
    writes: &str,
    source_verification: bool,
    tenant_approved: Option<&str>,
    tenant_class: Option<&str>,
    disposable_approved: Option<&str>,
) -> Result<QualificationProfile, &'static str> {
    let profile = QualificationProfile::parse(profile)?;
    let expected_writes = if profile.writes_enabled() {
        "true"
    } else {
        "false"
    };
    if writes != expected_writes {
        return Err("write flag must exactly match the qualification profile");
    }
    if source_verification {
        if profile != QualificationProfile::ReadOnly {
            return Err("source verification is restricted to read_only");
        }
        return Ok(profile);
    }
    if tenant_approved != Some("true") || tenant_class != Some("qualification") {
        return Err(
            "release and runtime builds require an explicitly approved qualification tenant",
        );
    }
    if profile == QualificationProfile::WriteQualification && disposable_approved != Some("true") {
        return Err("write qualification requires approved disposable resources");
    }
    Ok(profile)
}

pub fn validate_origin(value: &str, reject_placeholder: bool) -> Result<(), &'static str> {
    if value.trim() != value || value.len() > 2048 {
        return Err("must be a trimmed fixed HTTPS origin");
    }
    let url = Url::parse(value).map_err(|_| "must be a valid URL")?;
    if !is_fixed_https_origin(&url) {
        return Err(
            "must be a credential-free fixed HTTPS origin with no path, query, or fragment",
        );
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if reject_placeholder && is_placeholder_host(&host) {
        return Err("must identify the approved qualification tenant, not a placeholder host");
    }
    Ok(())
}

fn is_fixed_https_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/"
}

fn is_placeholder_host(host: &str) -> bool {
    matches!(host, "localhost" | "example.com" | "example.test")
        || host.ends_with(".localhost")
        || host.ends_with(".invalid")
        || host.ends_with(".example.com")
        || host.ends_with(".example.test")
}

pub fn validate_uuid(value: &str) -> Result<(), &'static str> {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || ![8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
    {
        return Err("must be a canonical UUID");
    }
    let compact: String = value
        .chars()
        .filter(|character| *character != '-')
        .collect();
    if compact.chars().all(|character| character == '0')
        || compact
            .chars()
            .all(|character| character == compact.chars().next().unwrap_or('0'))
    {
        return Err("must not be a nil or repeated placeholder UUID");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_exact_bool, validate_origin, validate_profile, validate_uuid, QualificationProfile,
    };

    #[test]
    fn profiles_are_exact_and_fail_closed() {
        assert_eq!(
            validate_profile("read_only", "false", true, None, None, None),
            Ok(QualificationProfile::ReadOnly)
        );
        assert!(validate_profile("read_only", "true", true, None, None, None).is_err());
        assert!(validate_profile(
            "write_qualification",
            "true",
            true,
            Some("true"),
            Some("qualification"),
            Some("true")
        )
        .is_err());
        assert_eq!(
            validate_profile(
                "write_qualification",
                "true",
                false,
                Some("true"),
                Some("qualification"),
                Some("true")
            ),
            Ok(QualificationProfile::WriteQualification)
        );
        assert!(validate_profile(
            "write_qualification",
            "true",
            false,
            Some("true"),
            Some("production"),
            Some("true")
        )
        .is_err());
    }

    #[test]
    fn diagnostic_flag_is_an_exact_boolean() {
        assert_eq!(parse_exact_bool("true"), Ok(true));
        assert_eq!(parse_exact_bool("false"), Ok(false));
        assert!(parse_exact_bool("True").is_err());
        assert!(parse_exact_bool("0").is_err());
        assert!(parse_exact_bool("").is_err());
    }

    #[test]
    fn origins_and_uuids_reject_placeholders_and_malformed_values() {
        assert!(validate_origin("https://tenant.example.org", true).is_ok());
        assert!(validate_origin("https://example.com", true).is_err());
        assert!(validate_origin("https://user@example.org", true).is_err());
        assert!(validate_uuid("123e4567-e89b-12d3-a456-426614174000").is_ok());
        assert!(validate_uuid("00000000-0000-0000-0000-000000000000").is_err());
    }
}
