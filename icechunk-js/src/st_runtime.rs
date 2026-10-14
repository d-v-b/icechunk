//! Async runtime for single-threaded wasm (`wasm32-wasip1`, no `atomics`).
//!
//! The threaded wasm build (`wasm32-wasip1-threads`) drives `#[napi] async fn` futures on a Tokio
//! runtime running in Web Workers, which needs `SharedArrayBuffer` and so a cross-origin
//! isolated page. Without threads there is nothing to block on, so this backend polls futures
//! from the JS thread instead:
//!
//! - `spawn` polls the new task immediately, inside the napi call that created it;
//! - a task that returns `Pending` is parked until its waker fires. Every wake in icechunk-js comes
//!   from JS calling back into wasm (a storage `Promise` settling, a thread-safe function
//!   callback), so the waker re-polls right there, on the JS thread.
//!
//! Wakes that happen while a task is being polled only enqueue it; the outermost drain loop
//! picks it up. No task is ever polled re-entrantly.

use std::{
    cell::Cell,
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Wake, Waker},
};

use napi::bindgen_prelude::{AsyncRuntime, AsyncRuntimeRejection, AsyncRuntimeTask};

struct Task(Mutex<Option<AsyncRuntimeTask>>);

impl Wake for Task {
    fn wake(self: Arc<Self>) {
        schedule(self);
    }
}

// wasm32-wasip1 has a single thread, so these are only ever touched from the JS thread.
static READY: Mutex<VecDeque<Arc<Task>>> = Mutex::new(VecDeque::new());
thread_local! {
    static DRAINING: Cell<bool> = const { Cell::new(false) };
}

fn schedule(task: Arc<Task>) {
    READY.lock().unwrap_or_else(|e| e.into_inner()).push_back(task);
    if DRAINING.replace(true) {
        return; // an outer drain loop will poll it
    }
    loop {
        let next = READY.lock().unwrap_or_else(|e| e.into_inner()).pop_front();
        let Some(task) = next else { break };
        let waker = Waker::from(Arc::clone(&task));
        let mut slot = task.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(fut) = slot.as_mut()
            && Pin::new(fut).poll(&mut Context::from_waker(&waker)).is_ready()
        {
            *slot = None;
        }
    }
    DRAINING.set(false);
}

pub(crate) struct JsEventLoopRuntime;

// SAFETY: the backend owns no threads, and tasks only run inside calls from JS, so nothing runs
// after `shutdown` returns once the queued tasks are dropped.
unsafe impl AsyncRuntime for JsEventLoopRuntime {
    fn spawn(
        &self,
        task: AsyncRuntimeTask,
    ) -> Result<(), AsyncRuntimeRejection<AsyncRuntimeTask>> {
        schedule(Arc::new(Task(Mutex::new(Some(task)))));
        Ok(())
    }

    fn block_on(&self, _future: Pin<&mut dyn Future<Output = ()>>) -> napi::Result<()> {
        Err(napi::Error::from_reason(
            "blocking on a future is not possible in single-threaded wasm",
        ))
    }

    fn shutdown(&self) -> napi::Result<()> {
        READY.lock().unwrap_or_else(|e| e.into_inner()).clear();
        Ok(())
    }
}

#[napi_derive::module_init]
fn init() {
    napi::bindgen_prelude::register_async_runtime(JsEventLoopRuntime);
}
