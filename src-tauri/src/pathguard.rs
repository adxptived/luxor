//! PathGuard — confines mutating FS/DB IPC commands to registered project
//! roots (audit fix 2.1).
//!
//! Every command that can WRITE, RENAME, COPY or DELETE through IPC must call
//! [`ensure_within_projects`] before touching the disk. The check resolves
//! symlinks on both sides (`is_within_root_canonical`), so a link inside a
//! project pointing at `/etc` is rejected too — not just `../../` escapes.
//!
//! Read-only commands (list/read/search) intentionally stay unrestricted: the
//! file explorer must be able to browse the whole disk so the user can *open*
//! new project folders. The threat model this guard addresses is an XSS or
//! malicious plugin in the webview issuing destructive writes outside the
//! projects the user actually opened.

use std::path::Path;

use luxor_core::fsx::is_within_root_canonical;
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

/// Collect the current allowlist of writable roots: every registered project
/// path plus the app's own config dir (settings export, presets, skills).
fn allowed_roots(state: &State<'_, AppState>) -> Vec<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(registry) = state.registry.lock() {
        if let Ok(projects) = registry.list() {
            for p in projects {
                if !p.path.is_empty() {
                    roots.push(std::path::PathBuf::from(p.path));
                }
            }
        }
    }
    // The app's own config dir hosts exported settings, presets and skills.
    if let Ok(dir) = luxor_core::config::config_dir() {
        roots.push(dir);
    }
    // Allow the OS temp dir for scratch artifacts (e.g. DevTools demo files).
    roots.push(std::env::temp_dir());
    roots
}

/// Err unless `path` resolves inside one of the registered project roots (or
/// the app config / temp dir). Used by every mutating FS/DB command.
pub fn ensure_within_projects(state: &State<'_, AppState>, path: &str) -> Result<(), Error> {
    let target = Path::new(path);
    for root in allowed_roots(state) {
        if is_within_root_canonical(&root, target) {
            return Ok(());
        }
    }
    Err(Error::InvalidInput(format!(
        "path is outside all open project roots: {path}"
    )))
}
