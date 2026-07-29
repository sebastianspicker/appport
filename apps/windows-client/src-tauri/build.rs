use std::env;
use url::Url;

const BASE: &str = "APPPORT_RELUTION_API_BASE_URL";
const ORGANIZATION: &str = "APPPORT_RELUTION_ORGANIZATION_UUID";
const NATIVE_APP: &str = "APPPORT_NATIVE_APP_UUID";
const WRITES: &str = "APPPORT_RELUTION_WRITES_ENABLED";
const SOURCE_VERIFICATION: &str = "APPPORT_SOURCE_VERIFICATION";

fn main() {
    for name in [BASE, ORGANIZATION, NATIVE_APP, WRITES, SOURCE_VERIFICATION] {
        println!("cargo:rerun-if-env-changed={name}");
    }

    let release = env::var("PROFILE").as_deref() == Ok("release");
    let source_verification = env::var(SOURCE_VERIFICATION).as_deref() == Ok("true");
    if release && source_verification {
        panic!("{SOURCE_VERIFICATION} cannot be used for a release build");
    }
    let base = required_or_source_value(
        BASE,
        "https://source-verification.invalid",
        source_verification,
    );
    let organization = required_or_source_value(
        ORGANIZATION,
        "10000000-0000-4000-8000-000000000001",
        source_verification,
    );
    let native_app = required_or_source_value(
        NATIVE_APP,
        "20000000-0000-4000-8000-000000000002",
        source_verification,
    );

    validate_origin(&base, release).unwrap_or_else(|error| panic!("{BASE}: {error}"));
    validate_uuid(&organization).unwrap_or_else(|error| panic!("{ORGANIZATION}: {error}"));
    validate_uuid(&native_app).unwrap_or_else(|error| panic!("{NATIVE_APP}: {error}"));
    if organization.eq_ignore_ascii_case(&native_app) {
        panic!("qualification organization and native application UUIDs must differ");
    }
    if let Ok(value) = env::var(WRITES) {
        if !value.eq_ignore_ascii_case("false") {
            panic!("{WRITES} must be false for alpha.3");
        }
    }

    println!("cargo:rustc-env={BASE}={base}");
    println!("cargo:rustc-env={ORGANIZATION}={organization}");
    println!("cargo:rustc-env={NATIVE_APP}={native_app}");
    println!("cargo:rustc-env={WRITES}=false");
    tauri_build::build()
}

fn required_or_source_value(name: &str, source_value: &str, source_verification: bool) -> String {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => value,
        _ if source_verification => source_value.to_owned(),
        _ => panic!("{name} is required for an alpha.3 candidate build"),
    }
}

fn validate_origin(value: &str, release: bool) -> Result<(), &'static str> {
    if value.trim() != value || value.len() > 2048 {
        return Err("must be a trimmed fixed HTTPS origin");
    }
    let url = Url::parse(value).map_err(|_| "must be a valid URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(
            "must be a credential-free fixed HTTPS origin with no path, query, or fragment",
        );
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if release
        && (host == "localhost"
            || host.ends_with(".localhost")
            || host.ends_with(".invalid")
            || host == "example.com"
            || host.ends_with(".example.com")
            || host == "example.test"
            || host.ends_with(".example.test"))
    {
        return Err("must identify the approved qualification tenant, not a placeholder host");
    }
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), &'static str> {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| !matches!(index, 8 | 13 | 18 | 23) && !byte.is_ascii_hexdigit())
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
