//! Typed native error carried from the producer to every decision that depends on it.
//! `Display` renders the stable `"<kind>: <detail>"` message that the wire returns.

use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    Offline,
    SessionExpired,
    Authorization,
    DeviceMatchFailed,
    Server,
    Support,
    Configuration,
    Unknown,
}

impl ErrorKind {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 8] = [
        Self::Offline,
        Self::SessionExpired,
        Self::Authorization,
        Self::DeviceMatchFailed,
        Self::Server,
        Self::Support,
        Self::Configuration,
        Self::Unknown,
    ];

    const fn prefix(self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::SessionExpired => "session-expired",
            Self::Authorization => "authorization",
            Self::DeviceMatchFailed => "device_match_failed",
            Self::Server => "server",
            Self::Support => "support",
            Self::Configuration => "configuration",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Error {
    kind: ErrorKind,
    detail: String,
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }

    pub(crate) fn offline(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Offline, detail)
    }

    pub(crate) fn session_expired(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::SessionExpired, detail)
    }

    pub(crate) fn authorization(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Authorization, detail)
    }

    pub(crate) fn device_match_failed(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::DeviceMatchFailed, detail)
    }

    pub(crate) fn server(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Server, detail)
    }

    pub(crate) fn support(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Support, detail)
    }

    pub(crate) fn configuration(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Configuration, detail)
    }

    pub(crate) fn unknown(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unknown, detail)
    }

    pub(crate) fn kind(&self) -> ErrorKind {
        self.kind
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.prefix(), self.detail)
    }
}

impl std::error::Error for Error {}

#[cfg(test)]
mod tests {
    use super::{Error, ErrorKind};

    #[test]
    fn every_kind_renders_its_stable_message_prefix() {
        let rendered = ErrorKind::ALL.map(|kind| Error::new(kind, "detail").to_string());
        assert_eq!(
            rendered,
            [
                "offline: detail",
                "session-expired: detail",
                "authorization: detail",
                "device_match_failed: detail",
                "server: detail",
                "support: detail",
                "configuration: detail",
                "unknown: detail",
            ]
        );
    }
}
