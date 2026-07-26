use luxor_core::launcher::{self, ExternalTerminal};
use luxor_core::Error;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[tauri::command(async)]
pub fn launcher_open_terminal(
    state: State<'_, AppState>,
    dir: String,
    terminal: Option<ExternalTerminal>,
    command: Option<String>,
) -> Result<(), Error> {
    // Priority: explicit command > legacy enum > configured default > platform default.
    let configured = command.or_else(|| {
        state
            .config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .terminal
            .external_terminal
            .clone()
            .filter(|c| !c.trim().is_empty())
    });
    match configured {
        Some(cmd) => launcher::open_terminal_command(&cmd, &dir),
        None => launcher::open_external_terminal(&dir, terminal),
    }
}

/// Terminal emulators found on PATH (for the settings picker).
#[tauri::command(async)]
pub fn launcher_detect_terminals() -> Result<Vec<launcher::DetectedTerminal>, Error> {
    Ok(launcher::detect_terminals())
}

#[tauri::command(async)]
pub fn launcher_open_file_manager(dir: String) -> Result<(), Error> {
    launcher::open_file_manager(&dir)
}

#[tauri::command(async)]
pub fn launcher_open_ide(
    state: State<'_, AppState>,
    dir: String,
    ide: Option<String>,
) -> Result<(), Error> {
    let ide = match ide {
        Some(ide) => ide,
        None => {
            let cfg = state
                .config
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            cfg.default_ide
                .clone()
                .filter(|cmd| !cmd.trim().is_empty())
                .or_else(|| {
                    cfg.preferred_editors
                        .iter()
                        .find(|cmd| which::which(cmd).is_ok())
                        .cloned()
                })
                .or_else(|| cfg.custom_ides.first().map(|entry| entry.command.clone()))
                .or_else(|| detect_ides().into_iter().next().map(|d| d.command))
                .ok_or_else(|| Error::Launcher("no IDE found; configure one in Settings".into()))?
        }
    };
    // Settings can store pseudo-editors used by the UI. Keep the backend safe
    // too, so any future `launcherOpenIde(dir)` caller respects the selected
    // default instead of trying to spawn a fake executable named "__default__".
    if ide == "__default__" {
        return open_default_app(&dir);
    }
    if ide == "__explorer__" {
        return launcher::open_file_manager(&dir);
    }
    launcher::open_in_ide(&ide, &dir)
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedIde {
    pub command: String,
    pub label: String,
}

fn detect_ides() -> Vec<DetectedIde> {
    // Single source of truth lives in luxor-core (richer list incl. Windows
    // exe variants, deduped by label).
    launcher::detect_ides()
        .into_iter()
        .map(|d| DetectedIde {
            command: d.command,
            label: d.label,
        })
        .collect()
}

/// IDEs/editors found on PATH (for launcher buttons and settings).
#[tauri::command(async)]
pub fn launcher_detect_ides() -> Result<Vec<DetectedIde>, Error> {
    Ok(detect_ides())
}

/// Open a path with the OS default application, via the `opener` plugin.
///
/// The plugin calls the platform's real association API (ShellExecuteW on
/// Windows), so no shell ever re-parses the path. That matters because paths
/// reach here from the file explorer and may come from a cloned repository —
/// a file named `a&calc.txt` must not be able to smuggle a command through.
fn open_default_app(path: &str) -> Result<(), Error> {
    if !std::path::Path::new(path).exists() {
        return Err(Error::NotFound(format!("path {path}")));
    }
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|e| Error::Launcher(format!("could not open {path}: {e}")))
}

/// Open a path with the OS default application ("Open with" default).
#[tauri::command(async)]
pub fn launcher_open_default_app(path: String) -> Result<(), Error> {
    open_default_app(&path)
}

#[tauri::command]
pub async fn launcher_find_executables(
    dir: String,
    limit: Option<usize>,
) -> Result<Vec<String>, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        launcher::find_executables(&dir, limit.unwrap_or(30))
    })
    .await
    .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))?
}

#[tauri::command(async)]
pub fn launcher_run_executable(
    state: State<'_, AppState>,
    project_dir: String,
    exe_path: String,
) -> Result<(), Error> {
    crate::pathguard::ensure_within_projects(&state, &project_dir)?;
    crate::pathguard::ensure_within_projects(&state, &exe_path)?;
    launcher::run_executable(&project_dir, &exe_path)
}
