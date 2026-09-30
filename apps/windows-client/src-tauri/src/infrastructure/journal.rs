//! Durable, fail-closed local action ledger. A reservation is the action.

mod storage;

use crate::{
    domain::action::{Action, ActiveAction, Reservation, State, Transition},
    error::Error,
};
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use storage::{
    action_in, active_actions_in, best_effort_prune, initialize, recover_in, reserve_in,
    transition_in,
};

#[derive(Clone)]
pub(crate) struct ActionJournal {
    inner: Arc<JournalInner>,
}

struct JournalInner {
    location: JournalLocation,
    connection: Mutex<Option<OpenedJournal>>,
}

struct OpenedJournal {
    path: PathBuf,
    connection: Connection,
}

enum JournalLocation {
    Default,
    Fixed(PathBuf),
}

impl ActionJournal {
    /// Creates an independent lazy journal handle for one process-level owner.
    /// Clone the handle when the same connection must be shared by services.
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(JournalInner {
                location: JournalLocation::Default,
                connection: Mutex::new(None),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn at_path(path: PathBuf) -> Self {
        Self {
            inner: Arc::new(JournalInner {
                location: JournalLocation::Fixed(path),
                connection: Mutex::new(None),
            }),
        }
    }

    /// Startup-only recovery. Normal initialization, reads, and writes do not
    /// mutate reservations.
    pub(crate) fn recover_interrupted_reservations(&self) -> Result<(), Error> {
        self.with_connection(|connection| {
            let timestamp = now();
            recover_in(connection, timestamp)?;
            best_effort_prune(connection, timestamp);
            Ok(())
        })
    }

    pub(crate) async fn reserve(&self, reservation: Reservation<'_>) -> Result<(), Error> {
        let reservation = OwnedReservation::from(reservation);
        self.run_blocking(move |connection| {
            let timestamp = now();
            reserve_in(connection, reservation.as_borrowed(), timestamp)?;
            best_effort_prune(connection, timestamp);
            Ok(())
        })
        .await
    }

    /// Compare-and-set transition. It changes exactly one existing action or fails.
    pub(crate) async fn transition(
        &self,
        id: &str,
        expected: State,
        event: Transition<'_>,
    ) -> Result<(), Error> {
        let id = id.to_owned();
        let event = OwnedTransition::from(event);
        self.run_blocking(move |connection| {
            let timestamp = now();
            transition_in(connection, &id, expected, event.as_borrowed(), timestamp)?;
            best_effort_prune(connection, timestamp);
            Ok(())
        })
        .await
    }

    pub(crate) async fn action(&self, id: &str) -> Result<Option<Action>, Error> {
        let id = id.to_owned();
        self.run_blocking(move |connection| action_in(connection, &id))
            .await
    }

    /// Read-only catalog visibility lookup; Unknown remains active.
    pub(crate) async fn active_actions(&self, device_id: &str) -> Result<Vec<ActiveAction>, Error> {
        let device_id = device_id.to_owned();
        self.run_blocking(move |connection| active_actions_in(connection, &device_id))
            .await
    }

    async fn run_blocking<T, F>(&self, operation: F) -> Result<T, Error>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, Error> + Send + 'static,
    {
        let journal = self.clone();
        tokio::task::spawn_blocking(move || journal.with_connection(operation))
            .await
            .map_err(|_| Error::unknown("action journal worker failed"))?
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let mut connection = self
            .inner
            .connection
            .lock()
            .map_err(|_| Error::unknown("action journal is unavailable"))?;
        if connection.is_none() {
            let opened = open(self.inner.location.path()?)?;
            *connection = Some(opened);
        }
        let opened = connection
            .as_ref()
            .ok_or_else(|| Error::unknown("action journal is unavailable"))?;
        validate_existing_journal_files(&opened.path)?;
        operation(&opened.connection)
    }
}

impl Default for ActionJournal {
    fn default() -> Self {
        Self::new()
    }
}

impl JournalLocation {
    fn path(&self) -> Result<PathBuf, Error> {
        match self {
            Self::Default => default_path(),
            Self::Fixed(path) => Ok(path.clone()),
        }
    }
}

fn open(journal_path: PathBuf) -> Result<OpenedJournal, Error> {
    let directory = journal_path
        .parent()
        .ok_or_else(|| Error::unknown("action journal directory is unavailable"))?;
    crate::infrastructure::windows::path_security::validate_not_reparse(directory)?;
    secure_current_user(directory)?;
    validate_existing_journal_files(&journal_path)?;
    let connection = Connection::open(&journal_path)
        .map_err(|_| Error::unknown("action journal is unavailable"))?;
    initialize(&connection)?;
    validate_existing_journal_files(&journal_path)?;
    secure_existing_journal_files(&journal_path)?;
    Ok(OpenedJournal {
        path: journal_path,
        connection,
    })
}

fn validate_existing_journal_files(journal_path: &Path) -> Result<(), Error> {
    for path in journal_paths(journal_path) {
        match fs::symlink_metadata(&path) {
            Ok(_) => crate::infrastructure::windows::path_security::validate_not_reparse(&path)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error::unknown("action journal is unavailable")),
        }
    }
    Ok(())
}

fn secure_existing_journal_files(journal_path: &Path) -> Result<(), Error> {
    for path in journal_paths(journal_path) {
        match fs::symlink_metadata(&path) {
            Ok(_) => secure_current_user(&path)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error::unknown("action journal is unavailable")),
        }
    }
    Ok(())
}

fn journal_paths(path: &Path) -> [PathBuf; 3] {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
}

#[cfg(windows)]
fn default_path() -> Result<PathBuf, Error> {
    crate::infrastructure::windows::system_tools::appport_local_data_directory()
        .map(|directory| directory.join("actions.sqlite3"))
        .map_err(|_| Error::unknown("action journal directory is unavailable"))
}

#[cfg(not(windows))]
fn default_path() -> Result<PathBuf, Error> {
    let base = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| Error::unknown("LOCALAPPDATA is unavailable"))?;
    let directory = PathBuf::from(base).join("Relution").join("Appport");
    fs::create_dir_all(&directory)
        .map_err(|_| Error::unknown("action journal directory is unavailable"))?;
    Ok(directory.join("actions.sqlite3"))
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub(crate) fn secure_current_user(path: &Path) -> Result<(), Error> {
    crate::infrastructure::windows::path_security::secure_current_user(path)
}

#[cfg(windows)]
pub fn qualification_acl_self_check() -> Result<(), Error> {
    let directory = crate::infrastructure::windows::system_tools::appport_local_data_directory()?
        .join(format!("qualification-acl-{}", std::process::id()));
    fs::create_dir_all(&directory)
        .map_err(|_| Error::unknown("qualification ACL directory unavailable"))?;
    let result = secure_current_user(&directory).and_then(|_| {
        let probe = directory.join("probe");
        fs::write(&probe, b"appport qualification")
            .map_err(|_| Error::unknown("qualification ACL write failed"))?;
        secure_current_user(&probe)?;
        (fs::read(&probe).ok().as_deref() == Some(b"appport qualification"))
            .then_some(())
            .ok_or_else(|| Error::unknown("qualification ACL read failed"))
    });
    result.and(
        fs::remove_dir_all(&directory)
            .map_err(|_| Error::unknown("qualification ACL cleanup failed")),
    )
}

#[cfg(not(windows))]
pub fn qualification_acl_self_check() -> Result<(), Error> {
    Err(Error::unknown("Windows ACLs are unavailable"))
}

struct OwnedReservation {
    id: String,
    tenant: String,
    device: String,
    app: String,
    version: String,
    package: Option<String>,
    intent: crate::domain::action::Intent,
    baseline: String,
}

impl From<Reservation<'_>> for OwnedReservation {
    fn from(value: Reservation<'_>) -> Self {
        Self {
            id: value.id.to_owned(),
            tenant: value.tenant.to_owned(),
            device: value.device.to_owned(),
            app: value.app.to_owned(),
            version: value.version.to_owned(),
            package: value.package.map(str::to_owned),
            intent: value.intent,
            baseline: value.baseline.to_owned(),
        }
    }
}

impl OwnedReservation {
    fn as_borrowed(&self) -> Reservation<'_> {
        Reservation {
            id: &self.id,
            tenant: &self.tenant,
            device: &self.device,
            app: &self.app,
            version: &self.version,
            package: self.package.as_deref(),
            intent: self.intent,
            baseline: &self.baseline,
        }
    }
}

enum OwnedTransition {
    SubmissionAccepted,
    SubmissionRejected,
    SubmissionUncertain,
    RemoteObserved {
        state: State,
        correlation: String,
        error_code: Option<String>,
    },
    VerificationTimedOut,
    InventoryConfirmed,
    RemoteMissing {
        correlation_known: bool,
    },
}

impl From<Transition<'_>> for OwnedTransition {
    fn from(value: Transition<'_>) -> Self {
        match value {
            Transition::SubmissionAccepted => Self::SubmissionAccepted,
            Transition::SubmissionRejected => Self::SubmissionRejected,
            Transition::SubmissionUncertain => Self::SubmissionUncertain,
            Transition::RemoteObserved {
                state,
                correlation,
                error_code,
            } => Self::RemoteObserved {
                state,
                correlation: correlation.to_owned(),
                error_code: error_code.map(str::to_owned),
            },
            Transition::VerificationTimedOut => Self::VerificationTimedOut,
            Transition::InventoryConfirmed => Self::InventoryConfirmed,
            Transition::RemoteMissing { correlation_known } => {
                Self::RemoteMissing { correlation_known }
            }
        }
    }
}

impl OwnedTransition {
    fn as_borrowed(&self) -> Transition<'_> {
        match self {
            Self::SubmissionAccepted => Transition::SubmissionAccepted,
            Self::SubmissionRejected => Transition::SubmissionRejected,
            Self::SubmissionUncertain => Transition::SubmissionUncertain,
            Self::RemoteObserved {
                state,
                correlation,
                error_code,
            } => Transition::RemoteObserved {
                state: *state,
                correlation,
                error_code: error_code.as_deref(),
            },
            Self::VerificationTimedOut => Transition::VerificationTimedOut,
            Self::InventoryConfirmed => Transition::InventoryConfirmed,
            Self::RemoteMissing { correlation_known } => Transition::RemoteMissing {
                correlation_known: *correlation_known,
            },
        }
    }
}

#[cfg(test)]
mod tests;
