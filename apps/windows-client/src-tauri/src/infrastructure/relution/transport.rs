//! Fixed-origin Relution transport with bounded response reads.

use super::{dto, response, RelutionClient, MAX_PAGES, PAGE_SIZE};
use reqwest::{header, Method};
use serde::de::DeserializeOwned;
use serde_json::json;
use url::Url;

impl RelutionClient {
    pub(crate) async fn assigned_devices(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<Vec<dto::Device>, String> {
        self.post_pages("/api/management/v2/devices/baseInfo/query", token, json!({"filter":{"type":"logOp","operation":"AND","filters":[{"type":"string","fieldName":"userUuid","value":user_uuid},{"type":"stringEnum","fieldName":"platform","values":["WINDOWS"]}]},"getItems":true,"getNonpagedCount":true})).await
    }
    pub(crate) async fn catalog(
        &self,
        token: &str,
        locale: &str,
    ) -> Result<Vec<dto::Catalog>, String> {
        self.get_pages(
            "/api/management/v1/content/apps/baseInfo",
            token,
            vec![("locale", locale)],
        )
        .await
    }
    pub(crate) async fn user_groups(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<dto::Groups, String> {
        self.get(
            format!(
                "/api/management/v1/security/users/{}/groups",
                encode(user_uuid)
            ),
            token,
            vec![],
        )
        .await
    }
    pub(crate) async fn installed_apps(
        &self,
        token: &str,
        device_id: &str,
    ) -> Result<Vec<dto::Inventory>, String> {
        self.post_pages(
            &format!(
                "/api/management/v2/devices/{}/installedApps/baseInfo/query",
                encode(device_id)
            ),
            token,
            json!({"getItems":true,"getNonpagedCount":true}),
        )
        .await
    }
    pub(crate) async fn app_permissions(
        &self,
        token: &str,
        app_id: &str,
    ) -> Result<dto::Page<dto::Permission>, String> {
        self.get(
            &format!(
                "/api/management/v1/content/apps/{}/permissions/RELEASE",
                encode(app_id)
            ),
            token,
            vec![],
        )
        .await
    }
    pub(crate) async fn group_members(
        &self,
        token: &str,
        group_id: &str,
    ) -> Result<Vec<dto::Group>, String> {
        self.get_pages(
            &format!(
                "/api/management/v1/security/groups/{}/members",
                encode(group_id)
            ),
            token,
            vec![("recursive", "true")],
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
        for attempt in 0..response::request_attempts(read) {
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
                response::RequestAttempt::Complete(result) => return result,
                response::RequestAttempt::Retry => response::retry_after(attempt).await,
            }
        }
        Err("offline: Relution is unreachable".into())
    }

    async fn request_attempt<T: DeserializeOwned>(
        &self,
        input: RequestInput<'_>,
        read: bool,
        attempt: u32,
    ) -> response::RequestAttempt<T> {
        let diagnostic = response::ResponseDiagnostic::new(input.method.as_str(), input.path);
        match self.send_request(input).await {
            Ok(http_response) => {
                response::response_attempt(http_response, read, attempt, &diagnostic).await
            }
            Err(SendFailure::Network(error)) => response::network_attempt(error, read, attempt),
            Err(SendFailure::Path(error)) => response::RequestAttempt::Complete(Err(error)),
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

pub(super) fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(super) fn network(error: reqwest::Error) -> String {
    if error.is_connect() || error.is_timeout() {
        "offline: Relution is unreachable".into()
    } else {
        "server: Relution request failed".into()
    }
}

pub(super) fn status(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "session-expired: authorization required".into(),
        403 => "authorization: account or token lacks required Relution access".into(),
        _ => "server: Relution request failed after submission may have occurred".into(),
    }
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

fn append_query(url: &mut Url, query: &[(&str, &str)], tenant: &str) {
    let mut pairs = url.query_pairs_mut();
    for (key, value) in query {
        pairs.append_pair(key, value);
    }
    pairs.append_pair("tenantOrganizationUuid", tenant);
}
