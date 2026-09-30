use super::{
    app_from, apply_inventory, bootstrap_catalog_summary, classify_catalog_inventory,
    filter_catalog_view, AppInstallState, AppPermission, AppSource, AvailableApp, CatalogEntry,
    CatalogInventoryClassification, CatalogView, InstalledApp, PermissionSubject,
};
use crate::error::Error;

const NATIVE_APP: &str = "20000000-0000-4000-8000-000000000002";

fn entry() -> CatalogEntry {
    CatalogEntry {
        id: "app-1".into(),
        name: Some("Name".into()),
        default_name: Some("Default".into()),
        description: Some("Description".into()),
        developer_name: Some("Developer".into()),
        developer_company_name: Some("Company".into()),
        subtype: Some("WINGET".into()),
        platforms: vec!["WINDOWS".into()],
        release_id: Some("ver-2".into()),
        release_label: Some("2.0".into()),
        has_icon: true,
        package_identifier: Some("Pkg.Id".into()),
    }
}

fn app(released: Option<&str>) -> AvailableApp {
    let mut app = app_from(entry(), NATIVE_APP).unwrap();
    app.released_version_label = released.map(Into::into);
    app
}

fn installed(id: Option<&str>, label: Option<&str>, has_update: Option<bool>) -> InstalledApp {
    InstalledApp {
        identifier: Some("Pkg.Id".into()),
        app_id: Some("app-1".into()),
        version_id: id.map(Into::into),
        version_label: label.map(Into::into),
        has_update,
    }
}

fn applied(released: Option<&str>, inventory: &InstalledApp) -> AppInstallState {
    let mut app = app(released);
    apply_inventory(&mut app, Some(inventory));
    app.install_state
}

fn classified(released: Option<&str>, inventory: &InstalledApp) -> Result<&'static str, Error> {
    match classify_catalog_inventory(app(released), Some(inventory))? {
        CatalogInventoryClassification::Visible(app) => Ok(match app.install_state {
            AppInstallState::Available => "visible_available",
            AppInstallState::UpdateAvailable => "visible_update",
        }),
        CatalogInventoryClassification::InstalledCurrent => Ok("installed_current"),
    }
}

#[test]
fn app_from_maps_a_complete_windows_entry() {
    let app = app_from(entry(), NATIVE_APP).unwrap();
    assert_eq!(app.name, "Name");
    assert_eq!(app.publisher.as_deref(), Some("Developer"));
    assert_eq!(app.source, AppSource::Winget);
    assert_eq!(app.released_version_id, "ver-2");
    assert_eq!(app.install_state, AppInstallState::Available);
    assert!(app.has_icon && app.installed_version_id.is_none());
    assert!(app.active_action_id.is_none() && app.active_action_state.is_none());
}

#[test]
fn app_from_maps_every_supported_subtype() {
    for (subtype, source) in [
        ("WINGET", AppSource::Winget),
        ("WINDOWS_MSI", AppSource::WindowsMsi),
        ("WINDOWS_EXE", AppSource::WindowsExe),
    ] {
        let mut item = entry();
        item.subtype = Some(subtype.into());
        assert_eq!(app_from(item, NATIVE_APP).unwrap().source, source);
    }
}

#[test]
fn app_from_falls_back_for_name_and_publisher() {
    let mut item = entry();
    item.name = None;
    item.developer_name = None;
    let app = app_from(item, NATIVE_APP).unwrap();
    assert_eq!(app.name, "Default");
    assert_eq!(app.publisher.as_deref(), Some("Company"));
}

#[test]
fn app_from_fails_closed_on_incomplete_or_foreign_entries() {
    let mut cases = Vec::new();
    let mut item = entry();
    item.id = NATIVE_APP.to_uppercase();
    cases.push(item);
    for mutate in [
        |e: &mut CatalogEntry| e.platforms = vec!["ANDROID".into()],
        |e: &mut CatalogEntry| e.platforms = vec![],
        |e: &mut CatalogEntry| e.subtype = None,
        |e: &mut CatalogEntry| e.subtype = Some("winget".into()),
        |e: &mut CatalogEntry| e.subtype = Some("MSIX".into()),
        |e: &mut CatalogEntry| {
            e.name = None;
            e.default_name = None;
        },
        |e: &mut CatalogEntry| e.release_id = None,
    ] {
        let mut item = entry();
        mutate(&mut item);
        cases.push(item);
    }
    for item in cases {
        assert_eq!(app_from(item.clone(), NATIVE_APP), None, "{item:?}");
    }
    let mut lower = entry();
    lower.platforms = vec!["windows".into()];
    assert!(app_from(lower, NATIVE_APP).is_some());
}

#[test]
fn newer_comparable_release_is_an_update() {
    let inventory = installed(Some("ver-1"), Some("1.9"), None);
    assert_eq!(
        applied(Some("1.10"), &inventory),
        AppInstallState::UpdateAvailable
    );
    assert_eq!(
        applied(Some("2"), &inventory),
        AppInstallState::UpdateAvailable
    );
}

#[test]
fn equal_or_older_comparable_release_is_not_an_update() {
    for (released, label) in [
        ("1.0", "1.0.0"),
        ("01.2", "1.2"),
        ("1.0", "2.0"),
        ("0", "0.0"),
    ] {
        // characterization: current behavior (labels win over ids and has_update)
        let inventory = installed(Some("other"), Some(label), Some(true));
        assert_eq!(
            applied(Some(released), &inventory),
            AppInstallState::Available
        );
    }
}

#[test]
fn non_numeric_labels_fall_back_to_version_id_and_flag() {
    let differing = installed(Some("VER-1"), Some("1.0a"), None);
    assert_eq!(
        applied(Some("2.0"), &differing),
        AppInstallState::UpdateAvailable
    );
    let same_id_case = installed(Some("VER-2"), Some("1.0a"), None);
    assert_eq!(
        applied(Some("2.0"), &same_id_case),
        AppInstallState::Available
    );
    let flagged = installed(None, None, Some(true));
    assert_eq!(applied(None, &flagged), AppInstallState::UpdateAvailable);
    let unflagged = installed(None, None, Some(false));
    assert_eq!(applied(None, &unflagged), AppInstallState::Available);
    for bad in ["", " ", "1..2", "1.x", "v1", "-1"] {
        let inventory = installed(Some("ver-1"), Some(bad), None);
        assert_eq!(
            applied(Some("1.0"), &inventory),
            AppInstallState::UpdateAvailable,
            "{bad}"
        );
    }
}

#[test]
fn apply_inventory_records_installed_version_and_ignores_absent_inventory() {
    let mut item = app(Some("2.0"));
    apply_inventory(&mut item, None);
    assert!(item.installed_version_id.is_none());
    apply_inventory(
        &mut item,
        Some(&installed(Some("ver-1"), Some("1.0"), None)),
    );
    assert_eq!(item.installed_version_id.as_deref(), Some("ver-1"));
    assert_eq!(item.installed_version_label.as_deref(), Some("1.0"));
}

#[test]
fn classification_without_inventory_is_visible_available() {
    let result = classify_catalog_inventory(app(Some("2.0")), None).unwrap();
    assert!(matches!(
        result,
        CatalogInventoryClassification::Visible(app) if app.install_state == AppInstallState::Available
    ));
}

#[test]
fn classification_covers_update_current_and_unclassifiable() {
    let update = installed(Some("ver-1"), Some("1.0"), None);
    assert_eq!(classified(Some("2.0"), &update), Ok("visible_update"));
    let current = installed(Some("ver-2"), Some("2.0"), None);
    assert_eq!(classified(Some("2.0"), &current), Ok("installed_current"));
    let newer_installed = installed(Some("ver-9"), Some("9.0"), None);
    assert_eq!(
        classified(Some("2.0"), &newer_installed),
        Ok("installed_current")
    );
    let same_release = installed(Some("VER-2"), None, None);
    assert_eq!(
        classified(Some("2.0"), &same_release),
        Ok("installed_current")
    );
    let not_flagged = installed(None, None, Some(false));
    assert_eq!(classified(None, &not_flagged), Ok("installed_current"));
    let unknown = installed(None, None, None);
    assert_eq!(
        classified(None, &unknown),
        Err(Error::server(
            "installed application version cannot be classified"
        ))
    );
    let flagged = installed(None, None, Some(true));
    assert_eq!(classified(None, &flagged), Ok("visible_update"));
}

#[test]
fn summary_counts_available_and_hashes_only_updates() {
    let available = app(Some("2.0"));
    let mut update = app(Some("2.0"));
    update.id = "app-1".into();
    update.install_state = AppInstallState::UpdateAvailable;
    let (count, keys) = bootstrap_catalog_summary(&[available.clone(), update, available]);
    assert_eq!(count, 2);
    // characterization: current behavior (the digest prefix contains a literal backslash and zero,
    // not a NUL byte)
    assert_eq!(
        keys,
        ["sha256:048c00821ad5f4c863516bb1934a1d80fd10ab4016c382ba711eda84f33c0919"]
    );
}

#[test]
fn views_keep_only_their_install_state() {
    let available = app(Some("2.0"));
    let mut update = app(Some("2.0"));
    update.id = "app-2".into();
    update.install_state = AppInstallState::UpdateAvailable;
    let apps = vec![available, update];
    let ids = |view| -> Vec<String> {
        filter_catalog_view(apps.clone(), view)
            .into_iter()
            .map(|app| app.id)
            .collect()
    };
    assert_eq!(ids(CatalogView::Apps), ["app-1"]);
    assert_eq!(ids(CatalogView::Updates), ["app-2"]);
}

#[test]
fn only_readable_user_or_direct_group_grants_authorize_directly() {
    let grant = |read, subject| AppPermission { read, subject };
    let groups = ["GROUP-A".to_owned()];
    let user = grant(true, PermissionSubject::User("USER".into()));
    let group = grant(true, PermissionSubject::Group("group-a".into()));
    let other_group = grant(true, PermissionSubject::Group("group-b".into()));
    let unreadable = grant(false, PermissionSubject::Group("group-a".into()));
    let other = grant(true, PermissionSubject::Other);

    assert!(user.grants_directly("user", &groups));
    assert!(group.grants_directly("user", &groups));
    assert!(!other_group.grants_directly("user", &groups));
    assert!(!unreadable.grants_directly("user", &groups));
    assert!(!other.grants_directly("user", &groups));
    assert_eq!(group.readable_group(), Some("group-a"));
    assert_eq!(other_group.readable_group(), Some("group-b"));
    assert_eq!(unreadable.readable_group(), None);
    assert_eq!(user.readable_group(), None);
}
