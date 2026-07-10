//! Discord Rich Presence commands (plan parts 4, 5, 8).
//!
//! The heavy logic lives in [`luxor_core::discord`]; this module hosts the
//! stateful [`DiscordEngine`] (carousel + priority queue + IPC transport) and
//! the thin Tauri commands the frontend calls to configure it and push the
//! current activity context.

use std::time::{Duration, Instant};

use luxor_core::discord::{
    build_carousel_frames, blacklisted, mask_project_name, Carousel, DiscordIpc, Presence,
    PresenceButton, PresenceContext, PresenceTemplates, Priority, PriorityQueue, QueuedPresence,
};
use luxor_core::Error;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

/// Default Discord application (client) id. RPC is enabled out of the box
/// (always-on presence while the app is open); the user can turn it off in
/// the Analytics panel.
const DEFAULT_CLIENT_ID: &str = "1519063576348721203";

/// Discord application public key (Ed25519). Only needed if/when an HTTP
/// Interactions endpoint is added; Rich Presence over IPC does not use it.
#[allow(dead_code)]
const APP_PUBLIC_KEY: &str = "d9bda742da3ca73fc3e16c2a02ea9fb18c12e6a84cf25d046692b5dc54dbd78c";

/// User-facing Discord RPC settings (plan part 5.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordSettings {
    pub enabled: bool,
    /// Rotation cadence in seconds (clamped 5..=30).
    pub rotate_seconds: u64,
    pub show_project: bool,
    pub show_branch: bool,
    pub show_agent: bool,
    pub show_audit: bool,
    /// Replace private project/file names with generic labels (part 5.3).
    pub mask_projects: bool,
    /// Glob-ish blacklist (`*work*`, `*nda*`) — match disables RPC (part 5.4).
    pub blacklist: Vec<String>,
    pub client_id: String,
    pub buttons: Vec<PresenceButton>,
    /// Per-frame status text templates (user-configurable, English defaults).
    /// `serde(default)` keeps settings persisted before this field existed
    /// deserializing cleanly.
    #[serde(default)]
    pub templates: PresenceTemplates,
}

impl Default for DiscordSettings {
    fn default() -> Self {
        Self {
            // Always-on by default: presence shows as soon as the app starts,
            // without requiring a trip to the Analytics panel first.
            enabled: true,
            rotate_seconds: 12,
            show_project: true,
            show_branch: true,
            show_agent: true,
            show_audit: true,
            mask_projects: false,
            blacklist: Vec::new(),
            client_id: DEFAULT_CLIENT_ID.to_string(),
            buttons: Vec::new(),
            templates: PresenceTemplates::default(),
        }
    }
}

/// Activity context pushed by the frontend each tick.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PresenceInput {
    pub project_name: Option<String>,
    pub branch: Option<String>,
    pub language: Option<String>,
    pub language_asset: Option<String>,
    pub agent: Option<String>,
    pub agent_asset: Option<String>,
    #[serde(default)]
    pub session_seconds: i64,
    pub session_start_unix: Option<i64>,
    pub lines_scanned: Option<i64>,
    pub open_issues: Option<i64>,
    /// The user is AFK/idle right now — show the dedicated idle frame.
    #[serde(default)]
    pub idle: bool,
    /// Unix seconds when the idle period started (elapsed timer on the frame).
    #[serde(default)]
    pub idle_since_unix: Option<i64>,
}

/// Status returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct DiscordStatus {
    pub enabled: bool,
    /// Backward-compatible UI field: true only after a recent SET_ACTIVITY send.
    pub connected: bool,
    /// Raw socket/pipe handshake state. Useful for diagnostics when a client is
    /// reachable but not showing activity yet.
    pub ipc_connected: bool,
    /// Most recent transport error (pipe not found, handshake rejected, …) so
    /// the settings UI can explain *why* the presence isn't showing.
    pub last_error: Option<String>,
    /// Remaining reconnect backoff in milliseconds, if a retry is scheduled.
    pub reconnect_in_ms: Option<u64>,
}

/// Stateful engine, held behind a `Mutex` in [`AppState`].
pub struct DiscordEngine {
    ipc: DiscordIpc,
    carousel: Carousel,
    queue: PriorityQueue,
    settings: DiscordSettings,
    /// Last activity context received from the frontend driver, replayed by
    /// the backend heartbeat when the webview goes quiet (see [`heartbeat`]).
    last_input: Option<PresenceInput>,
    /// When the frontend last called `discord_update`. `None` until the first
    /// push — the heartbeat must not invent a presence before the driver has
    /// produced one (privacy switches live on the frontend).
    last_frontend_push: Option<Instant>,
}

impl Default for DiscordEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl DiscordEngine {
    pub fn new() -> Self {
        let settings = DiscordSettings::default();
        Self {
            ipc: DiscordIpc::new(settings.client_id.clone()),
            carousel: Carousel::new(Duration::from_secs(settings.rotate_seconds)),
            queue: PriorityQueue::new(),
            settings,
            last_input: None,
            last_frontend_push: None,
        }
    }

    fn apply_settings(&mut self, mut settings: DiscordSettings) {
        // Treat the Rust side as the trust boundary for settings coming from the
        // UI: clamp cadence, trim blacklist noise and sanitize buttons here too.
        settings.rotate_seconds = settings.rotate_seconds.clamp(5, 30);
        settings.blacklist = settings
            .blacklist
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        settings.buttons.retain(|b| b.url.starts_with("https://"));
        settings.buttons.truncate(2);
        // Cleared template inputs fall back to the English defaults so an
        // empty textbox never produces a blank Discord status line.
        settings.templates = settings.templates.normalized();
        // Re-create the IPC transport if the client id changed.
        if settings.client_id != self.settings.client_id {
            tracing::info!(
                target: "luxor::discord",
                client_id = %settings.client_id,
                "client_id changed, recreating IPC transport"
            );
            let _ = self.ipc.clear();
            self.ipc = DiscordIpc::new(settings.client_id.clone());
        }
        if settings.enabled != self.settings.enabled {
            tracing::info!(
                target: "luxor::discord",
                enabled = settings.enabled,
                "Rich Presence toggled"
            );
        }
        tracing::debug!(
            target: "luxor::discord",
            enabled = settings.enabled,
            rotate_s = settings.rotate_seconds,
            show_project = settings.show_project,
            show_branch = settings.show_branch,
            show_agent = settings.show_agent,
            show_audit = settings.show_audit,
            mask_projects = settings.mask_projects,
            blacklist_patterns = settings.blacklist.len(),
            buttons = settings.buttons.len(),
            "settings applied"
        );
        self.carousel
            .set_interval(Duration::from_secs(settings.rotate_seconds));
        self.settings = settings;
        if !self.settings.enabled {
            let _ = self.ipc.clear();
        }
    }

    fn context_from(&self, input: PresenceInput) -> PresenceContext {
        let mask = self.settings.mask_projects;
        let project_name = input
            .project_name
            .map(|n| mask_project_name(&n, mask));
        // When masking is on, a private branch name (e.g. `feature/project-titan`)
        // must not leak to Discord either (plan 5.3).
        let branch = match (input.branch, mask) {
            (Some(_), true) => Some("🔒 private".to_string()),
            (b, _) => b,
        };
        PresenceContext {
            project_name,
            branch,
            language: input.language,
            language_asset: input.language_asset,
            agent: input.agent,
            agent_asset: input.agent_asset,
            session_seconds: input.session_seconds,
            session_start_unix: input.session_start_unix,
            lines_scanned: input.lines_scanned,
            open_issues: input.open_issues,
            idle: input.idle,
            idle_since_unix: input.idle_since_unix,
            templates: self.settings.templates.clone(),
            buttons: self.settings.buttons.clone(),
            show_project: self.settings.show_project,
            show_branch: self.settings.show_branch,
            show_agent: self.settings.show_agent,
            show_audit: self.settings.show_audit,
        }
    }

    /// Tick the engine with a fresh context; returns the presence actually
    /// shown (for the frontend live preview), or `None` when nothing is sent.
    fn tick(&mut self, input: PresenceInput) -> Result<Option<Presence>, Error> {
        if !self.settings.enabled || self.settings.client_id.is_empty() {
            return Ok(None);
        }
        let ctx = self.context_from(input);

        // Blacklist: any match on branch/project disables RPC (part 5.4).
        let blocked = ctx
            .branch
            .as_deref()
            .map(|b| blacklisted(b, &self.settings.blacklist))
            .unwrap_or(false)
            || ctx
                .project_name
                .as_deref()
                .map(|p| blacklisted(p, &self.settings.blacklist))
                .unwrap_or(false);
        if blocked {
            tracing::debug!(
                target: "luxor::discord",
                project = ctx.project_name.as_deref().unwrap_or("-"),
                branch = ctx.branch.as_deref().unwrap_or("-"),
                "presence blocked by privacy blacklist, clearing"
            );
            let _ = self.ipc.clear();
            return Ok(None);
        }

        self.carousel.set_frames(build_carousel_frames(&ctx));
        let now = Instant::now();
        // Clone the override out first so the queue borrow ends before we touch
        // the carousel (keeps the borrow checker happy with disjoint fields).
        let override_presence = self.queue.active(now).cloned();
        let presence = match override_presence {
            Some(p) => p,
            None => match self.carousel.current(now) {
                Some(p) => p,
                None => return Ok(None),
            },
        };
        // Best-effort: a transport error (Discord closed) is not fatal — the
        // engine reconnects with backoff on the next tick.
        match self.ipc.set_activity(&presence, now, false) {
            Ok(true) => tracing::debug!(target: "luxor::discord", "tick: frame sent"),
            Ok(false) => {}
            // Warn (not debug): a persistent transport/validation failure is
            // exactly what the user needs to see when "Discord shows nothing".
            Err(e) => tracing::warn!(target: "luxor::discord", "tick: set_activity failed: {e}"),
        }
        Ok(Some(presence))
    }

    /// Backend-driven keep-alive tick (see `spawn_discord_heartbeat` in
    /// `lib.rs`). The carousel is normally ticked by the frontend driver, but
    /// WebView2 throttles JS timers aggressively once the window is hidden to
    /// the tray or minimized — the presence then froze on one frame and went
    /// stale until the window was restored. When the frontend has gone quiet,
    /// replay the last received context so rotation, reconnect-with-backoff
    /// and the priority queue all keep working while the app sits in the tray.
    ///
    /// Timers stay honest while quiet: `session_start_unix` / `idle_since_unix`
    /// are absolute stamps Discord renders as elapsed time, so they don't need
    /// recomputation. A quiet webview also means no keyboard/mouse in the app,
    /// so the context itself ("working on X") remains an accurate description.
    pub fn heartbeat(&mut self, quiet_after: Duration) {
        if !self.settings.enabled || self.settings.client_id.is_empty() {
            return;
        }
        let (Some(last_push), Some(input)) = (self.last_frontend_push, self.last_input.clone())
        else {
            return; // frontend never pushed — nothing trustworthy to replay
        };
        if last_push.elapsed() < quiet_after {
            return; // driver is alive; let it own the cadence
        }
        tracing::trace!(
            target: "luxor::discord",
            quiet_s = last_push.elapsed().as_secs(),
            "heartbeat: frontend quiet, replaying last context"
        );
        if let Err(e) = self.tick(input) {
            tracing::debug!(target: "luxor::discord", "heartbeat tick failed: {e}");
        }
    }

    /// Immediately surface the active high-priority queued presence, bypassing
    /// the carousel cadence and the rate-limit so a Priority-1 (critical) event
    /// interrupts everything at once (plan 4.2). No-op when RPC is disabled.
    fn flush_priority(&mut self) {
        if !self.settings.enabled || self.settings.client_id.is_empty() {
            return;
        }
        let now = Instant::now();
        if let Some(p) = self.queue.active(now).cloned() {
            tracing::debug!(
                target: "luxor::discord",
                details = p.details.as_deref().unwrap_or("-"),
                "flushing priority presence (forced)"
            );
            if let Err(e) = self.ipc.set_activity(&p, now, true) {
                tracing::warn!(target: "luxor::discord", "priority force update failed: {e}");
            }
        }
    }

    /// Queue a Critical presence and surface it immediately (plan 4.2). Used by
    /// producers like the audit runner when it finds critical issues.
    pub fn push_critical(&mut self, details: String, label: Option<String>) {
        let presence = Presence {
            details: Some(details),
            state: label,
            ..Default::default()
        }
        .sanitized();
        self.queue.push(
            QueuedPresence {
                presence,
                priority: Priority::Critical,
                hold: Duration::from_secs(15),
            },
            Instant::now(),
        );
        self.flush_priority();
    }

    fn status(&self) -> DiscordStatus {
        let now = Instant::now();
        DiscordStatus {
            enabled: self.settings.enabled,
            connected: self.ipc.has_recent_activity(now),
            ipc_connected: self.ipc.is_connected(),
            last_error: self.ipc.last_error().map(str::to_string),
            reconnect_in_ms: self.ipc.reconnect_in_ms(now),
        }
    }
}

fn lock<'a>(state: &'a State<'_, AppState>) -> std::sync::MutexGuard<'a, DiscordEngine> {
    state
        .discord
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[tauri::command(async)]
pub fn discord_status(state: State<'_, AppState>) -> Result<DiscordStatus, Error> {
    Ok(lock(&state).status())
}

#[tauri::command(async)]
pub fn discord_apply_settings(
    state: State<'_, AppState>,
    settings: DiscordSettings,
) -> Result<DiscordStatus, Error> {
    let mut engine = lock(&state);
    engine.apply_settings(settings);
    Ok(engine.status())
}

#[tauri::command(async)]
pub fn discord_update(
    state: State<'_, AppState>,
    context: PresenceInput,
) -> Result<Option<Presence>, Error> {
    let mut engine = lock(&state);
    // Remember the context + push time for the backend heartbeat, which takes
    // over the carousel cadence when the webview's timers get throttled.
    engine.last_input = Some(context.clone());
    engine.last_frontend_push = Some(Instant::now());
    engine.tick(context)
}

/// Push a transient, high-priority status (part 4.2), e.g. a critical audit
/// finding that should interrupt the carousel.
#[tauri::command]
pub fn discord_push_event(
    state: State<'_, AppState>,
    details: String,
    label: Option<String>,
    priority: Option<String>,
    hold_seconds: Option<u64>,
) -> Result<(), Error> {
    let prio = match priority.as_deref() {
        Some("critical") => Priority::Critical,
        Some("action") => Priority::Action,
        _ => Priority::Background,
    };
    let presence = Presence {
        details: Some(details),
        state: label,
        ..Default::default()
    }
    .sanitized();
    let mut engine = lock(&state);
    engine.queue.push(
        QueuedPresence {
            presence,
            priority: prio,
            hold: Duration::from_secs(hold_seconds.unwrap_or(15).clamp(5, 60)),
        },
        Instant::now(),
    );
    // Critical events interrupt the carousel immediately rather than waiting
    // for the next driver tick + rate-limit window (plan 4.2, Priority 1).
    if prio == Priority::Critical {
        engine.flush_priority();
    }
    Ok(())
}

#[tauri::command(async)]
pub fn discord_clear(state: State<'_, AppState>) -> Result<(), Error> {
    let mut engine = lock(&state);
    // An explicit clear is a privacy action (collect off / paranoid mode):
    // the heartbeat must not resurrect the cleared presence from a stale
    // context, so forget it entirely.
    engine.last_input = None;
    engine.last_frontend_push = None;
    engine.ipc.clear()
}
