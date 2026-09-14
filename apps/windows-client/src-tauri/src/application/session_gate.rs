//! Admission for durable writes, separate from reads and action serialization.

use std::{future::Future, sync::Arc};
use tokio::sync::{OwnedRwLockReadGuard, RwLock, RwLockWriteGuard};

#[derive(Default)]
pub(crate) struct SessionGate(Arc<RwLock<()>>);

impl SessionGate {
    pub(crate) async fn admit(&self) -> OwnedRwLockReadGuard<()> {
        Arc::clone(&self.0).read_owned().await
    }

    pub(crate) async fn transition(&self) -> RwLockWriteGuard<'_, ()> {
        self.0.write().await
    }

    #[cfg(test)]
    pub(crate) fn has_admitted_write(&self) -> bool {
        self.0.try_write().is_err()
    }
}

/// Dropping an IPC waiter detaches this owned task. Its permit remains held until
/// the admitted operation, including its durable result, has finished.
pub(crate) fn dispatch<T: Send + 'static>(
    permit: OwnedRwLockReadGuard<()>,
    operation: impl Future<Output = T> + Send + 'static,
) -> tokio::task::JoinHandle<T> {
    tokio::spawn(async move {
        let _permit = permit;
        operation.await
    })
}

#[cfg(test)]
mod tests {
    use super::{dispatch, SessionGate};
    use crate::application::test_support::run;
    use std::time::Duration;
    use tokio::sync::oneshot;

    #[test]
    fn a_dropped_waiter_does_not_release_an_admitted_write() {
        run(async {
            let gate = SessionGate::default();
            let (release, pending) = oneshot::channel();
            let (finished, completion) = oneshot::channel();
            let permit = gate.admit().await;
            drop(dispatch(permit, async move {
                pending.await.unwrap();
                finished.send(()).unwrap();
            }));
            assert!(
                tokio::time::timeout(Duration::from_millis(10), gate.transition())
                    .await
                    .is_err()
            );
            release.send(()).unwrap();
            completion.await.unwrap();
            let _transition = gate.transition().await;
        });
    }

    #[test]
    fn read_work_does_not_require_admission() {
        run(async {
            let gate = SessionGate::default();
            let _transition = gate.transition().await;
            // Reads can perform their I/O while a transition is active; the
            // session coordinator separately fences their publication.
            let (ready, read) = oneshot::channel();
            ready.send("read result").unwrap();
            assert_eq!(read.await.unwrap(), "read result");
            assert!(
                tokio::time::timeout(Duration::from_millis(10), gate.admit())
                    .await
                    .is_err()
            );
        });
    }
}
