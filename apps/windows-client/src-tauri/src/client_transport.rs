use super::*;

impl RelutionClient {
    pub(super) async fn current_device(&self, t: &str, u: &str) -> Result<CurrentDevice, String> {
        let ev = evidence::collect()?;
        let ds:Vec<dto::Device>=self.post_pages("/api/management/v2/devices/baseInfo/query",t,json!({"filter":{"type":"logOp","operation":"AND","filters":[{"type":"string","fieldName":"userUuid","value":u},{"type":"stringEnum","fieldName":"platform","values":["WINDOWS"]}]},"getItems":true,"getNonpagedCount":true})).await?;
        let valid: Vec<_> = ds
            .into_iter()
            .filter(|x| {
                same_uuid(&x.user_uuid, u)
                    && same_uuid(&x.organization_uuid, &self.config.organization_uuid)
                    && x.platform.eq_ignore_ascii_case("WINDOWS")
                    && ["COMPLIANT", "NONCOMPLIANT", "INACTIVE"]
                        .iter()
                        .any(|status| x.status.eq_ignore_ascii_case(status))
            })
            .collect();
        let d = match_device(&ev, &valid)?;
        Ok(CurrentDevice {
            id: d.uuid.clone(),
            wire: NativeDevice {
                name: d.name.clone(),
                status: d.status.clone(),
                last_seen_at: None,
            },
        })
    }
    pub(super) async fn device_actions(
        &self,
        t: &str,
        d: &str,
    ) -> Result<Vec<dto::DeviceAction>, String> {
        self.get_pages(
            &format!("/api/management/v1/devices/{}/actions", encode(d)),
            t,
            vec![],
        )
        .await
    }
    pub(super) async fn get_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<Vec<T>, String> {
        let mut out = vec![];
        for n in 0..MAX_PAGES {
            let mut x = q.clone();
            x.extend([("getItems", "true"), ("getNonpagedCount", "true")]);
            let page: dto::Page<T> = self
                .get(
                    p,
                    t,
                    x.into_iter()
                        .chain([
                            ("limit", &PAGE_SIZE.to_string()[..]),
                            ("offset", &(n * PAGE_SIZE).to_string()[..]),
                        ])
                        .collect(),
                )
                .await?;
            if append_page(&mut out, page) {
                return Ok(out);
            }
        }
        Err("server: Relution pagination exceeded the configured limit".into())
    }
    pub(super) async fn post_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<Vec<T>, String> {
        let mut out = vec![];
        for n in 0..MAX_PAGES {
            let mut b = b.clone();
            b["limit"] = json!(PAGE_SIZE);
            b["offset"] = json!(n * PAGE_SIZE);
            let page: dto::Page<T> = self.post_once(p, t, b).await?;
            if append_page(&mut out, page) {
                return Ok(out);
            }
        }
        Err("server: Relution pagination exceeded the configured limit".into())
    }
    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        p: impl AsRef<str>,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<T, String> {
        self.request(Method::GET, p.as_ref(), t, None, q).await
    }
    pub(super) async fn post_once<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<T, String> {
        self.request(Method::POST, p, t, Some(b), vec![]).await
    }
    async fn request<T: DeserializeOwned>(
        &self,
        m: Method,
        p: &str,
        t: &str,
        b: Option<serde_json::Value>,
        q: Vec<(&str, &str)>,
    ) -> Result<T, String> {
        let read = m == Method::GET;
        for attempt in 0..request_attempts(read) {
            match self
                .request_attempt(
                    RequestInput {
                        method: m.clone(),
                        path: p,
                        token: t,
                        body: b.clone(),
                        query: &q,
                    },
                    read,
                    attempt,
                )
                .await
            {
                RequestAttempt::Complete(result) => return result,
                RequestAttempt::Retry => retry_after(attempt).await,
            }
        }
        Err("offline: Relution is unreachable".into())
    }

    async fn request_attempt<T: DeserializeOwned>(
        &self,
        input: RequestInput<'_>,
        read: bool,
        attempt: u32,
    ) -> RequestAttempt<T> {
        let diagnostic = ResponseDiagnostic {
            method: input.method.as_str().to_owned(),
            path: input.path,
        };
        match self.send_request(input).await {
            Ok(response) => response_attempt(response, read, attempt, &diagnostic).await,
            Err(SendFailure::Network(error)) => network_attempt(error, read, attempt),
            Err(SendFailure::Path(error)) => RequestAttempt::Complete(Err(error)),
        }
    }

    async fn send_request(
        &self,
        input: RequestInput<'_>,
    ) -> Result<reqwest::Response, SendFailure> {
        let mut url = self.url(input.path).map_err(SendFailure::Path)?;
        append_query(&mut url, input.query, &self.config.organization_uuid);
        let mut request = self
            .http
            .request(input.method, url)
            .header("X-User-Access-Token", input.token)
            .header(header::ACCEPT, "application/json")
            .header("tenantOrganizationUuid", &self.config.organization_uuid);
        if let Some(body) = input.body {
            request = request.json(&body);
        }
        request.send().await.map_err(SendFailure::Network)
    }
    pub(super) fn url(&self, p: &str) -> Result<Url, String> {
        if !p.starts_with("/api/") {
            return Err("server: invalid Relution API path".into());
        }
        let u = self
            .config
            .base
            .join(p)
            .map_err(|_| "server: invalid Relution API path")?;
        if u.origin() != self.config.base.origin() {
            return Err("server: Relution origin changed".into());
        }
        Ok(u)
    }
}

fn append_page<T>(items: &mut Vec<T>, page: dto::Page<T>) -> bool {
    let total = page.total;
    let page_len = page.results.len();
    items.extend(page.results);
    page_len < PAGE_SIZE || total.is_some_and(|total| items.len() as u64 >= total)
}

enum RequestAttempt<T> {
    Complete(Result<T, String>),
    Retry,
}

struct RequestInput<'a> {
    method: Method,
    path: &'a str,
    token: &'a str,
    body: Option<serde_json::Value>,
    query: &'a [(&'a str, &'a str)],
}

struct ResponseDiagnostic<'a> {
    method: String,
    path: &'a str,
}

enum SendFailure {
    Network(reqwest::Error),
    Path(String),
}

fn request_attempts(read: bool) -> u32 {
    if read {
        3
    } else {
        1
    }
}

async fn response_attempt<T: DeserializeOwned>(
    response: reqwest::Response,
    read: bool,
    attempt: u32,
    diagnostic: &ResponseDiagnostic<'_>,
) -> RequestAttempt<T> {
    if crate::logging::relution_diagnostics_enabled() {
        return diagnostic_response_attempt(response, read, attempt, diagnostic).await;
    }
    if response.status().is_success() {
        return RequestAttempt::Complete(decode_response(response).await);
    }
    if can_retry_status(response.status(), read, attempt) {
        RequestAttempt::Retry
    } else {
        RequestAttempt::Complete(Err(status(response.status())))
    }
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
        crate::logging::MAX_RELUTION_DIAGNOSTIC_BODY_BYTES
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
    RequestAttempt::Complete(Err("server: response is too large".into()))
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
    crate::logging::write_relution_response(
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
        RequestAttempt::Complete(Err(status(status_code)))
    }
}

async fn read_response_for_diagnostics(
    mut response: reqwest::Response,
    maximum: usize,
) -> DiagnosticBody {
    let mut body = Vec::new();
    loop {
        let chunk = match response.chunk().await {
            Ok(chunk) => chunk,
            Err(_) => return DiagnosticBody::Unavailable,
        };
        let Some(chunk) = chunk else {
            return DiagnosticBody::Complete(body);
        };
        if body.len().saturating_add(chunk.len()) > maximum {
            return DiagnosticBody::TooLarge;
        }
        body.extend_from_slice(&chunk);
    }
}

enum DiagnosticBody {
    Complete(Vec<u8>),
    TooLarge,
    Unavailable,
}

fn network_attempt<T>(error: reqwest::Error, read: bool, attempt: u32) -> RequestAttempt<T> {
    if read && attempt < 2 {
        RequestAttempt::Retry
    } else {
        RequestAttempt::Complete(Err(network(error)))
    }
}

async fn decode_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    if response.content_length().unwrap_or(0) > MAX_JSON_BYTES as u64 {
        return Err("server: response is too large".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "server: response could not be read")?;
    decode_response_bytes(&bytes)
}

fn decode_response_bytes<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err("server: response is too large".into());
    }
    serde_json::from_slice(bytes).map_err(|_| "server: invalid Relution response".into())
}

fn can_retry_status(status_code: reqwest::StatusCode, read: bool, attempt: u32) -> bool {
    read && attempt < 2 && matches!(status_code.as_u16(), 429 | 502 | 503 | 504)
}

async fn retry_after(attempt: u32) {
    tokio::time::sleep(Duration::from_millis(150 * (1 << attempt))).await
}

fn append_query(url: &mut Url, query: &[(&str, &str)], tenant: &str) {
    let mut pairs = url.query_pairs_mut();
    for (key, value) in query {
        pairs.append_pair(key, value);
    }
    pairs.append_pair("tenantOrganizationUuid", tenant);
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

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
        assert_complete_error(result, "server: response is too large");
    }

    #[test]
    fn oversized_retryable_bodies_remain_bounded_across_attempts() {
        for attempt in 0..3 {
            let (url, server) = chunked_server(
                503,
                vec![b'x'; crate::logging::MAX_RELUTION_DIAGNOSTIC_BODY_BYTES + 1],
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
                assert_complete_error(result, &status(reqwest::StatusCode::SERVICE_UNAVAILABLE));
            }
        }
    }

    fn diagnostic() -> ResponseDiagnostic<'static> {
        ResponseDiagnostic {
            method: "GET".into(),
            path: "/api/management/v1/devices/device/actions",
        }
    }

    fn assert_complete_error(result: RequestAttempt<serde_json::Value>, expected: &str) {
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
