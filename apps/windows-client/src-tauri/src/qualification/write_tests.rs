use super::{
    catalog_result, cross_user_action_check, fixtures_are_approved, Error, WriteCatalogFailure,
};
use crate::{
    domain::catalog::{AppInstallState, AppSource, AvailableApp},
    qualification::{ActionFixture, QualificationPlan},
};

#[test]
fn apps_lookup_failure_is_redacted_and_blocks_catalog_use() {
    let result: Result<(), Error> = Err(Error::server(
        "invalid Relution response Bearer sentinel-apps-token",
    ));

    let failure = catalog_result(result, WriteCatalogFailure::Apps).unwrap_err();
    let check = failure.check();

    assert_eq!(failure, WriteCatalogFailure::Apps);
    assert_eq!(check.name, "write_catalog");
    assert_eq!(check.status, super::super::CheckStatus::Failed);
    assert!(check.detail.contains("Apps catalog lookup failed"));
    assert!(!check.detail.contains("sentinel-apps-token"));
}

#[test]
fn updates_lookup_failure_is_redacted_and_blocks_catalog_use() {
    let result: Result<(), Error> = Err(Error::server(
        "invalid Relution response Bearer sentinel-updates-token",
    ));

    let failure = catalog_result(result, WriteCatalogFailure::Updates).unwrap_err();
    let check = failure.check();

    assert_eq!(failure, WriteCatalogFailure::Updates);
    assert_eq!(check.name, "write_catalog");
    assert_eq!(check.status, super::super::CheckStatus::Failed);
    assert!(check.detail.contains("Updates catalog lookup failed"));
    assert!(!check.detail.contains("sentinel-updates-token"));
}

#[test]
fn cross_user_action_passes_only_for_the_observed_device_denial() {
    let passed_check =
        cross_user_action_check::<()>(Err(Error::device_match_failed("device not assigned")));
    assert_eq!(passed_check.status, super::super::CheckStatus::Passed);

    for result in [
        Ok(()),
        Err(Error::server("action submission failed")),
        Err(Error::session_expired("user A session expired")),
    ] {
        assert_eq!(
            cross_user_action_check(result).status,
            super::super::CheckStatus::Failed
        );
    }
}

fn app(id: &str, version: &str, state: AppInstallState) -> AvailableApp {
    AvailableApp {
        id: id.to_owned(),
        name: "app".to_owned(),
        description: None,
        publisher: None,
        source: AppSource::Winget,
        package_identifier: None,
        released_version_id: version.to_owned(),
        released_version_label: Some("1.0".to_owned()),
        installed_version_id: None,
        installed_version_label: None,
        install_state: state,
        active_action_id: None,
        active_action_state: None,
        has_icon: false,
    }
}

#[test]
fn unauthorized_application_is_visible_regardless_of_uuid_case() {
    let fixture = |app: &str, version: &str| ActionFixture {
        application_uuid: app.to_owned(),
        version_uuid: version.to_owned(),
        expected_version: "1.0".to_owned(),
    };
    let plan = QualificationPlan {
        schema_version: 1,
        disposable_device_uuid: "d".to_owned(),
        cleanup_owner: "o".to_owned(),
        install: fixture("aaaa", "va"),
        update: fixture("bbbb", "vb"),
        unauthorized: super::super::plan::UnauthorizedFixture {
            application_uuid: "cccc".to_owned(),
            version_uuid: "vc".to_owned(),
        },
    };
    let apps = vec![
        app("AAAA", "VA", AppInstallState::Available),
        app("CCCC", "other", AppInstallState::Available),
    ];
    let updates = vec![app("BBBB", "VB", AppInstallState::UpdateAvailable)];
    let mut checks = Vec::new();

    assert!(!fixtures_are_approved(&apps, &updates, &plan, &mut checks));
    let unauthorized = checks
        .iter()
        .find(|check| check.name == "unauthorized_application")
        .unwrap();
    assert_eq!(unauthorized.status, super::super::CheckStatus::Failed);
}
