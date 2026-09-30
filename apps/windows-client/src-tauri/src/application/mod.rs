//! Session-scoped native workflows.

pub(crate) mod actions;
pub(crate) mod background;
pub(crate) mod catalog;
mod catalog_cache;
pub(crate) mod desktop;
pub(crate) mod session;
pub(crate) mod session_gate;
pub(crate) mod support;

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
pub(crate) mod action_test_support;
