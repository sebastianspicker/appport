use super::{catalog, client, concurrent_server, device, run, CatalogService, Response};
use crate::error::Error;
use crate::{
    domain::{
        catalog::{
            app_from, classify_catalog_inventory, CatalogInventoryClassification, PermissionSubject,
        },
        device::same_uuid,
    },
    infrastructure::relution::RelutionClient,
};
use serde_json::{json, Value};
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};

const WARMUPS: usize = 3;
const REPETITIONS: usize = 10;
const OUTPUT_PATH: &str = "/tmp/appport-catalog-performance.json";

struct Measurement {
    samples_ms: Vec<f64>,
    request_count: usize,
    requests_per_refresh: usize,
    row_ids: Vec<String>,
}

#[test]
#[ignore = "manual synthetic performance evidence"]
fn benchmark_catalog_refresh() {
    let mut results = Vec::new();
    for app_count in [10_usize, 100, 1_000] {
        let serial = measure_serial_reference(app_count);
        let optimized = measure_optimized_catalog(app_count);
        assert_eq!(serial.row_ids, optimized.row_ids);
        assert_eq!(serial.row_ids.len(), app_count);
        results.push(json!({
            "apps": app_count,
            "correctness": {
                "sameOrderedRows": true,
                "rowCount": app_count,
            },
            "serialReference": measurement_json(&serial),
            "optimizedAuthorizedCatalog": measurement_json(&optimized),
        }));
    }

    let report = json!({
        "schemaVersion": 1,
        "workload": {
            "description": "Synthetic authorized catalog with empty inventory and direct-user permission for every app",
            "permissionResponseDelayMs": 1,
            "warmups": WARMUPS,
            "repetitions": REPETITIONS,
            "timingUnit": "milliseconds",
            "timingThresholdEnforced": false,
        },
        "earlierTrueProductionBaseline": {
            "note": "Means captured before the bounded catalog implementation. Distributions were not recorded.",
            "meansMs": {
                "10": 19.681,
                "100": 191.718,
                "1000": 2385.705,
            },
            "requestsPerRefresh": "N + 3",
        },
        "currentComparison": {
            "serialReferenceNote": "Current remeasurement of the former sequential catalog, groups, inventory, and per-app direct-permission request shape; it is representative reference code, not the original production implementation.",
            "optimizedNote": "Current production CatalogService::authorized_catalog path using the same pre-resolved device and synthetic HTTP fixture.",
            "results": results,
        },
    });
    std::fs::write(
        OUTPUT_PATH,
        serde_json::to_vec_pretty(&report).expect("serialize performance report"),
    )
    .expect("write performance report");
    eprintln!("catalog performance report: {OUTPUT_PATH}");
}

fn measure_serial_reference(app_count: usize) -> Measurement {
    measure(app_count, |client| {
        let result = run(serial_reference(client));
        result.expect("serial catalog")
    })
}

fn measure_optimized_catalog(app_count: usize) -> Measurement {
    let (base, requests, handle) = benchmark_server(app_count);
    let service = CatalogService::new(client(base));
    let mut samples_ms = Vec::with_capacity(REPETITIONS);
    let mut row_ids = Vec::new();
    for iteration in 0..(WARMUPS + REPETITIONS) {
        let started = Instant::now();
        let result = run(service.authorized_catalog("token", "user", &device(), "en-US"))
            .expect("optimized catalog");
        let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
        let ids = result
            .rows
            .into_iter()
            .map(|app| app.id)
            .collect::<Vec<_>>();
        if row_ids.is_empty() {
            row_ids = ids.clone();
        }
        assert_eq!(ids, row_ids);
        if iteration >= WARMUPS {
            samples_ms.push(elapsed);
        }
    }
    handle.join().expect("optimized benchmark server");
    finish_measurement(
        app_count,
        samples_ms,
        requests.load(Ordering::SeqCst),
        row_ids,
    )
}

fn measure(
    app_count: usize,
    mut workload: impl FnMut(&Arc<RelutionClient>) -> Vec<String>,
) -> Measurement {
    let (base, requests, handle) = benchmark_server(app_count);
    let client = client(base);
    let mut samples_ms = Vec::with_capacity(REPETITIONS);
    let mut row_ids = Vec::new();
    for iteration in 0..(WARMUPS + REPETITIONS) {
        let started = Instant::now();
        let ids = workload(&client);
        let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
        if row_ids.is_empty() {
            row_ids = ids.clone();
        }
        assert_eq!(ids, row_ids);
        if iteration >= WARMUPS {
            samples_ms.push(elapsed);
        }
    }
    handle.join().expect("serial benchmark server");
    finish_measurement(
        app_count,
        samples_ms,
        requests.load(Ordering::SeqCst),
        row_ids,
    )
}

fn finish_measurement(
    app_count: usize,
    samples_ms: Vec<f64>,
    request_count: usize,
    row_ids: Vec<String>,
) -> Measurement {
    let requests_per_refresh = app_count + 3;
    assert_eq!(
        request_count,
        requests_per_refresh * (WARMUPS + REPETITIONS)
    );
    Measurement {
        samples_ms,
        request_count,
        requests_per_refresh,
        row_ids,
    }
}

fn benchmark_server(
    app_count: usize,
) -> (
    url::Url,
    Arc<std::sync::atomic::AtomicUsize>,
    thread::JoinHandle<()>,
) {
    let body = Arc::new(catalog_body(app_count));
    let expected = (app_count + 3) * (WARMUPS + REPETITIONS);
    concurrent_server(expected, move |request| {
        if request.contains("/content/apps/baseInfo") {
            return Response::json(200, body.as_str());
        }
        if request.contains("/security/users/user/groups") {
            return Response::json(200, r#"{"groups":[]}"#);
        }
        if request.contains("/installedApps/baseInfo/query") {
            return Response::json(200, r#"{"results":[]}"#);
        }
        assert!(request.contains("/permissions/RELEASE"));
        thread::sleep(Duration::from_millis(1));
        Response::json(
            200,
            r#"{"results":[{"read":true,"userGroupInfo":{"uuid":"user","type":"USER"}}]}"#,
        )
    })
}

fn catalog_body(app_count: usize) -> String {
    let entries = (0..app_count)
        .map(|index| (format!("app-{index:04}"), "1".to_owned()))
        .collect::<Vec<_>>();
    let entries = entries
        .iter()
        .map(|(id, version)| (id.as_str(), version.as_str()))
        .collect::<Vec<_>>();
    catalog(&entries).replacen(
        "{\"results\":",
        &format!("{{\"total\":{app_count},\"results\":"),
        1,
    )
}

async fn serial_reference(client: &RelutionClient) -> Result<Vec<String>, Error> {
    let entries = client.catalog("token", "en-US").await?;
    let group_ids = client.user_groups("token", "user").await?;
    let inventory = client.installed_apps("token", &device().id).await?;
    let mut rows = Vec::new();
    for entry in entries {
        let Some(app) = app_from(entry, client.native_app_uuid()) else {
            continue;
        };
        let permissions = client.app_permissions("token", &app.id).await?;
        let allowed = permissions.iter().any(|permission| {
            permission.read
                && match &permission.subject {
                    PermissionSubject::User(id) => same_uuid(id, "user"),
                    PermissionSubject::Group(id) => {
                        group_ids.iter().any(|group| same_uuid(group, id))
                    }
                    PermissionSubject::Other => false,
                }
        });
        if !allowed {
            continue;
        }
        let installed = inventory.iter().find(|item| {
            item.app_id
                .as_deref()
                .is_some_and(|id| same_uuid(id, &app.id))
        });
        if let CatalogInventoryClassification::Visible(app) =
            classify_catalog_inventory(app, installed)?
        {
            rows.push(app.id);
        }
    }
    rows.sort();
    Ok(rows)
}

fn measurement_json(measurement: &Measurement) -> Value {
    let mut sorted = measurement.samples_ms.clone();
    sorted.sort_by(f64::total_cmp);
    let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
    json!({
        "minMs": sorted[0],
        "p50Ms": percentile(&sorted, 50),
        "p95Ms": percentile(&sorted, 95),
        "maxMs": sorted[sorted.len() - 1],
        "meanMs": mean,
        "rawSamplesMs": measurement.samples_ms,
        "requestCount": measurement.request_count,
        "requestsPerRefresh": measurement.requests_per_refresh,
    })
}

fn percentile(sorted: &[f64], percentile: usize) -> f64 {
    let rank = (sorted.len() * percentile).div_ceil(100);
    sorted[rank.saturating_sub(1)]
}
