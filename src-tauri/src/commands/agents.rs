//! Detection of running AI CLI agents and per-terminal process-tree stats.

use std::collections::{HashMap, HashSet};

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
    let pty_dirs = pty_spawn_dirs(&state);
    Ok(state
        .agents
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .agent_processes(&pty_dirs))
}

/// Luxor terminal shell pid → the directory its session was spawned in.
fn pty_spawn_dirs(state: &AppState) -> HashMap<u32, String> {
    state
        .pty
        .list()
        .into_iter()
        .filter_map(|s| match (s.pid, s.cwd) {
            (Some(pid), Some(cwd)) if !cwd.is_empty() => Some((pid, cwd)),
            _ => None,
        })
        .collect()
}

/// Current working directory of a Luxor terminal's shell.
///
/// Fallback for shells that never report their directory via OSC 7 (cmd.exe,
/// PowerShell without Luxor's prompt hook, …): the terminal panel polls this
/// while saving its snapshot so a restart reopens in the same folder. Only
/// answers for pids owned by Luxor PTY sessions; `None` for anything else.
#[tauri::command(async)]
pub fn pty_cwd(state: State<'_, AppState>, pid: u32) -> Result<Option<String>, Error> {
    let pty_pids: HashSet<u32> = state.pty.list().into_iter().filter_map(|s| s.pid).collect();
    Ok(luxor_core::agents::terminal_cwd(
        pid,
        &pty_pids,
        &pty_spawn_dirs(&state),
    ))
}
