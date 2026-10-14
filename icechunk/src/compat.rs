// Conditional Send bound for WASM compatibility.
// Single-threaded WASM does not need `Send`, and some dependencies
// (e.g. backon's GlooTimersSleep) are not `Send` there.
// Enable `napi-send-contract` to force `Send` futures on WASM for napi compatibility checks.

use std::{future::Future, pin::Pin};

#[cfg(any(not(target_family = "wasm"), feature = "napi-send-contract"))]
pub type IcechunkBoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[cfg(all(target_family = "wasm", not(feature = "napi-send-contract")))]
pub type IcechunkBoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

#[cfg(any(not(target_family = "wasm"), feature = "napi-send-contract"))]
macro_rules! ic_boxed {
    ($fut:expr) => {
        futures::FutureExt::boxed($fut)
    };
}

#[cfg(all(target_family = "wasm", not(feature = "napi-send-contract")))]
macro_rules! ic_boxed {
    ($fut:expr) => {
        futures::FutureExt::boxed_local($fut)
    };
}

pub(crate) use ic_boxed;

// Single-threaded wasm (`wasm32-wasip1`, or `wasm32-unknown-unknown` without the `atomics`
// target feature) has no Tokio runtime: the host (the JS event loop) polls icechunk's futures
// directly, so `tokio::spawn`, `tokio::task::spawn_blocking` and `tokio::time::sleep` would
// panic for lack of a runtime context. Threaded wasm (`wasm32-wasip1-threads`) and native
// targets keep the Tokio functions. The helpers below keep Tokio's signatures, including the
// `Result<_, JoinError>` output, so call sites don't change shape.
#[cfg(not(all(target_family = "wasm", not(target_feature = "atomics"))))]
pub(crate) use tokio::{spawn, task::spawn_blocking, time::sleep};

/// Run `fut` when the returned future is awaited, instead of on a separate task.
///
/// Unlike `tokio::spawn`, nothing runs until the result is awaited, and a dropped result never
/// runs. Callers that spawn to overlap work (and await the handle later) lose only the overlap.
#[cfg(all(target_family = "wasm", not(target_feature = "atomics")))]
pub(crate) async fn spawn<F: Future>(
    fut: F,
) -> Result<F::Output, tokio::task::JoinError> {
    Ok(fut.await)
}

/// Run `f` right away on the calling (only) thread.
#[cfg(all(target_family = "wasm", not(target_feature = "atomics")))]
pub(crate) fn spawn_blocking<F: FnOnce() -> R, R>(
    f: F,
) -> std::future::Ready<Result<R, tokio::task::JoinError>> {
    std::future::ready(Ok(f()))
}

/// No timer is reachable from here, so retry backoff doesn't wait: retries run back to back.
#[cfg(all(target_family = "wasm", not(target_feature = "atomics")))]
pub(crate) fn sleep(_duration: std::time::Duration) -> std::future::Ready<()> {
    std::future::ready(())
}
