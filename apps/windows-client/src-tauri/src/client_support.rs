use crate::{dto, evidence, wire::AppAction};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

const MAX_ICON_BYTES: usize = 1024 * 1024;

pub fn app_from(c: dto::Catalog, native: &str) -> Option<crate::wire::AvailableApp> {
    if same_uuid(&c.uuid, native)
        || !c
            .platforms
            .iter()
            .any(|platform| platform.eq_ignore_ascii_case("WINDOWS"))
    {
        return None;
    }
    let source = match c.subtype.as_deref() {
        Some("WINGET") => crate::wire::AppSource::Winget,
        Some("WINDOWS_MSI") => crate::wire::AppSource::WindowsMsi,
        Some("WINDOWS_EXE") => crate::wire::AppSource::WindowsExe,
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
    if let Some(installed_version_id) = item.version_uuid.as_deref() {
        if !same_uuid(installed_version_id, &app.released_version_id) {
            app.install_state = crate::wire::AppInstallState::UpdateAvailable;
        }
    } else if item.update == Some(true) {
        app.install_state = crate::wire::AppInstallState::UpdateAvailable;
    }
}

pub fn bootstrap_catalog_summary(apps: &[crate::wire::AvailableApp]) -> (u32, Vec<String>) {
    let available_count = apps
        .iter()
        .filter(|app| app.install_state == crate::wire::AppInstallState::Available)
        .count() as u32;
    let update_keys = apps
        .iter()
        .filter(|app| app.install_state == crate::wire::AppInstallState::UpdateAvailable)
        .map(|app| format!("{}:{}", app.id, app.released_version_id))
        .collect();
    (available_count, update_keys)
}
pub fn match_device(
    e: &evidence::NativeDeviceEvidenceV1,
    items: &[dto::Device],
) -> Result<dto::Device, String> {
    let sig = e.ent_dmid.as_deref().or(e.smbios_uuid.as_deref());
    let matches: Vec<_> = items
        .iter()
        .filter(|d| {
            sig.map(|signature| {
                d.device_id
                    .as_deref()
                    .is_some_and(|device_id| same_evidence_value(device_id, signature))
            })
            .unwrap_or(false)
                || e.bios_serial
                    .as_deref()
                    .map(|serial| {
                        d.serial_number
                            .as_deref()
                            .is_some_and(|device_serial| same_evidence_value(device_serial, serial))
                            && same_evidence_value(&d.name, &e.hostname)
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
    let state = action_state(a.state);
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

pub fn attach_active_actions(
    apps: &mut [crate::wire::AvailableApp],
    actions: Vec<crate::journal::ActiveAction>,
) {
    let actions: HashMap<_, _> = actions
        .into_iter()
        .map(|action| (action.app_id, (action.id, action_state(action.state))))
        .collect();
    for app in apps {
        if let Some((id, state)) = actions.get(&app.id) {
            app.active_action_id = Some(id.clone());
            app.active_action_state = Some(*state);
        }
    }
}

fn action_state(state: crate::journal::State) -> crate::wire::ActionState {
    match state {
        crate::journal::State::Reserved | crate::journal::State::Queued => {
            crate::wire::ActionState::Queued
        }
        crate::journal::State::Sent => crate::wire::ActionState::Sent,
        crate::journal::State::Deferred => crate::wire::ActionState::Deferred,
        crate::journal::State::Verifying => crate::wire::ActionState::Verifying,
        crate::journal::State::Succeeded => crate::wire::ActionState::Succeeded,
        crate::journal::State::Failed => crate::wire::ActionState::Failed,
        crate::journal::State::Cancelled => crate::wire::ActionState::Cancelled,
        crate::journal::State::Unknown => crate::wire::ActionState::Unknown,
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
pub fn same_uuid(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}
pub fn same_evidence_value(left: &str, right: &str) -> bool {
    let left = left.trim();
    let right = right.trim();
    !left.is_empty() && !right.is_empty() && left.eq_ignore_ascii_case(right)
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
        403 => "authorization: account or token lacks required Relution access".into(),
        _ => "server: Relution request failed after submission may have occurred".into(),
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
pub fn remote_state(v: &str) -> crate::journal::State {
    match v {
        "NEW" | "PENDING" | "PUSH_SENT" => crate::journal::State::Queued,
        "DELIVERED_CANCELABLE" | "DELIVERED" | "DELIVERY_CONFIRMED" => crate::journal::State::Sent,
        "NOT_NOW" => crate::journal::State::Deferred,
        "EXECUTED" => crate::journal::State::Verifying,
        "ERROR" => crate::journal::State::Failed,
        "CANCELLED" => crate::journal::State::Cancelled,
        _ => crate::journal::State::Unknown,
    }
}
pub fn inventory_matches(i: &dto::Inventory, a: &str, v: &str, p: Option<&str>) -> bool {
    i.app_uuid.as_deref().is_some_and(|app| same_uuid(app, a))
        && i.version_uuid
            .as_deref()
            .is_some_and(|version| same_uuid(version, v))
        && (p.is_none() || i.identifier.as_deref() == p)
}

pub fn action_details_match(
    details: Option<&dto::ActionDetails>,
    app_id: &str,
    version_id: &str,
    package_id: Option<&str>,
) -> bool {
    let Some(details) = details else {
        return false;
    };
    let uuid_identifiers = [
        (details.app_uuid.as_deref(), Some(app_id)),
        (details.version_uuid.as_deref(), Some(version_id)),
    ];
    let mut matched = false;
    for (candidate, expected) in uuid_identifiers {
        if let (Some(candidate), Some(expected)) = (candidate, expected) {
            if !same_uuid(candidate, expected) {
                return false;
            }
            matched = true;
        }
    }
    if let (Some(candidate), Some(expected)) = (details.package.as_deref(), package_id) {
        if candidate != expected {
            return false;
        }
        matched = true;
    }
    matched
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
                && action_details_match(
                    c.details.as_ref(),
                    &action.app_id,
                    &action.version_id,
                    action.package_id.as_deref(),
                )
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
    if response.content_length().unwrap_or(0) > MAX_ICON_BYTES as u64 {
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
    if bytes.len() > MAX_ICON_BYTES {
        return Err("server: icon response is too large".into());
    }
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nullable_catalog_subtypes_do_not_block_supported_windows_apps() {
        let page: dto::Page<dto::Catalog> = serde_json::from_str(
            r#"{"results":[{"uuid":"ios","name":"iOS","subType":null,"platforms":["IOS"],"versions":{"RELEASE":{"uuid":"ios-version"}}},{"uuid":"unknown-windows","name":"Unknown Windows","subType":null,"platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"unknown-version"}}},{"uuid":"windows","name":"Windows","subType":"WINGET","platforms":["WINDOWS"],"versions":{"RELEASE":{"uuid":"windows-version"}}}]}"#,
        )
        .unwrap();

        let apps = page
            .results
            .into_iter()
            .filter_map(|catalog| app_from(catalog, "native"))
            .collect::<Vec<_>>();

        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].id, "windows");
        assert_eq!(apps[0].source, crate::wire::AppSource::Winget);
    }

    fn app(id: &str) -> crate::wire::AvailableApp {
        crate::wire::AvailableApp {
            id: id.into(),
            name: id.into(),
            description: None,
            publisher: None,
            source: crate::wire::AppSource::Winget,
            package_identifier: None,
            released_version_id: "version".into(),
            released_version_label: None,
            installed_version_id: None,
            installed_version_label: None,
            install_state: crate::wire::AppInstallState::Available,
            active_action_id: None,
            active_action_state: None,
            has_icon: false,
        }
    }

    #[test]
    fn active_actions_attach_only_to_the_matching_app_including_unknown() {
        let mut apps = vec![app("one"), app("two")];
        attach_active_actions(
            &mut apps,
            vec![crate::journal::ActiveAction {
                id: "unknown-id".into(),
                app_id: "two".into(),
                state: crate::journal::State::Unknown,
            }],
        );
        assert_eq!(apps[0].active_action_id, None);
        assert_eq!(apps[1].active_action_id.as_deref(), Some("unknown-id"));
        assert_eq!(
            apps[1].active_action_state,
            Some(crate::wire::ActionState::Unknown)
        );
    }

    #[test]
    fn forbidden_status_is_an_authorization_error_not_a_device_match_failure() {
        assert_eq!(
            status(reqwest::StatusCode::FORBIDDEN),
            "authorization: account or token lacks required Relution access"
        );
    }
}
