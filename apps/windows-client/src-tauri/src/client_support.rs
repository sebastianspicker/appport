use crate::{dto, evidence, wire::AppAction};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub fn app_from(c: dto::Catalog, native: &str) -> Option<crate::wire::AvailableApp> {
    if c.uuid == native || !c.platforms.iter().any(|p| p == "WINDOWS") {
        return None;
    }
    let source = match c.subtype.as_str() {
        "WINGET" => crate::wire::AppSource::Winget,
        "WINDOWS_MSI" => crate::wire::AppSource::WindowsMsi,
        "WINDOWS_EXE" => crate::wire::AppSource::WindowsExe,
        _ => return None,
    };
    let r = c.versions.release?;
    Some(crate::wire::AvailableApp {
        id: c.uuid,
        name: c.name.or(c.default_name)?,
        description: c.description,
        publisher: c.developer.and_then(|d| d.name.or(d.company_name)),
        source,
        package_identifier: c.internal_name,
        released_version_id: r.uuid,
        released_version_label: r.version_name,
        installed_version_id: None,
        installed_version_label: None,
        install_state: crate::wire::AppInstallState::Available,
        active_action_id: None,
        active_action_state: None,
        has_icon: c.icon.is_some(),
    })
}
pub fn apply_inventory(app: &mut crate::wire::AvailableApp, item: Option<&dto::Inventory>) {
    let Some(item) = item else {
        return;
    };
    app.installed_version_id = item.version_uuid.clone();
    app.installed_version_label = item.version_to_show.clone().or(item.version_name.clone());
    if item.update == Some(true) {
        app.install_state = crate::wire::AppInstallState::UpdateAvailable;
    }
}
pub fn match_device(
    e: &evidence::NativeDeviceEvidenceV1,
    items: &[dto::Device],
) -> Result<dto::Device, String> {
    let sig = e.ent_dmid.as_deref().or(e.smbios_uuid.as_deref());
    let matches: Vec<_> = items
        .iter()
        .filter(|d| {
            sig.map(|s| d.device_id.as_deref() == Some(s))
                .unwrap_or(false)
                || e.bios_serial
                    .as_deref()
                    .map(|s| {
                        d.serial_number.as_deref() == Some(s)
                            && d.name.eq_ignore_ascii_case(&e.hostname)
                    })
                    .unwrap_or(false)
        })
        .collect();
    if matches.len() == 1 {
        Ok(matches[0].clone())
    } else {
        Err("device_match_failed: device evidence did not identify exactly one assigned Windows device".into())
    }
}
pub fn to_action(a: crate::journal::Action) -> AppAction {
    let state = match a.state.as_str() {
        "queued" | "reserved" => crate::wire::ActionState::Queued,
        "sent" => crate::wire::ActionState::Sent,
        "deferred" => crate::wire::ActionState::Deferred,
        "verifying" => crate::wire::ActionState::Verifying,
        "succeeded" => crate::wire::ActionState::Succeeded,
        "failed" => crate::wire::ActionState::Failed,
        "cancelled" => crate::wire::ActionState::Cancelled,
        _ => crate::wire::ActionState::Unknown,
    };
    AppAction {
        id: a.id,
        device_id: a.device_id,
        app_id: a.app_id,
        intent: if a.intent == "update" {
            crate::wire::ActionIntent::Update
        } else {
            crate::wire::ActionIntent::Install
        },
        state,
        error_code: a.error_code,
        error_message: a.error_message,
        created_at: stamp(a.created_at),
        updated_at: stamp(a.updated_at),
    }
}
pub fn stamp(s: i64) -> String {
    format!("{s}")
}
pub fn fixed_https(u: &Url) -> bool {
    u.scheme() == "https"
        && u.host_str().is_some()
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none()
        && u.fragment().is_none()
        && u.path() == "/"
}
pub fn valid_id(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() == 36
        && [8, 13, 18, 23].into_iter().all(|i| b[i] == b'-')
        && b.iter()
            .enumerate()
            .all(|(i, x)| matches!(i, 8 | 13 | 18 | 23) || x.is_ascii_hexdigit())
        && v.chars().any(|x| x != '0' && x != '-')
}
pub fn encode(v: &str) -> String {
    url::form_urlencoded::byte_serialize(v.as_bytes()).collect()
}
pub fn network(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "offline: Relution is unreachable".into()
    } else {
        "server: Relution request failed".into()
    }
}
pub fn status(s: reqwest::StatusCode) -> String {
    match s.as_u16() {
        401 => "session-expired: authorization required".into(),
        403 => "device_match_failed: device not assigned".into(),
        _ => "server: Relution request rejected".into(),
    }
}
pub fn uuid_key() -> String {
    format!("{:x}", rand::rng().random::<u128>())
}
pub fn epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub fn remote_state(v: &str) -> &'static str {
    match v {
        "NEW" | "PENDING" | "PUSH_SENT" => "queued",
        "DELIVERED_CANCELABLE" | "DELIVERED" | "DELIVERY_CONFIRMED" => "sent",
        "NOT_NOW" => "deferred",
        "EXECUTED" => "verifying",
        "ERROR" => "failed",
        "CANCELLED" => "cancelled",
        _ => "unknown",
    }
}
pub fn inventory_matches(i: &dto::Inventory, a: &str, v: &str, p: Option<&str>) -> bool {
    i.app_uuid.as_deref() == Some(a)
        && i.version_uuid.as_deref() == Some(v)
        && (p.is_none() || i.identifier.as_deref() == p)
}
pub fn correlation_candidates(
    actions: Vec<dto::DeviceAction>,
    baseline: &std::collections::HashSet<&str>,
    action: &crate::journal::Action,
) -> Vec<dto::DeviceAction> {
    actions
        .into_iter()
        .filter(|c| {
            !baseline.contains(c.uuid.as_str())
                && c.creation_date >= action.created_at - 5
                && c.details
                    .as_ref()
                    .map(|d| {
                        d.app_uuid.as_deref() == Some(&action.app_id)
                            || d.version_uuid.as_deref() == Some(&action.version_id)
                            || d.package.as_deref() == action.package_id.as_deref()
                    })
                    .unwrap_or(false)
        })
        .collect()
}

pub async fn icon_data_url(response: reqwest::Response) -> Result<Option<String>, String> {
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(status(response.status()));
    }
    if response.content_length().unwrap_or(0) > 1024 * 1024 {
        return Err("server: icon response is too large".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| matches!(*value, "image/png" | "image/jpeg" | "image/webp"))
        .ok_or("server: unsupported icon type")?
        .to_owned();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "server: icon response failed")?;
    if bytes.len() > 1024 * 1024 {
        return Err("server: icon response is too large".into());
    }
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(bytes)
    )))
}
