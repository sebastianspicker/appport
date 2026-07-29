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
fn base() -> Result<(Url, String), String> {
    let base = Url::parse(
        option_env!("APPPORT_RELUTION_API_BASE_URL").ok_or("embedded base unavailable")?,
    )
    .map_err(|_| "invalid embedded base")?;
    let org = option_env!("APPPORT_RELUTION_ORGANIZATION_UUID")
        .ok_or("embedded organization unavailable")?
        .to_owned();
    if base.scheme() != "https"
        || base.host_str().is_none()
        || base.username() != ""
        || base.query().is_some()
        || base.fragment().is_some()
        || base.path() != "/"
    {
        return Err("embedded base is not fixed HTTPS".into());
    }
    Ok((base, org))
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
fn main() {
    let result = (|| -> Result<Report, String> {
        let (base, org) = base()?;
        let _user_a = prompt("Ordinary user A username")?;
        let _user_b = prompt("Ordinary user B username")?;
        let device_b = prompt("Disposable user B device UUID")?;
        let a = token("Ordinary user A Relution access token")?;
        let b = token("Ordinary user B Relution access token")?;
        let confirmation = prompt(
            "Type QUALIFICATION_READ_ONLY to confirm that this run is restricted to read-only denial checks",
        )?;
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "runtime unavailable")?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "client unavailable")?;
        let mut checks = Vec::new();
        if confirmation != "QUALIFICATION_READ_ONLY" {
            checks.push(Check {
                name: "disposable_resource_confirmation".into(),
                qualified: false,
                reason: "negative mutation probes not authorized".into(),
            });
            return Ok(report(checks, "unqualified_confirmation_required"));
        }
        checks.push(rt.block_on(denied(
            &client,
            &base,
            &org,
            &b,
            "/api/management/v1/security/users/baseInfo",
        )));
        checks.push(rt.block_on(denied(
            &client,
            &base,
            &org,
            &b,
            &format!("/api/management/v1/devices/{device_b}/installedApps"),
        )));
        checks.push(rt.block_on(denied(
            &client,
            &base,
            &org,
            &b,
            &format!("/api/management/v1/devices/{device_b}/actions"),
        )));
        for name in [
            "unreleased_version_denied",
            "unapproved_application_denied",
            "substituted_version_denied",
            "uninstall_wipe_script_shell_policy_user_app_management_denied",
            "individual_action_attribution",
            "permission_removal_propagation",
            "reassignment_propagation",
            "token_revocation_propagation",
            "account_disablement_propagation",
        ] {
            checks.push(Check {
                name: name.into(),
                qualified: false,
                reason: "requires explicit destructive probe plan; writes remain disabled".into(),
            })
        }
        drop(a);
        drop(b);
        Ok(report(checks, "unqualified_incomplete_live_probes"))
    })();
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
