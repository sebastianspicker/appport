//! Concrete Windows storage, platform, and local-system adapters.

pub(crate) mod credentials;
pub(crate) mod evidence;
pub(crate) mod notifications;
pub(crate) mod path_security;
pub(crate) mod platform;
pub(crate) mod support;
mod support_archive;
pub(crate) mod support_collectors;
mod support_files;
mod support_smbios;
pub(crate) mod system_tools;
pub(crate) mod task;
mod task_protocol;
mod task_scheduler;
