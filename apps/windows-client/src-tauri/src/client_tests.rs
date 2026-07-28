use super::*;
use crate::{callbacks::receive_code_until, platform::open_system_browser};

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
