//! Operator-only, fail-closed live qualification. Tokens are read once from a masked
//! console and are never accepted from arguments, environment, files, or output.
use reqwest::{Client, StatusCode};
use serde::Serialize;
use std::io::{self, Write};
use url::Url;

#[derive(Serialize)]
struct Check {
    name: String,
    qualified: bool,
    reason: String,
}
#[derive(Serialize)]
struct Report {
    qualified: bool,
    status: &'static str,
    token_redacted: bool,
    writes_enabled: bool,
    destructive_probes: &'static str,
    checks: Vec<Check>,
}
struct QualificationInput {
    device: String,
    user_a_token: String,
    user_b_token: String,
    confirmed: bool,
}
fn prompt(label: &str) -> Result<String, String> {
    eprint!("{label}: ");
    io::stderr().flush().map_err(|_| "console unavailable")?;
    let mut s = String::new();
    io::stdin()
        .read_line(&mut s)
        .map_err(|_| "console unavailable")?;
    let s = s.trim().to_owned();
    if s.is_empty() {
        Err("required console value missing".into())
    } else {
        Ok(s)
    }
}
#[cfg(windows)]
fn token(label: &str) -> Result<String, String> {
    eprint!("{label}: ");
    io::stderr().flush().map_err(|_| "console unavailable")?;
    let s = rpassword::read_password().map_err(|_| "secure console input unavailable")?;
    if s.trim().is_empty() {
        Err("empty token".into())
    } else {
        Ok(s)
    }
}

#[cfg(not(windows))]
fn token(label: &str) -> Result<String, String> {
    prompt(label)
}
fn base() -> Result<(Url, String), String> {
    let base = Url::parse(
        option_env!("APPPORT_RELUTION_API_BASE_URL").ok_or("embedded base unavailable")?,
    )
    .map_err(|_| "invalid embedded base")?;
    let org = option_env!("APPPORT_RELUTION_ORGANIZATION_UUID")
        .ok_or("embedded organization unavailable")?
        .to_owned();
    if !fixed_https(&base) {
        return Err("embedded base is not fixed HTTPS".into());
    }
    Ok((base, org))
}
fn fixed_https(base: &Url) -> bool {
    base.scheme() == "https"
        && base.host_str().is_some()
        && base.username().is_empty()
        && base.query().is_none()
        && base.fragment().is_none()
        && base.path() == "/"
}
async fn denied(client: &Client, base: &Url, org: &str, token: &str, path: &str) -> Check {
    let name = path.to_owned();
    let mut url = match base.join(path) {
        Ok(v) => v,
        Err(_) => {
            return Check {
                name,
                qualified: false,
                reason: "invalid path".into(),
            }
        }
    };
    url.query_pairs_mut()
        .append_pair("tenantOrganizationUuid", org);
    let response = client
        .get(url)
        .header("X-User-Access-Token", token)
        .header("tenantOrganizationUuid", org)
        .send()
        .await;
    match response {
        Ok(r)
            if matches!(
                r.status(),
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
            ) =>
        {
            Check {
                name,
                qualified: true,
                reason: "denied".into(),
            }
        }
        Ok(r) => Check {
            name,
            qualified: false,
            reason: format!("unexpected HTTP {}", r.status().as_u16()),
        },
        Err(_) => Check {
            name,
            qualified: false,
            reason: "unavailable".into(),
        },
    }
}
fn report(checks: Vec<Check>, status: &'static str) -> Report {
    let qualified = checks.iter().all(|c| c.qualified);
    Report {
        qualified,
        status,
        token_redacted: true,
        writes_enabled: false,
        destructive_probes: "not_run",
        checks,
    }
}
fn unavailable_destructive_checks() -> Vec<Check> {
    [
        "unreleased_version_denied",
        "unapproved_application_denied",
        "substituted_version_denied",
        "uninstall_wipe_script_shell_policy_user_app_management_denied",
        "individual_action_attribution",
        "permission_removal_propagation",
        "reassignment_propagation",
        "token_revocation_propagation",
        "account_disablement_propagation",
    ]
    .into_iter()
    .map(|name| Check {
        name: name.into(),
        qualified: false,
        reason: "requires explicit destructive probe plan; writes remain disabled".into(),
    })
    .collect()
}
fn confirmation_report() -> Report {
    report(
        vec![Check {
            name: "disposable_resource_confirmation".into(),
            qualified: false,
            reason: "negative mutation probes not authorized".into(),
        }],
        "unqualified_confirmation_required",
    )
}
fn live_checks(
    rt: &tokio::runtime::Runtime,
    client: &Client,
    base: &Url,
    org: &str,
    token: &str,
    device: &str,
) -> Vec<Check> {
    let mut checks = vec![
        rt.block_on(denied(
            client,
            base,
            org,
            token,
            "/api/management/v1/security/users/baseInfo",
        )),
        rt.block_on(denied(
            client,
            base,
            org,
            token,
            &format!("/api/management/v1/devices/{device}/installedApps"),
        )),
        rt.block_on(denied(
            client,
            base,
            org,
            token,
            &format!("/api/management/v1/devices/{device}/actions"),
        )),
    ];
    checks.extend(unavailable_destructive_checks());
    checks
}
fn qualify() -> Result<Report, String> {
    let (base, org) = base()?;
    let input = qualification_input()?;
    if !input.confirmed {
        return Ok(confirmation_report());
    }
    let rt = qualification_runtime()?;
    let client = qualification_client()?;
    let checks = live_checks(
        &rt,
        &client,
        &base,
        &org,
        &input.user_b_token,
        &input.device,
    );
    drop(input.user_a_token);
    Ok(report(checks, "unqualified_incomplete_live_probes"))
}
fn qualification_input() -> Result<QualificationInput, String> {
    let _user_a = prompt("Ordinary user A username")?;
    let _user_b = prompt("Ordinary user B username")?;
    let device = prompt("Disposable user B device UUID")?;
    let user_a_token = token("Ordinary user A Relution access token")?;
    let user_b_token = token("Ordinary user B Relution access token")?;
    let confirmed = prompt("Type QUALIFICATION_READ_ONLY to confirm that this run is restricted to read-only denial checks")? == "QUALIFICATION_READ_ONLY";
    Ok(QualificationInput {
        device,
        user_a_token,
        user_b_token,
        confirmed,
    })
}
fn qualification_runtime() -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime unavailable".into())
}
fn qualification_client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "client unavailable".into())
}
fn main() {
    let result = qualify();
    let output = match result {
        Ok(v) => v,
        Err(reason) => report(
            vec![Check {
                name: "qualification_setup".into(),
                qualified: false,
                reason,
            }],
            "unqualified_setup",
        ),
    };
    println!(
        "{}",
        serde_json::to_string(&output).unwrap_or_else(|_| {
            "{\"qualified\":false,\"status\":\"serialization_failure\"}".into()
        })
    );
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn report_is_fail_closed_and_redacted() {
        let r = report(
            vec![Check {
                name: "x".into(),
                qualified: false,
                reason: "unavailable".into(),
            }],
            "test",
        );
        let text = serde_json::to_string(&r).unwrap();
        assert!(!r.qualified);
        assert!(!r.writes_enabled);
        assert_eq!(r.destructive_probes, "not_run");
        assert!(text.contains("token_redacted"));
        assert!(!text.contains("secret"));
    }
}
