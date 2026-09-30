//! Bounded response decoding, diagnostic capture, and read-only retry policy.

use super::{transport, MAX_JSON_BYTES};
use crate::error::Error;
use crate::infrastructure::logging;
use serde::de::DeserializeOwned;
use std::time::Duration;

pub(super) enum RequestAttempt<T> {
    Complete(Result<T, Error>),
    Retry,
}

pub(super) struct ResponseDiagnostic<'a> {
    method: String,
    path: &'a str,
}

impl<'a> ResponseDiagnostic<'a> {
    pub(super) fn new(method: &str, path: &'a str) -> Self {
        Self {
            method: method.to_owned(),
            path,
        }
    }
}

pub(super) fn request_attempts(read: bool) -> u32 {
    if read {
        3
    } else {
        1
    }
}

pub(super) async fn response_attempt<T: DeserializeOwned>(
    response: reqwest::Response,
    read: bool,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
) -> RequestAttempt<T> {
    if logging::relution_diagnostics_enabled() {
        return diagnostic_response_attempt(response, read, attempt, diagnostic).await;
    }
    if response.status().is_success() {
        return RequestAttempt::Complete(decode_response(response).await);
    }
    status_response_attempt(
        response.status(),
        can_retry_status(response.status(), read, attempt),
    )
}

async fn diagnostic_response_attempt<T: DeserializeOwned>(
    response: reqwest::Response,
    read: bool,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
) -> RequestAttempt<T> {
    let status_code = response.status();
    if status_code.is_success() && response.content_length().unwrap_or(0) > MAX_JSON_BYTES as u64 {
        return diagnostic_success_too_large(status_code, attempt, diagnostic);
    }
    match read_response_for_diagnostics(response, diagnostic_body_limit(status_code)).await {
        DiagnosticBody::Complete(bytes) => {
            diagnostic_complete_response(status_code, read, attempt, diagnostic, &bytes)
        }
        DiagnosticBody::TooLarge if status_code.is_success() => {
            diagnostic_success_too_large(status_code, attempt, diagnostic)
        }
        DiagnosticBody::TooLarge => diagnostic_error_response(
            status_code,
            read,
            attempt,
            diagnostic,
            b"[response body omitted: diagnostic limit]",
        ),
        DiagnosticBody::Unavailable => diagnostic_error_response(
            status_code,
            read,
            attempt,
            diagnostic,
            b"[response body unavailable]",
        ),
    }
}

fn diagnostic_body_limit(status_code: reqwest::StatusCode) -> usize {
    if status_code.is_success() {
        MAX_JSON_BYTES
    } else {
        logging::MAX_RELUTION_DIAGNOSTIC_BODY_BYTES
    }
}

fn diagnostic_complete_response<T: DeserializeOwned>(
    status_code: reqwest::StatusCode,
    read: bool,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
    bytes: &[u8],
) -> RequestAttempt<T> {
    if status_code.is_success() {
        write_diagnostic_response(diagnostic, status_code, attempt, "complete", bytes);
        return RequestAttempt::Complete(decode_response_bytes(bytes));
    }
    diagnostic_error_response(status_code, read, attempt, diagnostic, bytes)
}

fn diagnostic_success_too_large<T>(
    status_code: reqwest::StatusCode,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
) -> RequestAttempt<T> {
    write_diagnostic_response(
        diagnostic,
        status_code,
        attempt,
        "complete",
        b"[response omitted: exceeds configured JSON limit]",
    );
    RequestAttempt::Complete(Err(Error::server("response is too large")))
}

fn diagnostic_error_response<T>(
    status_code: reqwest::StatusCode,
    read: bool,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
    body: &[u8],
) -> RequestAttempt<T> {
    let retry = can_retry_status(status_code, read, attempt);
    write_diagnostic_response(
        diagnostic,
        status_code,
        attempt,
        if retry { "retry" } else { "complete" },
        body,
    );
    status_response_attempt(status_code, retry)
}

fn write_diagnostic_response(
    diagnostic: &ResponseDiagnostic<'_>,
    status_code: reqwest::StatusCode,
    attempt: u32,
    disposition: &str,
    body: &[u8],
) {
    logging::write_relution_response(
        &diagnostic.method,
        diagnostic.path,
        status_code.as_u16(),
        attempt + 1,
        disposition,
        body,
    );
}

fn status_response_attempt<T>(status_code: reqwest::StatusCode, retry: bool) -> RequestAttempt<T> {
    if retry {
        RequestAttempt::Retry
    } else {
        RequestAttempt::Complete(Err(transport::status(status_code)))
    }
}

async fn read_response_for_diagnostics(
    mut response: reqwest::Response,
    maximum: usize,
) -> DiagnosticBody {
    let mut body = Vec::with_capacity(maximum.saturating_add(1).min(64 * 1024));
    loop {
        let chunk = match response.chunk().await {
            Ok(chunk) => chunk,
            Err(_) => return DiagnosticBody::Unavailable,
        };
        let Some(chunk) = chunk else {
            return DiagnosticBody::Complete(body);
        };
        if extend_bounded(&mut body, &chunk, maximum).is_err() {
            return DiagnosticBody::TooLarge;
        }
    }
}

enum DiagnosticBody {
    Complete(Vec<u8>),
    TooLarge,
    Unavailable,
}

pub(super) fn network_attempt<T>(
    error: reqwest::Error,
    read: bool,
    attempt: u32,
) -> RequestAttempt<T> {
    if read && attempt < 2 {
        RequestAttempt::Retry
    } else {
        RequestAttempt::Complete(Err(transport::network(error)))
    }
}

async fn decode_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, Error> {
    if response.content_length().unwrap_or(0) > MAX_JSON_BYTES as u64 {
        return Err(Error::server("response is too large"));
    }
    let bytes = read_response_at_most(response, MAX_JSON_BYTES).await?;
    decode_response_bytes(&bytes)
}

async fn read_response_at_most(
    mut response: reqwest::Response,
    maximum: usize,
) -> Result<Vec<u8>, Error> {
    let mut body = Vec::with_capacity(maximum.saturating_add(1).min(64 * 1024));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::server("response could not be read"))?
    {
        extend_bounded(&mut body, &chunk, maximum)?;
    }
    Ok(body)
}

fn extend_bounded(body: &mut Vec<u8>, chunk: &[u8], maximum: usize) -> Result<(), Error> {
    let remaining = maximum.saturating_add(1).saturating_sub(body.len());
    if chunk.len() > remaining {
        body.extend_from_slice(&chunk[..remaining]);
        return Err(Error::server("response is too large"));
    }
    body.extend_from_slice(chunk);
    if body.len() > maximum {
        return Err(Error::server("response is too large"));
    }
    Ok(())
}

fn decode_response_bytes<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Error> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err(Error::server("response is too large"));
    }
    serde_json::from_slice(bytes).map_err(|_| Error::server("invalid Relution response"))
}

fn can_retry_status(status_code: reqwest::StatusCode, read: bool, attempt: u32) -> bool {
    read && attempt < 2 && matches!(status_code.as_u16(), 429 | 502 | 503 | 504)
}

pub(super) async fn retry_after(attempt: u32) {
    tokio::time::sleep(Duration::from_millis(150 * (1 << attempt))).await
}

#[cfg(test)]
mod tests {
    use super::{
        decode_response_bytes, diagnostic_response_attempt, read_response_at_most, RequestAttempt,
        ResponseDiagnostic, MAX_JSON_BYTES,
    };
    use crate::{
        error::Error,
        infrastructure::{logging, relution::transport::status},
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    use url::Url;

    #[test]
    fn diagnostic_mode_uses_the_same_json_deserialization() {
        let body = br#"{"message":"forbidden","items":[1,2]}"#;
        let decoded: serde_json::Value = decode_response_bytes(body).unwrap();
        let direct: serde_json::Value = serde_json::from_slice(body).unwrap();
        assert_eq!(decoded, direct);
    }

    #[test]
    fn chunked_success_over_the_json_limit_keeps_the_existing_error() {
        let (url, server) = chunked_server(200, vec![b'x'; MAX_JSON_BYTES + 1]);
        let result = run(async {
            let response = reqwest::Client::new().get(url).send().await.unwrap();
            diagnostic_response_attempt::<serde_json::Value>(response, true, 0, &diagnostic()).await
        });
        server.join().unwrap();
        assert_complete_error(result, Error::server("response is too large"));
    }

    #[test]
    fn direct_json_reads_stop_after_limit_plus_one_bytes() {
        let (url, server) = chunked_server(200, vec![b'x'; MAX_JSON_BYTES + 4096]);
        let result = run(async {
            let response = reqwest::Client::new().get(url).send().await.unwrap();
            read_response_at_most(response, MAX_JSON_BYTES).await
        });
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), Error::server("response is too large"));
    }

    #[test]
    fn oversized_retryable_bodies_remain_bounded_across_attempts() {
        for attempt in 0..3 {
            let (url, server) = chunked_server(
                503,
                vec![b'x'; logging::MAX_RELUTION_DIAGNOSTIC_BODY_BYTES + 1],
            );
            let result = run(async {
                let response = reqwest::Client::new().get(url).send().await.unwrap();
                diagnostic_response_attempt::<serde_json::Value>(
                    response,
                    true,
                    attempt,
                    &diagnostic(),
                )
                .await
            });
            server.join().unwrap();
            if attempt < 2 {
                assert!(matches!(result, RequestAttempt::Retry));
            } else {
                assert_complete_error(result, status(reqwest::StatusCode::SERVICE_UNAVAILABLE));
            }
        }
    }

    fn diagnostic() -> ResponseDiagnostic<'static> {
        ResponseDiagnostic::new("GET", "/api/management/v1/devices/device/actions")
    }

    fn assert_complete_error(result: RequestAttempt<serde_json::Value>, expected: Error) {
        match result {
            RequestAttempt::Complete(Err(error)) => assert_eq!(error, expected),
            RequestAttempt::Complete(Ok(_)) => panic!("expected an error response"),
            RequestAttempt::Retry => panic!("expected a complete response"),
        }
    }

    fn chunked_server(status: u16, body: Vec<u8>) -> (Url, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status} Test\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:X}\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
            stream.write_all(b"\r\n0\r\n\r\n").unwrap();
        });
        (
            Url::parse(&format!("http://{address}/api/management/v1/test")).unwrap(),
            server,
        )
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }
}
