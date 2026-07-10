//! Shared application state managed by Tauri.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, RwLock};

use luxor_core::agents::AgentSampler;
use luxor_core::config::AppConfig;
use luxor_core::projects::Registry;
use luxor_core::pty::PtyManager;
use luxor_core::stats::StatsSampler;
use luxor_core::telemetry::TelemetryStore;

use crate::commands::discord::DiscordEngine;

pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub config_path: PathBuf,
    pub presets_dir: PathBuf,
    pub registry: Mutex<Registry>,
    pub pty: PtyManager,
    pub stats: Mutex<StatsSampler>,
    pub agents: Mutex<AgentSampler>,
    /// Local-first activity telemetry store (`local_stats.db`). See
    /// [`luxor_core::telemetry`].
    pub telemetry: Mutex<TelemetryStore>,
    /// Discord Rich Presence engine (carousel + priority queue + IPC).
    pub discord: Mutex<DiscordEngine>,
    /// Last audit "actionable" issue count (critical+high) per project path, so
    /// a re-run can credit how many were *fixed* since last time (plan 1.3).
    pub audit_last: Mutex<std::collections::HashMap<String, i64>>,
    /// `(id, name)` of recent projects shown in the tray menu. Kept here so
    /// the tray can be rebuilt outside of the `tray_set_projects` command
    /// (e.g. when the "background" checkbox toggles).
    pub tray_projects: Mutex<Vec<(String, String)>>,
    /// Physical screen position of the last tray click, so the popup can be
    /// re-anchored after the frontend resizes it to fit its content.
    pub tray_cursor: Mutex<Option<(f64, f64)>>,
    /// Monotonic counter bumped every time the tray popup is shown. The
    /// focus-loss watchdog thread captures the value current at its launch and
    /// exits the moment a newer show supersedes it, so at most one watchdog is
    /// ever alive for the popup. See `show_tray_popup`.
    pub tray_popup_gen: AtomicU64,
    /// Instant of the most recent tray popup show. All "auto-hide" paths
    /// (main-window focus, cursor-outside checks) honour a short grace window
    /// after this so the focus/blur churn that follows `set_focus` on a
    /// transparent always-on-top window can never dismiss the menu before the
    /// user even sees it (the "tray menu doesn't open" bug).
    pub tray_popup_shown_at: Mutex<Option<std::time::Instant>>,
    /// Set once we've shown the "Luxor is still running in the tray" hint after
    /// the user closed the window to the tray. Keeps the hint to a single,
    /// non-annoying notification per app run so first-time users learn where
    /// the window went without being nagged on every close.
    pub tray_hint_shown: AtomicBool,
}
