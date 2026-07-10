//! Detection of running AI CLI agents and per-terminal process-tree stats.

use luxor_core::agents::{AgentInfo, TreeStats};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

/// Running AI coding agents (Claude Code, Codex, …), aggregated per kind.
/// Also refreshes the tray tooltip so agents are visible at a glance even
/// when the window is hidden.
#[tauri::command(async)]
pub fn agents_sample(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<AgentInfo>, Error> {
    let agents = state
        .agents
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .agents();
    if let Some(tray) = app.tray_by_id("main-tray") {
        let version = app.package_info().version.clone();
        let tooltip = if agents.is_empty() {
            format!("Luxor {version}")
        } else {
            let list = agents
                .iter()
                .map(|a| {
                    if a.count > 1 {
                        format!("{} ×{}", a.label, a.count)
                    } else {
                        a.label.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("Luxor {version} — agents: {list}")
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(agents)
}

/// CPU/RAM usage of a terminal's process tree (shell + everything it spawned).
/// `None` when the process is gone.
#[tauri::command(async)]
pub fn pty_tree_stats(state: State<'_, AppState>, pid: u32) -> Result<Option<TreeStats>, Error> {
    Ok(state
        .agents
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .tree_stats(pid))
}

/// Detail rows for every running agent process (the Agents panel).
///
/// We hand the sampler a map of Luxor terminal pids → their working directory
/// so agents launched inside a Luxor terminal report a working directory even
/// when the OS hides the process's own cwd (e.g. on Windows).
#[tauri::command(async)]
pub fn agents_processes(
    state: State<'_, AppState>,
) -> Result<Vec<luxor_core::agents::AgentProcess>, Error> {
    let pty_dirs: std::collections::HashMap<u32, String> = state
        .pty
        .list()
        .into_iter()
        .filter_map(|s| match (s.pid, s.cwd) {
            (Some(pid), Some(cwd)) if !cwd.is_empty() => Some((pid, cwd)),
            _ => None,
        })
        .collect();
    Ok(state
        .agents
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .agent_processes(&pty_dirs))
}
