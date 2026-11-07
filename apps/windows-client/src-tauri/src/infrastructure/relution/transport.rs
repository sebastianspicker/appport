//! Fixed-origin Relution transport with bounded response reads.

use super::{
    dto, response, RelutionClient, MAX_JSON_BYTES, MAX_PAGES, MAX_PAGINATED_JSON_BYTES, PAGE_SIZE,
};
use crate::domain::{
    catalog::{AppPermission, CatalogEntry, InstalledApp},
    device::{same_uuid, AssignedDevice},
};
use crate::error::Error;
use reqwest::{header, Method};
use serde::de::DeserializeOwned;
use serde_json::json;
use url::Url;

impl RelutionClient {
    pub(crate) async fn assigned_devices(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<Vec<AssignedDevice>, Error> {
        let devices: Vec<dto::Device> = self.post_pages("/api/management/v2/devices/baseInfo/query", token, json!({"filter":{"type":"logOp","operation":"AND","filters":[{"type":"string","fieldName":"userUuid","value":user_uuid},{"type":"stringEnum","fieldName":"platform","values":["WINDOWS"]}]},"getItems":true,"getNonpagedCount":true})).await?;
        Ok(devices
            .into_iter()
            .map(dto::Device::into_assigned_device)
            .collect())
    }
    pub(crate) async fn catalog(
        &self,
        token: &str,
        locale: &str,
    ) -> Result<Vec<CatalogEntry>, Error> {
        let entries: Vec<dto::Catalog> = self
            .get_pages(
                "/api/management/v1/content/apps/baseInfo",
                token,
                vec![("locale", locale)],
            )
            .await?;
        Ok(entries
            .into_iter()
            .map(dto::Catalog::into_catalog_entry)
            .collect())
    }
    pub(crate) async fn user_groups(
        &self,
        token: &str,
        user_uuid: &str,
    ) -> Result<Vec<String>, Error> {
        let groups: dto::Groups = self
            .get(
                format!(
                    "/api/management/v1/security/users/{}/groups",
                    encode(user_uuid)
                ),
                token,
                vec![],
            )
            .await?;
        Ok(groups.groups.into_iter().map(|group| group.uuid).collect())
    }
    pub(crate) async fn installed_apps(
        &self,
        token: &str,
        device_id: &str,
    ) -> Result<Vec<InstalledApp>, Error> {
        let items: Vec<dto::Inventory> = self
            .post_pages(
                &format!(
                    "/api/management/v2/devices/{}/installedApps/baseInfo/query",
                    encode(device_id)
                ),
                token,
                json!({"getItems":true,"getNonpagedCount":true}),
            )
            .await?;
        Ok(items
            .into_iter()
            .map(dto::Inventory::into_installed_app)
            .collect())
    }
    pub(crate) async fn app_permissions(
        &self,
        token: &str,
        app_id: &str,
    ) -> Result<Vec<AppPermission>, Error> {
        let page: dto::Page<dto::Permission> = self
            .get(
                &format!(
                    "/api/management/v1/content/apps/{}/permissions/RELEASE",
                    encode(app_id)
                ),
                token,
                vec![],
            )
            .await?;
        Ok(page
            .results
            .into_iter()
            .map(dto::Permission::into_app_permission)
            .collect())
    }
    /// Pages the recursive member list only until the user is found.
    pub(crate) async fn group_contains_user(
        &self,
        token: &str,
        group_id: &str,
        user_uuid: &str,
    ) -> Result<bool, Error> {
        let members: Vec<dto::Group> = self
            .get_pages_until(
                &format!(
                    "/api/management/v1/security/groups/{}/members",
                    encode(group_id)
                ),
                token,
                vec![("recursive", "true")],
                |member: &dto::Group| same_uuid(&member.uuid, user_uuid),
            )
            .await?;
        Ok(members
            .iter()
            .any(|member| same_uuid(&member.uuid, user_uuid)))
    }
    pub(super) async fn get_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<Vec<T>, Error> {
        self.get_pages_until(p, t, q, |_| false).await
    }
    async fn get_pages_until<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        q: Vec<(&str, &str)>,
        found: impl Fn(&T) -> bool,
    ) -> Result<Vec<T>, Error> {
        let mut out = vec![];
        let mut budget = PaginationBudget::default();
        for _ in 0..MAX_PAGES {
            let mut x = q.clone();
            x.extend([("getItems", "true"), ("getNonpagedCount", "true")]);
            let page: response::DecodedResponse<dto::PaginatedPage<T>> = self
                .request_decoded(
                    Method::GET,
                    p,
                    t,
                    None,
                    x.into_iter()
                        .chain([
                            ("limit", &PAGE_SIZE.to_string()[..]),
                            ("offset", &out.len().to_string()[..]),
                        ])
                        .collect(),
                    ResponsePolicy::paginated(budget.response_limit()?),
                )
                .await?;
            let before = out.len();
            if budget.append_page(&mut out, page)? || out[before..].iter().any(&found) {
                return Ok(out);
            }
        }
        pagination_limit_error()
    }
    pub(super) async fn post_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<Vec<T>, Error> {
        let mut out = vec![];
        let mut budget = PaginationBudget::default();
        for _ in 0..MAX_PAGES {
            let mut b = b.clone();
            b["limit"] = json!(PAGE_SIZE);
            b["offset"] = json!(out.len());
            let page: response::DecodedResponse<dto::PaginatedPage<T>> = self
                .request_decoded(
                    Method::POST,
                    p,
                    t,
                    Some(b),
                    vec![],
                    ResponsePolicy::paginated(budget.response_limit()?),
                )
                .await?;
            if budget.append_page(&mut out, page)? {
                return Ok(out);
            }
        }
        pagination_limit_error()
    }
    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        p: impl AsRef<str>,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<T, Error> {
        self.request(Method::GET, p.as_ref(), t, None, q).await
    }
    pub(super) async fn post_once<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        b: serde_json::Value,
    ) -> Result<T, Error> {
        self.request(Method::POST, p, t, Some(b), vec![]).await
    }
    async fn request<T: DeserializeOwned>(
        &self,
        m: Method,
        p: &str,
        t: &str,
        b: Option<serde_json::Value>,
        q: Vec<(&str, &str)>,
    ) -> Result<T, Error> {
        self.request_decoded(m, p, t, b, q, ResponsePolicy::standard())
            .await
            .map(|response| response.value)
    }

    async fn request_decoded<T: DeserializeOwned>(
        &self,
        m: Method,
        p: &str,
        t: &str,
        b: Option<serde_json::Value>,
        q: Vec<(&str, &str)>,
        policy: ResponsePolicy,
    ) -> Result<response::DecodedResponse<T>, Error> {
        let read = m == Method::GET || policy.retry_post;
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
                    policy,
                )
                .await
            {
                response::RequestAttempt::Complete(result) => return result,
                response::RequestAttempt::Retry => response::retry_after(attempt).await,
            }
        }
        Err(Error::offline("Relution is unreachable"))
    }

    async fn request_attempt<T: DeserializeOwned>(
        &self,
        input: RequestInput<'_>,
        read: bool,
        attempt: u32,
        policy: ResponsePolicy,
    ) -> response::RequestAttempt<response::DecodedResponse<T>> {
        let diagnostic = response::ResponseDiagnostic::new(input.method.as_str(), input.path);
        match self.send_request(input).await {
            Ok(http_response) => {
                response::response_attempt(
                    http_response,
                    read,
                    attempt,
                    &diagnostic,
                    policy.maximum,
                    policy.log_success_body,
                )
                .await
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
    pub(super) fn url(&self, p: &str) -> Result<Url, Error> {
        if !p.starts_with("/api/") {
            return Err(Error::server("invalid Relution API path"));
        }
        let u = self
            .config
            .base
            .join(p)
            .map_err(|_| Error::server("invalid Relution API path"))?;
        if u.origin() != self.config.base.origin() {
            return Err(Error::server("Relution origin changed"));
        }
        Ok(u)
    }
}

fn pagination_limit_error<T>() -> Result<Vec<T>, Error> {
    Err(Error::server(
        "Relution pagination exceeded the configured limit",
    ))
}

#[derive(Default)]
struct PaginationBudget {
    encoded_bytes: usize,
}

impl PaginationBudget {
    fn remaining(&self) -> Result<usize, Error> {
        MAX_PAGINATED_JSON_BYTES
            .checked_sub(self.encoded_bytes)
            .filter(|remaining| *remaining > 0)
            .ok_or_else(|| Error::server("Relution pagination exceeded the response byte limit"))
    }

    fn response_limit(&self) -> Result<usize, Error> {
        Ok(MAX_JSON_BYTES.min(self.remaining()?))
    }

    fn append_page<T>(
        &mut self,
        items: &mut Vec<T>,
        response: response::DecodedResponse<dto::PaginatedPage<T>>,
    ) -> Result<bool, Error> {
        self.encoded_bytes = self
            .encoded_bytes
            .checked_add(response.encoded_bytes)
            .filter(|total| *total <= MAX_PAGINATED_JSON_BYTES)
            .ok_or_else(|| Error::server("Relution pagination exceeded the response byte limit"))?;
        let total = response.value.total;
        let page_len = response.value.results.len();
        items.extend(response.value.results);
        // A server may cap `limit` below PAGE_SIZE, so only `total` can say a short page is the last.
        Ok(match total {
            Some(total) => page_len == 0 || items.len() as u64 >= total,
            None => page_len < PAGE_SIZE,
        })
    }
}

pub(super) fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(super) fn network(error: reqwest::Error) -> Error {
    if error.is_connect() || error.is_timeout() {
        Error::offline("Relution is unreachable")
    } else {
        Error::server("Relution request failed")
    }
}

pub(super) fn status(status: reqwest::StatusCode) -> Error {
    match status.as_u16() {
        401 => Error::session_expired("authorization required"),
        403 => Error::authorization("account or token lacks required Relution access"),
        _ => Error::server("Relution request failed after submission may have occurred"),
    }
}

struct RequestInput<'a> {
    method: Method,
    path: &'a str,
    token: &'a str,
    body: Option<serde_json::Value>,
    query: &'a [(&'a str, &'a str)],
}

#[derive(Clone, Copy)]
struct ResponsePolicy {
    maximum: usize,
    log_success_body: bool,
    /// Paginated POSTs are read-only queries, so they get the read retry policy.
    retry_post: bool,
}

impl ResponsePolicy {
    const fn standard() -> Self {
        Self {
            maximum: MAX_JSON_BYTES,
            log_success_body: true,
            retry_post: false,
        }
    }

    const fn paginated(maximum: usize) -> Self {
        Self {
            maximum,
            log_success_body: false,
            retry_post: true,
        }
    }
}

enum SendFailure {
    Network(reqwest::Error),
    Path(Error),
}

fn append_query(url: &mut Url, query: &[(&str, &str)], tenant: &str) {
    let mut pairs = url.query_pairs_mut();
    for (key, value) in query {
        pairs.append_pair(key, value);
    }
    pairs.append_pair("tenantOrganizationUuid", tenant);
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
