//! Local-only identifiers and clock access.

use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn uuid_key() -> String {
    format!("{:x}", rand::rng().random::<u128>())
}

pub(crate) fn epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
