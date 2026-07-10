//! Bridge for the `luxor` CLI: the frontend polls for "open this folder"
//! requests pushed by `luxor <path>` invocations (see `luxor_core::cli`).

use luxor_core::{cli, Error};

/// Drain pending CLI open requests (absolute project paths).
#[tauri::command]
pub async fn cli_poll_requests() -> Result<Vec<String>, Error> {
    tauri::async_runtime::spawn_blocking(|| {
        let base = cli::default_base_dir()?;
        cli::drain_requests(&base)
    })
    .await
    .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))?
}
