use std::{collections::HashMap, time::Duration};

use tokio::net::TcpListener;
use url::Url;

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const CALLBACK_CONNECTION_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_MALFORMED_CALLBACKS: u8 = 3;

pub async fn receive_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    receive_code_until(
        listener,
        expected_state,
        tokio::time::Instant::now() + CALLBACK_TIMEOUT,
        CALLBACK_CONNECTION_TIMEOUT,
    )
    .await
}

pub(crate) async fn receive_code_until(
    listener: TcpListener,
    expected_state: &str,
    deadline: tokio::time::Instant,
    connection_timeout: Duration,
) -> Result<String, String> {
    for _ in 0..=MAX_MALFORMED_CALLBACKS {
        let (stream, _) = accept_callback(&listener, deadline).await?;
        if let Ok((code, state)) = read_with_deadline(stream, deadline, connection_timeout).await {
            if state == expected_state {
                return Ok(code);
            }
        }
    }
    Err("session-expired: invalid sign-in callback".into())
}

async fn accept_callback(
    listener: &TcpListener,
    deadline: tokio::time::Instant,
) -> Result<(tokio::net::TcpStream, std::net::SocketAddr), String> {
    tokio::time::timeout_at(deadline, listener.accept())
        .await
        .map_err(|_| "session-expired: sign-in timed out")?
        .map_err(|_| "unknown: loopback callback failed".to_owned())
}

async fn read_with_deadline(
    stream: tokio::net::TcpStream,
    deadline: tokio::time::Instant,
    connection_timeout: Duration,
) -> Result<(String, String), String> {
    let connection_deadline = deadline.min(tokio::time::Instant::now() + connection_timeout);
    match tokio::time::timeout_at(connection_deadline, read_callback(stream)).await {
        Ok(callback) => callback,
        Err(_) if tokio::time::Instant::now() < deadline => {
            Err("unknown: callback timed out".into())
        }
        Err(_) => Err("session-expired: sign-in timed out".into()),
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
    let callback = parse_callback(
        std::str::from_utf8(&buffer[..count]).map_err(|_| "unknown: callback encoding")?,
    )?;
    stream
        .writable()
        .await
        .map_err(|_| "unknown: callback response unavailable")?;
    let _ = stream.try_write(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 56\r\nConnection: close\r\n\r\nSign-in complete. You can return to Appport.");
    Ok(callback)
}

fn parse_callback(request: &str) -> Result<(String, String), String> {
    let first = request.lines().next().ok_or("unknown: callback request")?;
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
    callback_values(callback.query_pairs().into_owned().collect())
}

fn callback_values(mut values: HashMap<String, String>) -> Result<(String, String), String> {
    let code = values
        .remove("code")
        .filter(|value| !value.is_empty())
        .ok_or("session-expired: no authorization code")?;
    let state = values
        .remove("state")
        .filter(|value| !value.is_empty())
        .ok_or("session-expired: no callback state")?;
    Ok((code, state))
}
