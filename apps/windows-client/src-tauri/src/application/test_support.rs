//! Shared application-test runtime, HTTP server, and Relution client fixtures.

use crate::infrastructure::relution::{RelutionClient, RelutionConfig};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
};
use url::Url;

pub(crate) struct Response {
    pub(crate) status: u16,
    pub(crate) content_type: &'static str,
    pub(crate) body: String,
}

impl Response {
    pub(crate) fn json(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: body.into(),
        }
    }
}

pub(crate) fn server(
    expected: usize,
    response: impl Fn(&str) -> Response + Send + 'static,
) -> (Url, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let address = listener.local_addr().expect("mock address");
    let requests = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&requests);
    let handle = thread::spawn(move || {
        for _ in 0..expected {
            respond_to_request(&listener, &response, &count);
        }
    });
    (
        Url::parse(&format!("http://{address}/")).expect("mock URL"),
        requests,
        handle,
    )
}

fn respond_to_request(
    listener: &TcpListener,
    response: &impl Fn(&str) -> Response,
    count: &AtomicUsize,
) {
    let (mut stream, _) = listener.accept().expect("mock request");
    let mut request = [0_u8; 16 * 1024];
    let bytes = stream.read(&mut request).expect("read mock request");
    let response = response(std::str::from_utf8(&request[..bytes]).expect("HTTP text"));
    count.fetch_add(1, Ordering::SeqCst);
    write!(
        stream,
        "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response.status,
        response.content_type,
        response.body.len(),
        response.body
    )
    .expect("write mock response");
}

pub(crate) fn client(base: Url, writes_enabled: bool) -> Arc<RelutionClient> {
    Arc::new(
        RelutionClient::new(RelutionConfig {
            base,
            organization_uuid: "tenant".into(),
            native_app_uuid: "native".into(),
            writes_enabled,
        })
        .expect("client"),
    )
}

pub(crate) fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
}
