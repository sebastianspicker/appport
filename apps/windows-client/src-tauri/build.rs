#[path = "src/build_config.rs"]
mod build_config;

use build_config::{
    parse_exact_bool, validate_origin, validate_profile, validate_uuid, BASE, DIAGNOSTICS,
    DISPOSABLE_APPROVED, NATIVE_APP, ORGANIZATION, PROFILE, TENANT_APPROVED, TENANT_CLASS, WRITES,
};
use sha2::{Digest, Sha256};
use std::env;

const SOURCE_VERIFICATION: &str = "APPPORT_SOURCE_VERIFICATION";
const SOURCE_REVISION: &str = "APPPORT_SOURCE_REVISION";

fn main() {
    register_rerun_directives();
    let inputs = load_build_inputs();
    let configuration = validate_build_inputs(inputs);
    emit_build_configuration(&configuration);
    tauri_build::build()
}

struct BuildInputs {
    release: bool,
    source_verification: bool,
    diagnostics: Option<String>,
    base: Option<String>,
    organization: Option<String>,
    native_app: Option<String>,
    profile: Option<String>,
    writes: Option<String>,
    source_revision: Option<String>,
    tenant_approved: Option<String>,
    tenant_class: Option<String>,
    disposable_approved: Option<String>,
}

struct BuildConfiguration {
    source_verification: bool,
    diagnostics: bool,
    base: String,
    organization: String,
    native_app: String,
    writes: String,
    profile: build_config::QualificationProfile,
    source_revision: String,
    tenant_approved: String,
    tenant_class: String,
    disposable_approved: String,
}

struct SecuritySettings {
    diagnostics: bool,
}

struct TenantIdentity {
    base: String,
    organization: String,
    native_app: String,
}

struct QualificationBuild {
    profile: String,
    writes: String,
    source_revision: String,
}

fn register_rerun_directives() {
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
        SOURCE_VERIFICATION,
        SOURCE_REVISION,
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
}

fn load_build_inputs() -> BuildInputs {
    BuildInputs {
        release: env::var("PROFILE").as_deref() == Ok("release"),
        source_verification: env::var(SOURCE_VERIFICATION).as_deref() == Ok("true"),
        diagnostics: env::var(DIAGNOSTICS).ok(),
        base: env::var(BASE).ok(),
        organization: env::var(ORGANIZATION).ok(),
        native_app: env::var(NATIVE_APP).ok(),
        profile: env::var(PROFILE).ok(),
        writes: env::var(WRITES).ok(),
        source_revision: env::var(SOURCE_REVISION).ok(),
        tenant_approved: env::var(TENANT_APPROVED).ok(),
        tenant_class: env::var(TENANT_CLASS).ok(),
        disposable_approved: env::var(DISPOSABLE_APPROVED).ok(),
    }
}

fn validate_build_inputs(inputs: BuildInputs) -> BuildConfiguration {
    let security = validate_security_settings(&inputs);
    let tenant = load_tenant_identity(&inputs);
    let qualification = load_qualification_build(&inputs);
    validate_tenant_identity(&tenant, inputs.source_verification);
    let profile = validate_qualification_profile(&qualification, &inputs);

    BuildConfiguration {
        source_verification: inputs.source_verification,
        diagnostics: security.diagnostics,
        base: tenant.base,
        organization: tenant.organization,
        native_app: tenant.native_app,
        writes: qualification.writes,
        profile,
        source_revision: qualification.source_revision,
        tenant_approved: inputs.tenant_approved.unwrap_or_default(),
        tenant_class: inputs.tenant_class.unwrap_or_default(),
        disposable_approved: inputs.disposable_approved.unwrap_or_default(),
    }
}

fn validate_security_settings(inputs: &BuildInputs) -> SecuritySettings {
    if inputs.release && inputs.source_verification {
        panic!("{SOURCE_VERIFICATION} cannot be used for a release build");
    }
    let diagnostics = match inputs.diagnostics.clone() {
        Some(value) => parse_exact_bool(&value)
            .unwrap_or_else(|error| panic!("{DIAGNOSTICS}: {error}")),
        None if inputs.source_verification => false,
        None => panic!(
            "{DIAGNOSTICS} must be explicitly set to true or false for an alpha.4 qualification build"
        ),
    };
    SecuritySettings { diagnostics }
}

fn load_tenant_identity(inputs: &BuildInputs) -> TenantIdentity {
    let base = required_or_source_value(
        inputs.base.clone(),
        BASE,
        "https://source-verification.invalid",
        inputs.source_verification,
    );
    let organization = required_or_source_value(
        inputs.organization.clone(),
        ORGANIZATION,
        "10000000-0000-4000-8000-000000000001",
        inputs.source_verification,
    );
    let native_app = required_or_source_value(
        inputs.native_app.clone(),
        NATIVE_APP,
        "20000000-0000-4000-8000-000000000002",
        inputs.source_verification,
    );
    TenantIdentity {
        base,
        organization,
        native_app,
    }
}

fn validate_tenant_identity(tenant: &TenantIdentity, source_verification: bool) {
    validate_origin(&tenant.base, !source_verification)
        .unwrap_or_else(|error| panic!("{BASE}: {error}"));
    validate_uuid(&tenant.organization).unwrap_or_else(|error| panic!("{ORGANIZATION}: {error}"));
    validate_uuid(&tenant.native_app).unwrap_or_else(|error| panic!("{NATIVE_APP}: {error}"));
    if tenant.organization.eq_ignore_ascii_case(&tenant.native_app) {
        panic!("qualification organization and native application UUIDs must differ");
    }
}

fn load_qualification_build(inputs: &BuildInputs) -> QualificationBuild {
    let profile = source_or_empty_value(
        inputs.profile.clone(),
        "read_only",
        inputs.source_verification,
    );
    let writes = source_or_empty_value(inputs.writes.clone(), "false", inputs.source_verification);
    let source_revision = source_or_empty_value(
        inputs.source_revision.clone(),
        "source-verification",
        inputs.source_verification,
    );
    validate_source_revision(&source_revision, inputs.source_verification);
    QualificationBuild {
        profile,
        writes,
        source_revision,
    }
}

fn validate_qualification_profile(
    qualification: &QualificationBuild,
    inputs: &BuildInputs,
) -> build_config::QualificationProfile {
    validate_profile(
        &qualification.profile,
        &qualification.writes,
        inputs.source_verification,
        inputs.tenant_approved.as_deref(),
        inputs.tenant_class.as_deref(),
        inputs.disposable_approved.as_deref(),
    )
    .unwrap_or_else(|error| panic!("qualification profile: {error}"))
}

fn source_or_empty_value(
    value: Option<String>,
    source_value: &str,
    source_verification: bool,
) -> String {
    value.unwrap_or_else(|| {
        if source_verification {
            source_value.into()
        } else {
            String::new()
        }
    })
}

fn validate_source_revision(source_revision: &str, source_verification: bool) {
    if !source_verification
        && (source_revision.len() != 40
            || !source_revision.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        panic!("{SOURCE_REVISION} must be the exact 40-hex candidate commit");
    }
}

fn emit_build_configuration(configuration: &BuildConfiguration) {
    println!("cargo:rustc-env={BASE}={}", configuration.base);
    println!(
        "cargo:rustc-env={ORGANIZATION}={}",
        configuration.organization
    );
    println!("cargo:rustc-env={NATIVE_APP}={}", configuration.native_app);
    println!("cargo:rustc-env={WRITES}={}", configuration.writes);
    println!(
        "cargo:rustc-env={PROFILE}={}",
        configuration.profile.as_str()
    );
    println!(
        "cargo:rustc-env={SOURCE_REVISION}={}",
        configuration.source_revision
    );
    println!(
        "cargo:rustc-env={DIAGNOSTICS}={}",
        configuration.diagnostics
    );
    println!(
        "cargo:rustc-env=APPPORT_CONFIGURATION_FINGERPRINT_SHA256={}",
        configuration_fingerprint(configuration)
    );
    println!(
        "cargo:rustc-env=APPPORT_QUALIFICATION_BUILD={}",
        if configuration.source_verification {
            "false"
        } else {
            "true"
        }
    );
}

fn configuration_fingerprint(configuration: &BuildConfiguration) -> String {
    let fingerprint = format!(
        "origin={base}\norganization={organization}\nnativeApplication={native_app}\nprofile={}\nwrites={writes}\ndiagnostics={diagnostics}\ntenantApproved={}\ntenantClass={}\ndisposableApproved={}\n",
        configuration.profile.as_str(),
        configuration.tenant_approved,
        configuration.tenant_class,
        configuration.disposable_approved,
        base = configuration.base,
        organization = configuration.organization,
        native_app = configuration.native_app,
        writes = configuration.writes,
        diagnostics = configuration.diagnostics,
    );
    format!("{:x}", Sha256::digest(fingerprint.as_bytes()))
}

fn required_or_source_value(
    value: Option<String>,
    name: &str,
    source_value: &str,
    source_verification: bool,
) -> String {
    match value {
        Some(value) if !value.trim().is_empty() => value,
        _ if source_verification => source_value.to_owned(),
        _ => panic!("{name} is required for an alpha.4 qualification build"),
    }
}
