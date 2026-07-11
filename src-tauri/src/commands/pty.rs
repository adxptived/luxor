use base64::Engine;
use luxor_core::pty::{SessionInfo, SpawnOptions};
use luxor_core::Error;
use tauri::State;

use crate::pathguard::ensure_within_projects;
use crate::state::AppState;

#[tauri::command(async)]
pub fn pty_spawn(state: State<'_, AppState>, opts: SpawnOptions) -> Result<SessionInfo, Error> {
    let mut opts = opts;
    if let Some(cwd) = opts.cwd.as_deref() {
        ensure_within_projects(&state, cwd)?;
    }
    // Apply configured default shell when none was requested.
    if opts.shell.is_none() {
        let cfg = state
            .config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        opts.shell = cfg.terminal.shell.clone();
        opts.fast_powershell_startup = cfg.terminal.fast_powershell_startup;
        if opts.args.is_empty() {
            opts.args = cfg.terminal.shell_args.clone();
        }
    }
    state.pty.spawn(opts)
}

/// Write user input (base64-encoded raw bytes from xterm.js).
#[tauri::command(async)]
pub fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data_b64: String,
) -> Result<(), Error> {
    const MAX_INPUT_BYTES: usize = 1024 * 1024;
    if data_b64.len() > MAX_INPUT_BYTES * 2 {
        return Err(Error::InvalidInput("terminal input frame is too large".into()));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| Error::InvalidInput(format!("invalid base64 input: {e}")))?;
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(Error::InvalidInput("terminal input frame is too large".into()));
    }
    state.pty.write(&session_id, &bytes)
}

#[tauri::command(async)]
pub fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), Error> {
    const MAX_DIMENSION: u16 = 10_000;
    if cols == 0 || rows == 0 || cols > MAX_DIMENSION || rows > MAX_DIMENSION {
        return Err(Error::InvalidInput(format!(
            "invalid terminal size: {cols}x{rows}"
        )));
    }
    state.pty.resize(&session_id, cols, rows)
}

#[tauri::command(async)]
pub fn pty_kill(state: State<'_, AppState>, session_id: String) -> Result<(), Error> {
    state.pty.kill(&session_id)
}

/// Shells found on PATH (for the settings picker).
#[tauri::command(async)]
pub fn pty_detect_shells() -> Result<Vec<luxor_core::pty::DetectedShell>, Error> {
    Ok(luxor_core::pty::detect_shells())
}

#[tauri::command(async)]
pub fn pty_list(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, Error> {
    Ok(state.pty.list())
}
