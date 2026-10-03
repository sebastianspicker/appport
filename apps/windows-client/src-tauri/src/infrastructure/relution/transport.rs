//! Fixed-origin Relution transport with bounded response reads.

use super::{
    dto, response, RelutionClient, MAX_JSON_BYTES, MAX_PAGES, MAX_PAGINATED_JSON_BYTES, PAGE_SIZE,
};
use crate::domain::{
    catalog::{AppPermission, CatalogEntry, InstalledApp},
    device::AssignedDevice,
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
    pub(crate) async fn group_members(
        &self,
        token: &str,
        group_id: &str,
    ) -> Result<Vec<String>, Error> {
        let members: Vec<dto::Group> = self
            .get_pages(
                &format!(
                    "/api/management/v1/security/groups/{}/members",
                    encode(group_id)
                ),
                token,
                vec![("recursive", "true")],
            )
            .await?;
        Ok(members.into_iter().map(|member| member.uuid).collect())
    }
    pub(super) async fn get_pages<T: DeserializeOwned>(
        &self,
        p: &str,
        t: &str,
        q: Vec<(&str, &str)>,
    ) -> Result<Vec<T>, Error> {
        let mut out = vec![];
        let mut budget = PaginationBudget::default();
        for n in 0..MAX_PAGES {
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
                            ("offset", &(n * PAGE_SIZE).to_string()[..]),
                        ])
                        .collect(),
                    ResponsePolicy::paginated(budget.response_limit()?),
                )
                .await?;
            match budget.append_page(&mut out, page)? {
                true => return Ok(out),
                false => continue,
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
        for n in 0..MAX_PAGES {
            let mut b = b.clone();
            b["limit"] = json!(PAGE_SIZE);
            b["offset"] = json!(n * PAGE_SIZE);
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
        Ok(page_len < PAGE_SIZE || total.is_some_and(|total| items.len() as u64 >= total))
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
}

impl ResponsePolicy {
    const fn standard() -> Self {
        Self {
            maximum: MAX_JSON_BYTES,
            log_success_body: true,
        }
    }

    const fn paginated(maximum: usize) -> Self {
        Self {
            maximum,
            log_success_body: false,
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
mod tests {
    use super::{
        dto, response::DecodedResponse, Error, PaginationBudget, MAX_JSON_BYTES,
        MAX_PAGINATED_JSON_BYTES, PAGE_SIZE,
    };

    fn page(
        start: usize,
        count: usize,
        total: Option<u64>,
        encoded_bytes: usize,
    ) -> DecodedResponse<dto::PaginatedPage<usize>> {
        DecodedResponse {
            value: dto::PaginatedPage {
                results: (start..start + count).collect(),
                total,
            },
            encoded_bytes,
        }
    }

    #[test]
    fn pagination_rejects_aggregate_bytes_before_retaining_the_page() {
        let mut budget = PaginationBudget::default();
        let mut items = Vec::new();
        assert!(!budget
            .append_page(
                &mut items,
                page(
                    0,
                    PAGE_SIZE,
                    Some((PAGE_SIZE * 2) as u64),
                    MAX_PAGINATED_JSON_BYTES - 1
                ),
            )
            .unwrap());

        assert_eq!(
            budget
                .append_page(
                    &mut items,
                    page(PAGE_SIZE, PAGE_SIZE, Some((PAGE_SIZE * 2) as u64), 2),
                )
                .unwrap_err(),
            Error::server("Relution pagination exceeded the response byte limit")
        );
        assert_eq!(items.len(), PAGE_SIZE);
    }

    #[test]
    fn pagination_keeps_the_per_response_limit_within_the_aggregate_budget() {
        assert_eq!(
            PaginationBudget::default().response_limit().unwrap(),
            MAX_JSON_BYTES
        );
        assert_eq!(
            PaginationBudget {
                encoded_bytes: MAX_PAGINATED_JSON_BYTES - 1,
            }
            .response_limit()
            .unwrap(),
            1
        );
    }

    #[test]
    fn pagination_preserves_one_hundred_full_pages_and_ten_thousand_items() {
        let mut budget = PaginationBudget::default();
        let mut items = Vec::new();
        for page_number in 0..100 {
            let complete = budget
                .append_page(
                    &mut items,
                    page(page_number * PAGE_SIZE, PAGE_SIZE, Some(10_000), 1),
                )
                .unwrap();
            assert_eq!(complete, page_number == 99);
        }
        assert_eq!(items, (0..10_000).collect::<Vec<_>>());
    }
}
