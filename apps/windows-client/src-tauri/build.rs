#[path = "src/build_config.rs"]
mod build_config;

use build_config::{
    parse_exact_bool, validate_origin, validate_password_auth_scaffold, validate_profile,
    validate_uuid, BASE, DIAGNOSTICS, DISPOSABLE_APPROVED, NATIVE_APP, ORGANIZATION,
    PASSWORD_AUTH_CONTRACT, PASSWORD_AUTH_ENABLED, PROFILE, TENANT_APPROVED, TENANT_CLASS, WRITES,
};
use sha2::{Digest, Sha256};
use std::env;

const SOURCE_VERIFICATION: &str = "APPPORT_SOURCE_VERIFICATION";
const SOURCE_REVISION: &str = "APPPORT_SOURCE_REVISION";

fn main() {
    for name in [
        BASE,
        ORGANIZATION,
        NATIVE_APP,
        WRITES,
        PROFILE,
        TENANT_APPROVED,
        TENANT_CLASS,
        DISPOSABLE_APPROVED,
        DIAGNOSTICS,
        PASSWORD_AUTH_ENABLED,
        PASSWORD_AUTH_CONTRACT,
        SOURCE_VERIFICATION,
        SOURCE_REVISION,
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }

    let release = env::var("PROFILE").as_deref() == Ok("release");
    let source_verification = env::var(SOURCE_VERIFICATION).as_deref() == Ok("true");
    if release && source_verification {
        panic!("{SOURCE_VERIFICATION} cannot be used for a release build");
    }
    let diagnostics = match env::var(DIAGNOSTICS) {
        Ok(value) => parse_exact_bool(&value)
            .unwrap_or_else(|error| panic!("{DIAGNOSTICS}: {error}")),
        Err(_) if source_verification => false,
        Err(_) => panic!(
            "{DIAGNOSTICS} must be explicitly set to true or false for an alpha.4 qualification build"
        ),
    };
    let password_auth_enabled =
        required_or_source_value(PASSWORD_AUTH_ENABLED, "false", source_verification);
    let password_auth_contract =
        required_or_source_value(PASSWORD_AUTH_CONTRACT, "none", source_verification);
    validate_password_auth_scaffold(&password_auth_enabled, &password_auth_contract)
        .unwrap_or_else(|error| panic!("password authentication build validation: {error}"));
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
    let profile = env::var(PROFILE).unwrap_or_else(|_| {
        if source_verification {
            "read_only".into()
        } else {
            String::new()
        }
    });
    let writes = env::var(WRITES).unwrap_or_else(|_| {
        if source_verification {
            "false".into()
        } else {
            String::new()
        }
    });
    let source_revision = env::var(SOURCE_REVISION).unwrap_or_else(|_| {
        if source_verification {
            "source-verification".into()
        } else {
            String::new()
        }
    });
    if !source_verification
        && (source_revision.len() != 40
            || !source_revision.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        panic!("{SOURCE_REVISION} must be the exact 40-hex candidate commit");
    }

    validate_origin(&base, !source_verification).unwrap_or_else(|error| panic!("{BASE}: {error}"));
    validate_uuid(&organization).unwrap_or_else(|error| panic!("{ORGANIZATION}: {error}"));
    validate_uuid(&native_app).unwrap_or_else(|error| panic!("{NATIVE_APP}: {error}"));
    if organization.eq_ignore_ascii_case(&native_app) {
        panic!("qualification organization and native application UUIDs must differ");
    }
    let profile = validate_profile(
        &profile,
        &writes,
        source_verification,
        env::var(TENANT_APPROVED).ok().as_deref(),
        env::var(TENANT_CLASS).ok().as_deref(),
        env::var(DISPOSABLE_APPROVED).ok().as_deref(),
    )
    .unwrap_or_else(|error| panic!("qualification profile: {error}"));

    println!("cargo:rustc-env={BASE}={base}");
    println!("cargo:rustc-env={ORGANIZATION}={organization}");
    println!("cargo:rustc-env={NATIVE_APP}={native_app}");
    println!("cargo:rustc-env={WRITES}={writes}");
    println!("cargo:rustc-env={PROFILE}={}", profile.as_str());
    println!("cargo:rustc-env={SOURCE_REVISION}={source_revision}");
    println!("cargo:rustc-env={DIAGNOSTICS}={diagnostics}");
    println!("cargo:rustc-env={PASSWORD_AUTH_ENABLED}={password_auth_enabled}");
    println!("cargo:rustc-env={PASSWORD_AUTH_CONTRACT}={password_auth_contract}");
    let configuration_fingerprint = format!(
        "origin={base}\norganization={organization}\nnativeApplication={native_app}\nprofile={}\nwrites={writes}\ndiagnostics={diagnostics}\npasswordAuthEnabled={password_auth_enabled}\npasswordAuthContract={password_auth_contract}\ntenantApproved={}\ntenantClass={}\ndisposableApproved={}\n",
        profile.as_str(),
        env::var(TENANT_APPROVED).unwrap_or_default(),
        env::var(TENANT_CLASS).unwrap_or_default(),
        env::var(DISPOSABLE_APPROVED).unwrap_or_default(),
    );
    println!(
        "cargo:rustc-env=APPPORT_CONFIGURATION_FINGERPRINT_SHA256={:x}",
        Sha256::digest(configuration_fingerprint.as_bytes())
    );
    println!(
        "cargo:rustc-env=APPPORT_QUALIFICATION_BUILD={}",
        if source_verification { "false" } else { "true" }
    );
    tauri_build::build()
}

fn required_or_source_value(name: &str, source_value: &str, source_verification: bool) -> String {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => value,
        _ if source_verification => source_value.to_owned(),
        _ => panic!("{name} is required for an alpha.4 qualification build"),
    }
}
