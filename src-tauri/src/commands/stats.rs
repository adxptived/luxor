//! System statistics commands for the status bar.

use std::time::Duration;

use luxor_core::stats::{self, SystemStats};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

#[tauri::command(async)]
pub fn stats_sample(state: State<'_, AppState>) -> Result<SystemStats, Error> {
    Ok(state
        .stats
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .sample())
}

/// TCP-connect latency to `host:port`; `None` when unreachable.
#[tauri::command]
pub async fn stats_ping(host: String, timeout_ms: Option<u64>) -> Result<Option<u32>, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        stats::tcp_ping(&host, Duration::from_millis(timeout_ms.unwrap_or(1500)))
    })
    .await
    .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))
}
