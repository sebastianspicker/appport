//! Journal classification of a single deployment POST outcome by typed error kind.

use super::ActionService;
use crate::{
    application::{
        action_test_support::{journal_environment, JournalSandbox},
        catalog::CatalogService,
        test_support::run,
    },
    domain::action::{Intent, Reservation, State},
    error::{Error, ErrorKind},
    infrastructure::{
        journal::ActionJournal,
        relution::{RelutionClient, RelutionConfig},
    },
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

enum Reply {
    Status(u16, &'static str),
    Stall,
}

fn client(base: url::Url) -> Arc<RelutionClient> {
    Arc::new(
        RelutionClient::with_timeout(
            RelutionConfig {
                base,
                organization_uuid: "tenant".into(),
                native_app_uuid: "native".into(),
                writes_enabled: true,
            },
            Duration::from_millis(200),
        )
        .expect("client"),
    )
}

fn service(client: &Arc<RelutionClient>) -> ActionService {
    ActionService::new(
        Arc::clone(client),
        Arc::new(CatalogService::new(Arc::clone(client))),
    )
}

fn reserve(id: &str, app: &str) {
    run(ActionJournal::new().reserve(Reservation {
        id,
        tenant: "tenant",
        device: "device",
        app,
        version: "version",
        package: None,
        intent: Intent::Install,
        baseline: "",
    }))
    .expect("reserve before deployment");
}

fn saved(id: &str) -> (State, Option<String>) {
    let action = run(ActionJournal::new().action(id))
        .expect("journal read")
        .expect("saved action");
    (action.state, action.error_code)
}

/// Serves one connection, then counts any further connection attempts for a grace period.
fn single_post_server(reply: Reply) -> (url::Url, thread::JoinHandle<usize>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let address = listener.local_addr().expect("mock address");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("deployment request");
        let mut request = [0_u8; 16 * 1024];
        let bytes = stream.read(&mut request).expect("read deployment request");
        assert!(std::str::from_utf8(&request[..bytes])
            .expect("HTTP text")
            .starts_with("POST /api/management/v1/content/apps/app/versions/version/deployments"));
        match reply {
            Reply::Status(status, body) => write!(
                stream,
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("write deployment response"),
            Reply::Stall => thread::sleep(Duration::from_millis(600)),
        }
        drop(stream);
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let mut connections = 1;
        let deadline = Instant::now() + Duration::from_millis(300);
        while Instant::now() < deadline {
            if listener.accept().is_ok() {
                connections += 1;
            }
            thread::sleep(Duration::from_millis(10));
        }
        connections
    });
    (
        url::Url::parse(&format!("http://{address}/")).expect("mock URL"),
        handle,
    )
}

#[test]
fn only_session_expiry_and_device_mismatch_reject_a_submission() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let client = client(url::Url::parse("http://127.0.0.1:9/").expect("unused URL"));
    let service = service(&client);
    for (index, kind) in ErrorKind::ALL.into_iter().enumerate() {
        let id = format!("action-{index}");
        reserve(&id, &format!("app-{index}"));
        let error = Error::new(kind, "sample detail");
        let result = run(service.record_submission(&id, Err(error.clone())));
        match kind {
            ErrorKind::SessionExpired | ErrorKind::DeviceMatchFailed => {
                assert_eq!(result, Err(error), "{kind:?}");
                assert_eq!(
                    saved(&id),
                    (State::Failed, Some("SUBMISSION_REJECTED".into())),
                    "{kind:?}"
                );
            }
            _ => {
                assert_eq!(result, Ok(()), "{kind:?}");
                assert_eq!(
                    saved(&id),
                    (State::Unknown, Some("SUBMISSION_UNCERTAIN".into())),
                    "{kind:?}"
                );
            }
        }
    }
}

#[test]
fn a_single_failed_deployment_post_is_classified_by_kind_and_never_retried() {
    let _environment = journal_environment();
    let _sandbox = JournalSandbox::new();
    let cases = [
        (Reply::Stall, ErrorKind::Offline, State::Unknown),
        (Reply::Status(503, "{}"), ErrorKind::Server, State::Unknown),
        (
            Reply::Status(200, "not json"),
            ErrorKind::Server,
            State::Unknown,
        ),
        (
            Reply::Status(403, "{}"),
            ErrorKind::Authorization,
            State::Unknown,
        ),
        (
            Reply::Status(401, "{}"),
            ErrorKind::SessionExpired,
            State::Failed,
        ),
    ];
    for (index, (reply, kind, state)) in cases.into_iter().enumerate() {
        let (base, server) = single_post_server(reply);
        let client = client(base);
        let service = service(&client);
        let id = format!("action-{index}");
        reserve(&id, &format!("app-{index}"));

        let response = run(client.deploy("token", "app", "version", "device"));
        assert_eq!(
            response.as_ref().map_err(Error::kind).err(),
            Some(kind),
            "{kind:?}"
        );
        let result = run(service.record_submission(&id, response));

        assert_eq!(server.join().expect("mock server"), 1, "{kind:?}");
        assert_eq!(result.is_err(), state == State::Failed, "{kind:?}");
        assert_eq!(saved(&id).0, state, "{kind:?}");
    }
}
