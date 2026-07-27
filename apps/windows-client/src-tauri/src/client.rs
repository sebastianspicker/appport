use crate::{evidence, session::SessionStore};
use base64::{engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, time::Duration};
use tokio::net::TcpListener;
use url::Url;

const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_ICON_BYTES: usize = 512 * 1024;
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const CALLBACK_CONNECTION_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_MALFORMED_CALLBACKS: u8 = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignOutOutcome {
    pub remote_revocation: &'static str,
    pub credential_deletion: &'static str,
    pub scheduled_task_removal: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSessionExchangeRequest {
    request_id: String,
    code: String,
    verifier: String,
    client_version: String,
    locale: String,
    device_evidence: evidence::NativeDeviceEvidenceV1,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeResponse {
    token: String,
}

#[derive(Deserialize)]
struct ApplicationsResponse {
    applications: Vec<AvailableApp>,
}

#[derive(Deserialize)]
struct InstalledResponse {
    applications: Vec<InstalledApplication>,
}

#[derive(Deserialize)]
struct ActionResponse {
    action: AppAction,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectStarted {
    pub request_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBootstrap {
    pub user: NativeUser,
    pub device: NativeDevice,
    pub session_expires_at: String,
    pub update_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUser {
    pub display_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDevice {
    pub name: String,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableApp {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub source: String,
    pub package_identifier: Option<String>,
    pub released_version_id: String,
    pub released_version_label: Option<String>,
    pub installed_version_id: Option<String>,
    pub installed_version_label: Option<String>,
    pub install_state: String,
    pub active_action_id: Option<String>,
    pub active_action_state: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApplication {
    pub app_id: Option<String>,
    pub package_id: String,
    pub name: String,
    pub version_id: Option<String>,
    pub version: String,
    pub source: Option<String>,
    pub update_available: bool,
    pub approved: bool,
    pub icon_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAction {
    pub id: String,
    pub device_id: String,
    pub app_id: String,
    pub intent: String,
    pub state: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct BrokerClient {
    base: Url,
    http: reqwest::Client,
}

impl BrokerClient {
    pub fn new(endpoint: &str) -> Result<Self, String> {
        let base =
            Url::parse(endpoint).map_err(|_| "configuration: invalid broker URL".to_owned())?;
        if base.scheme() != "https"
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
            || base.path() != "/"
        {
            return Err("configuration: broker URL must be a fixed HTTPS URL".into());
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "configuration: HTTP client unavailable".to_owned())?;
        Ok(Self { base, http })
    }

    pub async fn begin_connect(
        &self,
        session: &mut SessionStore,
    ) -> Result<ConnectStarted, String> {
        let evidence = evidence::collect()?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "offline: loopback listener unavailable")?;
        let port = listener
            .local_addr()
            .map_err(|_| "unknown: loopback address unavailable")?
            .port();
        let request_id = uuid_key();
        let verifier = random_url_value();
        let state = random_url_value();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut connect = self.url("native/connect")?;
        connect
            .query_pairs_mut()
            .append_pair("requestId", &request_id)
            .append_pair("challenge", &challenge)
            .append_pair("state", &state)
            .append_pair("port", &port.to_string());
        open_system_browser(connect.as_str())?;
        let code = receive_code(listener, &state).await?;
        let exchange: ExchangeResponse = self
            .post(
                "api/native/session/exchange",
                &NativeSessionExchangeRequest {
                    request_id: request_id.clone(),
                    code,
                    verifier,
                    client_version: env!("CARGO_PKG_VERSION").into(),
                    locale: current_locale(),
                    device_evidence: evidence,
                },
                None,
            )
            .await?;
        session.save(exchange.token)?;
        Ok(ConnectStarted { request_id })
    }

    pub async fn bootstrap(&self, session: &SessionStore) -> Result<NativeBootstrap, String> {
        self.get("api/native/bootstrap", session).await
    }

    pub async fn apps(
        &self,
        view: &str,
        session: &SessionStore,
    ) -> Result<Vec<AvailableApp>, String> {
        let path = match view {
            "apps" => "api/native/apps",
            "updates" => "api/native/updates",
            _ => return Err("unknown: invalid software view".into()),
        };
        Ok(self
            .get::<ApplicationsResponse>(path, session)
            .await?
            .applications)
    }

    pub async fn installed(
        &self,
        session: &SessionStore,
    ) -> Result<Vec<InstalledApplication>, String> {
        Ok(self
            .get::<InstalledResponse>("api/native/installed", session)
            .await?
            .applications)
    }

    pub async fn action(&self, app_id: &str, session: &SessionStore) -> Result<AppAction, String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Action {
            idempotency_key: String,
        }
        let path = self.resource_path(&["api", "native", "apps", app_id, "actions"])?;
        Ok(self
            .post::<ActionResponse, _>(
                &path,
                &Action {
                    idempotency_key: uuid_key(),
                },
                session.bearer(),
            )
            .await?
            .action)
    }

    pub async fn get_action(
        &self,
        action_id: &str,
        session: &SessionStore,
    ) -> Result<AppAction, String> {
        let path = self.resource_path(&["api", "native", "actions", action_id])?;
        Ok(self.get::<ActionResponse>(&path, session).await?.action)
    }

    pub async fn icon(
        &self,
        app_id: &str,
        session: &SessionStore,
    ) -> Result<Option<String>, String> {
        let token = session
            .bearer()
            .ok_or("session-expired: no stored session")?;
        let path = self.resource_path(&["api", "native", "apps", app_id, "icon"])?;
        let response = self
            .http
            .get(self.url(&path)?)
            .bearer_auth(token)
            .send()
            .await
            .map_err(map_network_error)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if response.status().as_u16() == 401 {
            return Err("session-expired: authorization required".into());
        }
        if !response.status().is_success() {
            return Err("server: icon request rejected".into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .filter(|value| matches!(*value, "image/png" | "image/jpeg" | "image/webp"))
            .ok_or("server: unsupported icon type")?
            .to_owned();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "server: icon response failed")?;
        if bytes.len() > MAX_ICON_BYTES {
            return Err("server: icon response is too large".into());
        }
        Ok(Some(format!(
            "data:{content_type};base64,{}",
            STANDARD.encode(bytes)
        )))
    }

    pub async fn sign_out(&self, session: &mut SessionStore) -> SignOutOutcome {
        let mut remote_revocation = "not_attempted";
        if let Some(token) = session.bearer() {
            let result = self
                .url("api/native/session")
                .map(|url| self.http.delete(url).bearer_auth(token));
            remote_revocation = match result {
                Ok(request) => classify_remote_revocation(
                    request
                        .send()
                        .await
                        .map(|response| response.status().as_u16())
                        .map_err(|_| ()),
                ),
                Err(_) => "failed",
            };
        }
        let credential_deletion = if session.clear().is_ok() {
            "deleted"
        } else {
            "failed"
        };
        SignOutOutcome {
            remote_revocation,
            credential_deletion,
            scheduled_task_removal: "not_attempted",
        }
    }

    pub async fn sign_out_with_task(
        &self,
        session: &mut SessionStore,
        task_result: Result<(), String>,
    ) -> SignOutOutcome {
        let mut outcome = self.sign_out(session).await;
        outcome.scheduled_task_removal = if task_result.is_ok() {
            "removed"
        } else {
            "failed"
        };
        outcome
    }

    async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        session: &SessionStore,
    ) -> Result<T, String> {
        let token = session
            .bearer()
            .ok_or("session-expired: no stored session")?;
        decode(
            self.http
                .get(self.url(path)?)
                .bearer_auth(token)
                .send()
                .await,
        )
        .await
    }

    async fn post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
        token: Option<&str>,
    ) -> Result<T, String> {
        let mut request = self.http.post(self.url(path)?).json(body);
        if let Some(value) = token {
            request = request.bearer_auth(value);
        }
        decode(request.send().await).await
    }

    fn url(&self, relative: &str) -> Result<Url, String> {
        let url = self
            .base
            .join(relative)
            .map_err(|_| "unknown: invalid broker URL")?;
        if url.origin() != self.base.origin() {
            return Err("unknown: broker origin changed".into());
        }
        Ok(url)
    }

    fn resource_path(&self, segments: &[&str]) -> Result<String, String> {
        let mut url = self.base.clone();
        url.set_path("/");
        {
            let mut target = url
                .path_segments_mut()
                .map_err(|_| "unknown: invalid broker URL")?;
            target.clear();
            for segment in segments {
                target.push(segment);
            }
        }
        Ok(url.path().trim_start_matches('/').to_owned())
    }
}

async fn decode<T: DeserializeOwned>(
    response: Result<reqwest::Response, reqwest::Error>,
) -> Result<T, String> {
    let response = response.map_err(map_network_error)?;
    match response.status().as_u16() {
        200..=299 => {
            let bytes = response
                .bytes()
                .await
                .map_err(|_| "server: response could not be read")?;
            if bytes.len() > MAX_JSON_BYTES {
                return Err("server: response is too large".into());
            }
            serde_json::from_slice(&bytes).map_err(|_| "server: invalid broker response".into())
        }
        401 => Err("session-expired: authorization required".into()),
        403 => Err("device_match_failed: device not assigned".into()),
        429 => Err("server: too many requests".into()),
        500..=599 => Err("server: broker unavailable".into()),
        _ => Err("server: broker rejected request".into()),
    }
}

fn map_network_error(error: reqwest::Error) -> String {
    if error.is_connect() || error.is_timeout() {
        "offline: broker unreachable".to_owned()
    } else {
        "server: request failed".to_owned()
    }
}

fn random_url_value() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn uuid_key() -> String {
    let mut bytes: [u8; 16] = rand::rng().random();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

async fn receive_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + CALLBACK_TIMEOUT;
    receive_code_until(
        listener,
        expected_state,
        deadline,
        CALLBACK_CONNECTION_TIMEOUT,
    )
    .await
}

async fn receive_code_until(
    listener: TcpListener,
    expected_state: &str,
    deadline: tokio::time::Instant,
    connection_timeout: Duration,
) -> Result<String, String> {
    for _ in 0..=MAX_MALFORMED_CALLBACKS {
        let (stream, _) = tokio::time::timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| "session-expired: sign-in timed out")?
            .map_err(|_| "unknown: loopback callback failed")?;
        let connection_deadline = deadline.min(tokio::time::Instant::now() + connection_timeout);
        let callback =
            match tokio::time::timeout_at(connection_deadline, read_callback(stream)).await {
                Ok(callback) => callback,
                Err(_) if tokio::time::Instant::now() < deadline => continue,
                Err(_) => return Err("session-expired: sign-in timed out".into()),
            };
        if let Ok((code, state)) = callback {
            if state == expected_state {
                return Ok(code);
            }
        }
    }
    Err("session-expired: invalid sign-in callback".into())
}

fn classify_remote_revocation(result: Result<u16, ()>) -> &'static str {
    match result {
        Ok(204 | 401) => "revoked",
        _ => "failed",
    }
}

async fn read_callback(stream: tokio::net::TcpStream) -> Result<(String, String), String> {
    let mut buffer = [0_u8; 4096];
    stream
        .readable()
        .await
        .map_err(|_| "unknown: callback unavailable")?;
    let count = stream
        .try_read(&mut buffer)
        .map_err(|_| "unknown: malformed callback")?;
    let first = std::str::from_utf8(&buffer[..count])
        .map_err(|_| "unknown: callback encoding")?
        .lines()
        .next()
        .ok_or("unknown: callback request")?;
    let mut request_line = first.split_whitespace();
    if request_line.next() != Some("GET") {
        return Err("unknown: callback method".into());
    }
    let target = request_line.next().ok_or("unknown: callback target")?;
    let callback =
        Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "unknown: callback URL")?;
    if callback.path() != "/callback" {
        return Err("unknown: callback path".into());
    }
    let mut values: HashMap<_, _> = callback.query_pairs().into_owned().collect();
    let code = values
        .remove("code")
        .filter(|value| !value.is_empty())
        .ok_or("session-expired: no authorization code")?;
    let state = values
        .remove("state")
        .filter(|value| !value.is_empty())
        .ok_or("session-expired: no callback state")?;
    stream
        .writable()
        .await
        .map_err(|_| "unknown: callback response unavailable")?;
    let _ = stream.try_write(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 56\r\nConnection: close\r\n\r\nSign-in complete. You can return to Appport.",
    );
    Ok((code, state))
}

fn current_locale() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::Globalization::{GetUserDefaultLocaleName, LOCALE_NAME_MAX_LENGTH};
        let mut locale = [0_u16; LOCALE_NAME_MAX_LENGTH as usize];
        let length = unsafe { GetUserDefaultLocaleName(&mut locale) };
        if length > 0 {
            let value = String::from_utf16_lossy(&locale[..length as usize - 1]);
            if value.to_ascii_lowercase().starts_with("de") {
                return "de-DE".into();
            }
        }
    }
    "en-US".into()
}

fn open_system_browser(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "server: invalid authorization URL".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("server: authorization URL must use HTTPS".into());
    }
    #[cfg(windows)]
    {
        use windows::{
            core::PCWSTR,
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(operation.as_ptr()),
                PCWSTR(target.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("unknown: unable to open system browser".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = parsed;
        Err("unknown: system-browser sign-in is only available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_values_are_url_safe_and_distinct() {
        let first = random_url_value();
        assert_eq!(first.len(), 43);
        assert_ne!(first, random_url_value());
        assert!(!first.contains('+'));
    }

    #[test]
    fn idempotency_key_is_a_v4_uuid() {
        let key = uuid_key();
        assert_eq!(key.len(), 36);
        assert_eq!(&key[14..15], "4");
        assert!(matches!(&key[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn broker_url_must_be_fixed_https() {
        assert!(BrokerClient::new("http://example.test").is_err());
        assert!(BrokerClient::new("https://user@example.test").is_err());
        assert!(BrokerClient::new("https://example.test?tenant=one").is_err());
        assert!(BrokerClient::new("https://example.test").is_ok());
    }

    #[test]
    fn rejects_non_https_browser_handoff() {
        assert!(open_system_browser("http://example.test").is_err());
    }

    #[test]
    fn classifies_remote_revocation_truthfully() {
        assert_eq!(classify_remote_revocation(Ok(204)), "revoked");
        assert_eq!(classify_remote_revocation(Ok(401)), "revoked");
        assert_eq!(classify_remote_revocation(Ok(500)), "failed");
        assert_eq!(classify_remote_revocation(Err(())), "failed");
    }

    #[test]
    fn ignores_wrong_state_before_a_valid_callback() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
            let address = listener.local_addr().expect("listener address");
            tokio::spawn(async move {
                for request in [
                    "GET /callback?code=wrong-1&state=wrong HTTP/1.1\r\n\r\n",
                    "GET /callback?code=wrong-2&state=wrong HTTP/1.1\r\n\r\n",
                    "GET /callback?code=wrong-3&state=wrong HTTP/1.1\r\n\r\n",
                    "GET /callback?code=accepted&state=expected HTTP/1.1\r\n\r\n",
                ] {
                    let stream = tokio::net::TcpStream::connect(address)
                        .await
                        .expect("connect");
                    stream.writable().await.expect("writable");
                    stream.try_write(request.as_bytes()).expect("write");
                }
            });
            let code = receive_code_until(
                listener,
                "expected",
                tokio::time::Instant::now() + Duration::from_secs(1),
                Duration::from_millis(100),
            )
            .await
            .expect("valid callback");
            assert_eq!(code, "accepted");
        });
    }

    #[test]
    fn ignores_a_silent_connection_before_a_valid_callback() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        runtime.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
            let address = listener.local_addr().expect("listener address");
            tokio::spawn(async move {
                let _stream = tokio::net::TcpStream::connect(address)
                    .await
                    .expect("connect");
                tokio::time::sleep(Duration::from_millis(40)).await;
                let valid = tokio::net::TcpStream::connect(address)
                    .await
                    .expect("valid connect");
                valid.writable().await.expect("valid writable");
                valid
                    .try_write(b"GET /callback?code=accepted&state=expected HTTP/1.1\r\n\r\n")
                    .expect("valid write");
            });
            let code = receive_code_until(
                listener,
                "expected",
                tokio::time::Instant::now() + Duration::from_secs(1),
                Duration::from_millis(20),
            )
            .await
            .expect("valid callback after silent connection");
            assert_eq!(code, "accepted");
        });
    }
}
