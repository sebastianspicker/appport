use super::*;

impl RelutionClient {
    pub(super) async fn current_device(&self, t: &str, u: &str) -> Result<CurrentDevice, String> {
        let ev = evidence::collect()?;
        let ds:Vec<dto::Device>=self.post_pages("/api/management/v2/devices/baseInfo/query",t,json!({"filter":{"type":"logOp","operation":"AND","filters":[{"type":"string","fieldName":"userUuid","value":u},{"type":"stringEnum","fieldName":"platform","values":["WINDOWS"]}]},"getItems":true,"getNonpagedCount":true})).await?;
        let valid: Vec<_> = ds
            .into_iter()
            .filter(|x| {
                x.user_uuid == u
                    && x.organization_uuid == self.config.organization_uuid
                    && x.platform == "WINDOWS"
                    && matches!(x.status.as_str(), "COMPLIANT" | "NONCOMPLIANT" | "INACTIVE")
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
        match self.send_request(input).await {
            Ok(response) => response_attempt(response, read, attempt).await,
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
) -> RequestAttempt<T> {
    if response.status().is_success() {
        return RequestAttempt::Complete(decode_response(response).await);
    }
    if can_retry_status(response.status(), read, attempt) {
        RequestAttempt::Retry
    } else {
        RequestAttempt::Complete(Err(status(response.status())))
    }
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
    if bytes.len() > MAX_JSON_BYTES {
        return Err("server: response is too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "server: invalid Relution response".into())
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
