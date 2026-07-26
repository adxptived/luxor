//! Discord Rich Presence integration (see plan parts 4 & 8).
//!
//! Two layers, deliberately split so the interesting logic is unit-testable
//! without a running Discord client:
//!
//! 1. **Presence logic** ([`Carousel`], [`PriorityQueue`], [`build_activity`],
//!    masking helpers, anti-flicker [`state_hash`]) — pure, no I/O.
//! 2. **Transport** ([`DiscordIpc`]) — raw Discord IPC over a local socket
//!    (Unix Domain Socket on macOS/Linux, Named Pipe on Windows). Implemented
//!    with `std` only — no extra crates — using the documented opcode framing.
//!
//! UI limits (part 4): 1 large image, 1 small image, two 128-char text lines
//! (details/state), up to 2 buttons whose URLs must be `https://`.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Max length of a presence text line (Discord truncates beyond this).
pub const MAX_TEXT: usize = 128;
/// Minimum interval between presence updates (part 8.3 rate limit).
pub const MIN_UPDATE_INTERVAL: Duration = Duration::from_secs(15);
/// Jitter tolerance for the rate limit. The frontend driver ticks every 15 s —
/// the same as [`MIN_UPDATE_INTERVAL`] — so timer jitter (a tick arriving at
/// 14.97 s) must not silently drop every other update and freeze the carousel.
pub const RATE_LIMIT_GRACE: Duration = Duration::from_millis(1500);
/// Re-send an unchanged activity periodically. This is both a lightweight
/// liveness probe and a recovery path when Discord restarted without the local
/// socket reporting a write failure immediately.
pub const ACTIVITY_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(60);
/// Discord button labels are short UI affordances; clamp defensively so a bad
/// settings payload cannot make the whole activity invalid.
pub const MAX_BUTTON_LABEL: usize = 32;

/// A button shown under the presence card. URL must be https.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresenceButton {
    pub label: String,
    pub url: String,
}

/// A fully-resolved presence frame ready to send (part 8.2).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Presence {
    pub details: Option<String>,
    pub state: Option<String>,
    /// Unix seconds — Discord renders an "elapsed" timer.
    pub start_timestamp: Option<i64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
    pub buttons: Vec<PresenceButton>,
}

impl Presence {
    /// Clamp text fields to Discord limits and drop non-https buttons.
    ///
    /// Discord's RPC validation also rejects the **entire** SET_ACTIVITY when
    /// any present text field is shorter than 2 characters, so under-length
    /// fields (e.g. a user template rendering to "" or "-") are dropped rather
    /// than sent — one bad field must not blank the whole presence.
    pub fn sanitized(mut self) -> Presence {
        fn text_field(s: String) -> Option<String> {
            let t = s.trim();
            (t.chars().count() >= 2).then(|| clamp(t, MAX_TEXT))
        }
        self.details = self.details.and_then(text_field);
        self.state = self.state.and_then(text_field);
        self.large_text = self.large_text.and_then(text_field);
        self.small_text = self.small_text.and_then(text_field);
        self.buttons
            .retain(|b| b.url.starts_with("https://") && !b.label.trim().is_empty());
        for b in &mut self.buttons {
            b.label = clamp(b.label.trim(), MAX_BUTTON_LABEL);
        }
        self.buttons.truncate(2);
        self
    }

    /// Build the Discord `activity` JSON payload (part 8.2).
    pub fn to_activity_json(&self) -> serde_json::Value {
        let mut assets = serde_json::Map::new();
        if let Some(v) = &self.large_image {
            assets.insert("large_image".into(), v.clone().into());
        }
        if let Some(v) = &self.large_text {
            assets.insert("large_text".into(), v.clone().into());
        }
        if let Some(v) = &self.small_image {
            assets.insert("small_image".into(), v.clone().into());
        }
        if let Some(v) = &self.small_text {
            assets.insert("small_text".into(), v.clone().into());
        }
        let mut activity = serde_json::Map::new();
        if let Some(v) = &self.details {
            activity.insert("details".into(), v.clone().into());
        }
        if let Some(v) = &self.state {
            activity.insert("state".into(), v.clone().into());
        }
        if let Some(ts) = self.start_timestamp {
            activity.insert(
                "timestamps".into(),
                serde_json::json!({ "start": ts }),
            );
        }
        if !assets.is_empty() {
            activity.insert("assets".into(), serde_json::Value::Object(assets));
        }
        if !self.buttons.is_empty() {
            let btns: Vec<_> = self
                .buttons
                .iter()
                .map(|b| serde_json::json!({ "label": b.label, "url": b.url }))
                .collect();
            activity.insert("buttons".into(), serde_json::Value::Array(btns));
        }
        serde_json::Value::Object(activity)
    }
}

/// Priority of a queued presence (part 4.2). Higher value wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Background carousel frames (rotated).
    Background = 0,
    /// A concrete action the user just took ("editing src/main.rs").
    Action = 1,
    /// Critical, interrupts everything (e.g. "found a 0-day!").
    Critical = 2,
}

/// A presence with a priority and a minimum on-screen duration.
#[derive(Debug, Clone)]
pub struct QueuedPresence {
    pub presence: Presence,
    pub priority: Priority,
    pub hold: Duration,
}

/// Holds a transient high-priority presence that overrides the carousel until
/// it expires (part 4.2).
#[derive(Default)]
pub struct PriorityQueue {
    current: Option<(QueuedPresence, Instant)>,
}

impl PriorityQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a presence; it only replaces the current one if its priority is
    /// >= the active one (so Critical can't be demoted by Action).
    pub fn push(&mut self, q: QueuedPresence, now: Instant) {
        let replace = match &self.current {
            None => true,
            Some((cur, started)) => {
                let expired = now.duration_since(*started) >= cur.hold;
                q.priority >= cur.priority || expired
            }
        };
        if replace {
            self.current = Some((q, now));
        }
    }

    /// The active override presence, if one is still holding.
    pub fn active(&mut self, now: Instant) -> Option<&Presence> {
        if let Some((q, started)) = &self.current {
            if now.duration_since(*started) < q.hold {
                return self.current.as_ref().map(|(q, _)| &q.presence);
            }
        }
        self.current = None;
        None
    }
}

/// Rotates a set of carousel frames on a fixed cadence (part 4.1).
pub struct Carousel {
    frames: Vec<Presence>,
    interval: Duration,
    idx: usize,
    last_switch: Instant,
}

impl Carousel {
    pub fn new(interval: Duration) -> Self {
        Self {
            frames: Vec::new(),
            interval: interval.max(Duration::from_secs(5)),
            idx: 0,
            last_switch: Instant::now(),
        }
    }

    pub fn set_frames(&mut self, frames: Vec<Presence>) {
        self.frames = frames;
        if self.idx >= self.frames.len() {
            self.idx = 0;
        }
    }

    pub fn set_interval(&mut self, interval: Duration) {
        self.interval = interval.clamp(Duration::from_secs(5), Duration::from_secs(30));
    }

    /// Returns the current frame, advancing if the interval has elapsed.
    pub fn current(&mut self, now: Instant) -> Option<Presence> {
        if self.frames.is_empty() {
            return None;
        }
        if now.duration_since(self.last_switch) >= self.interval {
            self.idx = (self.idx + 1) % self.frames.len();
            self.last_switch = now;
        }
        Some(self.frames[self.idx].clone())
    }
}

/// User-customizable text templates for every activity frame. Placeholders
/// (`{project}`, `{branch}`, `{agent}`, `{session}`, `{lines}`, `{issues}`)
/// are substituted at render time; unknown placeholders pass through as-is.
/// Empty/whitespace-only templates fall back to the English defaults so a
/// cleared input never produces a blank Discord status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PresenceTemplates {
    pub idle_details: String,
    pub idle_state: String,
    pub fallback_details: String,
    pub fallback_state: String,
    pub project_details: String,
    pub project_state: String,
    pub agent_details: String,
    pub agent_state: String,
    pub audit_details: String,
    pub audit_state_ok: String,
    pub audit_state_issues: String,
}

impl Default for PresenceTemplates {
    fn default() -> Self {
        Self {
            idle_details: "Idle".into(),
            idle_state: "Taking a break".into(),
            fallback_details: "Working in Luxor".into(),
            fallback_state: "Session: {session}".into(),
            project_details: "Working on {project}".into(),
            project_state: "On branch {branch}".into(),
            agent_details: "Pair programming with {agent}".into(),
            agent_state: "Session: {session}".into(),
            audit_details: "Scanned {lines}".into(),
            audit_state_ok: "No issues found".into(),
            audit_state_issues: "{issues} issues found".into(),
        }
    }
}

impl PresenceTemplates {
    /// Replace empty/whitespace-only fields with the defaults. Applied at the
    /// settings trust boundary so a cleared UI input can't blank a frame.
    pub fn normalized(mut self) -> Self {
        let d = Self::default();
        let fix = |v: &mut String, def: String| {
            if v.trim().is_empty() {
                *v = def;
            }
        };
        fix(&mut self.idle_details, d.idle_details);
        fix(&mut self.idle_state, d.idle_state);
        fix(&mut self.fallback_details, d.fallback_details);
        fix(&mut self.fallback_state, d.fallback_state);
        fix(&mut self.project_details, d.project_details);
        fix(&mut self.project_state, d.project_state);
        fix(&mut self.agent_details, d.agent_details);
        fix(&mut self.agent_state, d.agent_state);
        fix(&mut self.audit_details, d.audit_details);
        fix(&mut self.audit_state_ok, d.audit_state_ok);
        fix(&mut self.audit_state_issues, d.audit_state_issues);
        self
    }
}

/// Substitute `{placeholder}` tokens in a user template with live values.
pub fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

/// Inputs the engine assembles from telemetry to build carousel frames.
#[derive(Debug, Clone, Default)]
pub struct PresenceContext {
    pub project_name: Option<String>,
    pub branch: Option<String>,
    pub language: Option<String>,
    pub language_asset: Option<String>,
    pub agent: Option<String>,
    pub agent_asset: Option<String>,
    pub session_seconds: i64,
    pub session_start_unix: Option<i64>,
    pub lines_scanned: Option<i64>,
    pub open_issues: Option<i64>,
    pub buttons: Vec<PresenceButton>,
    /// User is AFK / idle (plan 1.4): show a dedicated idle frame instead of
    /// the regular carousel so Discord reflects what the user is *actually*
    /// doing.
    pub idle: bool,
    /// Unix seconds when the idle period started (drives the elapsed timer on
    /// the idle frame).
    pub idle_since_unix: Option<i64>,
    /// Per-frame text templates (user-configurable, English defaults).
    pub templates: PresenceTemplates,
    /// Privacy toggles (part 5.2).
    pub show_project: bool,
    pub show_branch: bool,
    pub show_agent: bool,
    pub show_audit: bool,
}

impl PresenceContext {
    /// Placeholder values shared by all frame templates.
    fn template_vars(&self) -> Vec<(&'static str, String)> {
        vec![
            ("project", self.project_name.clone().unwrap_or_else(|| "—".into())),
            ("branch", self.branch.clone().unwrap_or_else(|| "—".into())),
            ("agent", self.agent.clone().unwrap_or_else(|| "AI".into())),
            ("session", fmt_duration(self.session_seconds)),
            ("lines", fmt_lines(self.lines_scanned.unwrap_or(0))),
            ("issues", self.open_issues.unwrap_or(0).to_string()),
        ]
    }

    fn render(&self, template: &str) -> String {
        let vars = self.template_vars();
        let borrowed: Vec<(&str, &str)> =
            vars.iter().map(|(k, v)| (*k, v.as_str())).collect();
        render_template(template, &borrowed)
    }
}

/// The single frame shown while the user is AFK/idle (plan 1.4). Replaces the
/// whole carousel so "idle" is always visible instead of a stale coding status.
pub fn build_idle_presence(ctx: &PresenceContext) -> Presence {
    Presence {
        details: Some(ctx.render(&ctx.templates.idle_details)),
        state: Some(ctx.render(&ctx.templates.idle_state)),
        large_image: Some("luxor".into()),
        large_text: Some("Luxor".into()),
        start_timestamp: ctx.idle_since_unix,
        buttons: ctx.buttons.clone(),
        ..Default::default()
    }
    .sanitized()
}

/// The always-on fallback frame: shown when no richer frame is available so
/// there is *always* some activity while the app is open.
pub fn build_fallback_presence(ctx: &PresenceContext) -> Presence {
    Presence {
        details: Some(ctx.render(&ctx.templates.fallback_details)),
        state: Some(ctx.render(&ctx.templates.fallback_state)),
        large_image: Some("luxor".into()),
        large_text: Some("Luxor".into()),
        start_timestamp: ctx.session_start_unix,
        buttons: ctx.buttons.clone(),
        ..Default::default()
    }
    .sanitized()
}

/// Build the three rotating carousel frames (part 4.1).
///
/// Guarantees at least one frame: when the user is idle a dedicated AFK frame
/// replaces the carousel, and when no toggle produces a frame a generic
/// fallback is used — so presence never silently disappears while the app is
/// open (the "RPC doesn't work" symptom when all toggles were off).
pub fn build_carousel_frames(ctx: &PresenceContext) -> Vec<Presence> {
    if ctx.idle {
        return vec![build_idle_presence(ctx)];
    }
    let mut frames = Vec::new();

    // Frame 1 — project.
    if ctx.show_project {
        let mut f = Presence {
            details: Some(ctx.render(&ctx.templates.project_details)),
            large_image: ctx.language_asset.clone().or_else(|| Some("luxor".into())),
            large_text: ctx.language.clone(),
            buttons: ctx.buttons.clone(),
            start_timestamp: ctx.session_start_unix,
            ..Default::default()
        };
        if ctx.show_branch && ctx.branch.is_some() {
            f.state = Some(ctx.render(&ctx.templates.project_state));
        }
        frames.push(f.sanitized());
    }

    // Frame 2 — AI collaboration.
    if ctx.show_agent {
        if let Some(agent) = &ctx.agent {
            frames.push(
                Presence {
                    details: Some(ctx.render(&ctx.templates.agent_details)),
                    state: Some(ctx.render(&ctx.templates.agent_state)),
                    large_image: ctx.agent_asset.clone().or_else(|| Some("ai_generic".into())),
                    large_text: Some(format!("{agent} active")),
                    small_image: Some("luxor".into()),
                    small_text: Some("Luxor".into()),
                    buttons: ctx.buttons.clone(),
                    start_timestamp: ctx.session_start_unix,
                }
                .sanitized(),
            );
        }
    }

    // Frame 3 — audit.
    if ctx.show_audit {
        if let (Some(_scanned), Some(issues)) = (ctx.lines_scanned, ctx.open_issues) {
            let asset = if issues == 0 { "audit_ok" } else { "audit_warn" };
            frames.push(
                Presence {
                    details: Some(ctx.render(&ctx.templates.audit_details)),
                    state: Some(if issues == 0 {
                        ctx.render(&ctx.templates.audit_state_ok)
                    } else {
                        ctx.render(&ctx.templates.audit_state_issues)
                    }),
                    large_image: Some(asset.into()),
                    large_text: Some("Luxor Audit".into()),
                    buttons: ctx.buttons.clone(),
                    ..Default::default()
                }
                .sanitized(),
            );
        }
    }

    // Always-on guarantee: never return an empty carousel while the app runs.
    if frames.is_empty() {
        frames.push(build_fallback_presence(ctx));
    }

    frames
}

// ----- masking (part 5.3) -----------------------------------------------

/// Replace a private project name with a generic masked label (part 5.3).
pub fn mask_project_name(name: &str, masked: bool) -> String {
    if masked {
        "🔒 Private Project".into()
    } else {
        name.into()
    }
}

/// Mask a file path down to its extension class, e.g.
/// `src/auth_keys.rs` → `Editing a *.rs file` (part 5.3).
pub fn mask_file_label(path: &str, masked: bool) -> String {
    if !masked {
        return format!("Editing {path}");
    }
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("file");
    format!("Editing a *.{ext} file")
}

/// Whether any blacklist pattern (glob-ish `*word*`) matches the branch or
/// folder, in which case RPC must be disabled for it (part 5.4).
pub fn blacklisted(value: &str, patterns: &[String]) -> bool {
    let v = value.to_ascii_lowercase();
    patterns.iter().any(|p| glob_match(&p.to_ascii_lowercase(), &v))
}

/// Glob-style match where `*` is a wildcard and everything else is literal
/// (e.g. `*work*`, `wip-*`). Empty / all-`*` patterns never match so they
/// can't accidentally disable RPC for everything (part 5.4).
fn glob_match(pattern: &str, value: &str) -> bool {
    if pattern.trim_matches('*').is_empty() {
        return false;
    }
    // Translate the glob into a regex: escape literal segments, join with `.*`.
    let body = pattern
        .split('*')
        .map(regex::escape)
        .collect::<Vec<_>>()
        .join(".*");
    match regex::Regex::new(&body) {
        Ok(rx) => rx.is_match(value),
        // Fall back to a substring test if the pattern can't compile.
        Err(_) => value.contains(pattern.trim_matches('*')),
    }
}

// ----- anti-flicker (part 8.3) ------------------------------------------

/// Stable hash of a presence so we can skip identical updates (part 8.3).
pub fn state_hash(p: &Presence) -> u64 {
    let mut h = DefaultHasher::new();
    p.details.hash(&mut h);
    p.state.hash(&mut h);
    p.large_image.hash(&mut h);
    p.large_text.hash(&mut h);
    p.small_image.hash(&mut h);
    p.small_text.hash(&mut h);
    for b in &p.buttons {
        b.label.hash(&mut h);
        b.url.hash(&mut h);
    }
    h.finish()
}

fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
    }
}

/// Human "2h 10m" style duration (part 3.1 / 4).
pub fn fmt_duration(seconds: i64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

fn fmt_lines(n: i64) -> String {
    if n >= 1000 {
        format!("{:.1}k lines", n as f64 / 1000.0)
    } else {
        format!("{n} lines")
    }
}

// ===== transport: raw Discord IPC (part 8.1) ============================

/// Connection to the local Discord client over IPC. Sends `SET_ACTIVITY`
/// frames using the documented opcode framing. `std`-only, no extra crates.
pub struct DiscordIpc {
    client_id: String,
    stream: Option<IpcStream>,
    last_update: Option<Instant>,
    last_hash: Option<u64>,
    last_successful_activity: Option<Instant>,
    backoff: Duration,
    next_connect_at: Option<Instant>,
    /// Human-readable reason for the most recent transport failure, surfaced
    /// in the UI so "RPC silently does nothing" becomes diagnosable.
    last_error: Option<String>,
    /// How to obtain a transport. Injectable so tests can exercise the
    /// connect/backoff state machine without depending on whether the developer
    /// happens to have Discord running — probing the real socket made
    /// `reconnect_backoff_throttles_missing_discord` pass or fail based on host
    /// state rather than on the code under test.
    connector: fn() -> Option<IpcStream>,
}

impl DiscordIpc {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self::with_connector(client_id, IpcStream::connect)
    }

    /// [`DiscordIpc::new`] with an explicit transport factory. Deliberately
    /// crate-private: `IpcStream` is a private type, so a `pub` signature here
    /// would leak it out of the module.
    fn with_connector(
        client_id: impl Into<String>,
        connector: fn() -> Option<IpcStream>,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            stream: None,
            last_update: None,
            last_hash: None,
            last_successful_activity: None,
            backoff: Duration::from_secs(1),
            next_connect_at: None,
            last_error: None,
            connector,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.stream.is_some()
    }

    /// The most recent transport error, if any (cleared on a successful send).
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    /// Remaining reconnect backoff in milliseconds, for user-facing status.
    pub fn reconnect_in_ms(&self, now: Instant) -> Option<u64> {
        self.next_connect_at
            .and_then(|deadline| deadline.checked_duration_since(now))
            .map(|remaining| remaining.as_millis().min(u64::MAX as u128) as u64)
    }

    /// True only after a SET_ACTIVITY frame was actually written recently. This
    /// avoids the misleading UI state where the handshake socket is open but no
    /// activity has been accepted/sent yet (rate-limit, stale socket, wrong client).
    pub fn has_recent_activity(&self, now: Instant) -> bool {
        self.last_successful_activity
            .map(|sent| now.duration_since(sent) <= Duration::from_secs(90))
            .unwrap_or(false)
    }

    /// Try to connect to discord-ipc-0..9 and perform the v1 handshake.
    pub fn connect(&mut self, now: Instant) -> Result<()> {
        if self.stream.is_some() {
            return Ok(());
        }
        if let Some(next) = self.next_connect_at {
            if now < next {
                tracing::trace!(
                    target: "luxor_core::discord",
                    remaining_ms = next.duration_since(now).as_millis() as u64,
                    "reconnect suppressed: backoff active"
                );
                return Err(Error::Process("discord reconnect backoff active".into()));
            }
        }
        tracing::debug!(target: "luxor_core::discord", client_id = %self.client_id, "connecting to Discord IPC");
        let mut stream = match (self.connector)() {
            Some(stream) => stream,
            None => {
                let delay = self.next_backoff();
                self.next_connect_at = Some(now + delay);
                let msg = "no Discord IPC socket found (is Discord running?)";
                tracing::warn!(
                    target: "luxor_core::discord",
                    retry_in_s = delay.as_secs(),
                    "connect failed: {msg}"
                );
                self.last_error = Some(msg.into());
                return Err(Error::Process(msg.into()));
            }
        };
        // Opcode 0 = handshake.
        let handshake = serde_json::json!({ "v": 1, "client_id": self.client_id });
        tracing::debug!(target: "luxor_core::discord", "socket found, sending handshake (v1)");
        if let Err(e) = write_frame(&mut stream, 0, &handshake) {
            let delay = self.next_backoff();
            self.next_connect_at = Some(now + delay);
            tracing::warn!(
                target: "luxor_core::discord",
                retry_in_s = delay.as_secs(),
                "handshake write failed: {e}"
            );
            self.last_error = Some(format!("handshake write failed: {e}"));
            return Err(e);
        }
        // Bound the handshake reply read. On Windows a named-pipe `read` has no
        // timeout and can block forever against a stale pipe, wedging the whole
        // engine (and the mutex around it) — poll readability with a deadline
        // first. On Unix the socket read timeout set at connect time applies.
        if let Err(e) = stream.wait_readable(Instant::now() + Duration::from_millis(1500)) {
            let delay = self.next_backoff();
            self.next_connect_at = Some(now + delay);
            tracing::warn!(
                target: "luxor_core::discord",
                retry_in_s = delay.as_secs(),
                "handshake reply timed out (stale pipe?): {e}"
            );
            self.last_error = Some(format!("handshake reply timed out: {e}"));
            return Err(Error::Io(e));
        }
        // Read Discord's reply. Opcode 2 (CLOSE) means the handshake was
        // rejected (e.g. an invalid client_id); treat that as a failed connect
        // so the backoff/reconnect loop keeps retrying instead of silently
        // writing frames that Discord ignores.
        match read_frame(&mut stream) {
            Ok((2, v)) => {
                let delay = self.next_backoff();
                self.next_connect_at = Some(now + delay);
                let msg = format!("discord rejected handshake (check client_id): {v}");
                tracing::error!(
                    target: "luxor_core::discord",
                    client_id = %self.client_id,
                    retry_in_s = delay.as_secs(),
                    "handshake rejected (opcode CLOSE): {v}"
                );
                self.last_error = Some(msg.clone());
                return Err(Error::Process(msg));
            }
            Ok((opcode, v)) => {
                tracing::debug!(
                    target: "luxor_core::discord",
                    opcode,
                    evt = v.get("evt").and_then(|e| e.as_str()).unwrap_or("-"),
                    user = v.pointer("/data/user/username").and_then(|u| u.as_str()).unwrap_or("-"),
                    "handshake accepted (READY)"
                );
            }
            Err(e) => {
                let delay = self.next_backoff();
                self.next_connect_at = Some(now + delay);
                tracing::warn!(
                    target: "luxor_core::discord",
                    retry_in_s = delay.as_secs(),
                    "handshake reply failed: {e}"
                );
                self.last_error = Some(format!("handshake reply failed: {e}"));
                return Err(e);
            }
        }
        tracing::info!(target: "luxor_core::discord", "connected to Discord IPC");
        self.stream = Some(stream);
        self.backoff = Duration::from_secs(1);
        self.next_connect_at = None;
        self.last_error = None;
        // A fresh connection has no activity yet: forget the anti-flicker hash
        // so the current frame is re-sent even if it is byte-identical to the
        // last one delivered on the previous session. Without this, a static
        // carousel (constant hash) was never re-sent after Discord restarted —
        // the presence silently stayed gone forever ("RPC stopped working").
        self.last_hash = None;
        self.last_successful_activity = None;
        Ok(())
    }

    /// Exponential backoff reconnect helper (part 8.1). Returns the delay to
    /// wait before the next attempt and doubles it (capped at 60s).
    pub fn next_backoff(&mut self) -> Duration {
        let d = self.backoff;
        self.backoff = (self.backoff * 2).min(Duration::from_secs(60));
        d
    }

    /// Set the activity. Respects the rate limit and anti-flicker hash
    /// (parts 8.3). Returns `true` if a frame was actually sent.
    ///
    /// `force` bypasses the rate-limit so a Priority-1 (critical) status can
    /// interrupt the carousel immediately (plan 4.2). The anti-flicker hash is
    /// still honoured so identical frames are never re-sent.
    pub fn set_activity(&mut self, presence: &Presence, now: Instant, force: bool) -> Result<bool> {
        // Rate limit: at most once per MIN_UPDATE_INTERVAL (unless forced).
        // The grace window absorbs driver timer jitter — an update arriving a
        // few hundred ms "early" is legitimate, not a rate-limit violation.
        if !force {
            if let Some(last) = self.last_update {
                if now.duration_since(last) + RATE_LIMIT_GRACE < MIN_UPDATE_INTERVAL {
                    tracing::trace!(
                        target: "luxor_core::discord",
                        since_last_ms = now.duration_since(last).as_millis() as u64,
                        "set_activity skipped: rate limit"
                    );
                    return Ok(false);
                }
            }
        }
        // Anti-flicker normally skips identical state, but only for a bounded
        // period. Periodic identical re-sends act as a liveness probe: if
        // Discord restarted and this stream became stale, the write/read path
        // below detects it, drops the stream and arms reconnect backoff.
        let hash = state_hash(presence);
        if self.last_hash == Some(hash) {
            let keepalive_due = self
                .last_successful_activity
                .map(|sent| now.duration_since(sent) >= ACTIVITY_KEEPALIVE_INTERVAL)
                .unwrap_or(true);
            if !keepalive_due {
                tracing::trace!(
                    target: "luxor_core::discord",
                    hash,
                    "set_activity skipped: identical frame (anti-flicker)"
                );
                return Ok(false);
            }
            tracing::debug!(
                target: "luxor_core::discord",
                hash,
                "re-sending identical activity as keepalive"
            );
        }
        self.connect(now)?;
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| Error::Process("discord not connected".into()))?;
        let payload = serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": presence.to_activity_json() },
            "nonce": format!("{}-{}", std::process::id(), hash),
        });
        tracing::debug!(
            target: "luxor_core::discord",
            hash,
            force,
            details = presence.details.as_deref().unwrap_or("-"),
            state = presence.state.as_deref().unwrap_or("-"),
            large_image = presence.large_image.as_deref().unwrap_or("-"),
            small_image = presence.small_image.as_deref().unwrap_or("-"),
            buttons = presence.buttons.len(),
            has_timestamp = presence.start_timestamp.is_some(),
            "sending SET_ACTIVITY"
        );
        // Opcode 1 = frame.
        if let Err(e) = write_frame(stream, 1, &payload) {
            self.stream = None; // force reconnect next time
            // The peer never received this frame — a reconnected session must
            // not skip it via the anti-flicker hash.
            self.last_hash = None;
            let delay = self.next_backoff();
            self.next_connect_at = Some(now + delay);
            tracing::warn!(
                target: "luxor_core::discord",
                retry_in_s = delay.as_secs(),
                "SET_ACTIVITY write failed, dropping connection: {e}"
            );
            self.last_error = Some(format!("activity send failed: {e}"));
            return Err(e);
        }
        // Discord replies to every SET_ACTIVITY — either the applied activity
        // or an `evt: "ERROR"` (validation failure, bad asset, …). Fire-and-
        // forget hid those rejections completely: the UI claimed "activity
        // active" while Discord showed nothing. Read the reply (bounded) and
        // surface rejections as errors. A read timeout is treated as success —
        // Discord answers promptly when it answers at all.
        let mut rejected: Option<String> = None;
        let mut closed = false;
        if stream
            .wait_readable(Instant::now() + Duration::from_millis(1200))
            .is_ok()
        {
            match read_frame(stream) {
                // Opcode 2 = CLOSE: the client dropped us (e.g. app restart).
                Ok((2, v)) => {
                    closed = true;
                    rejected = Some(format!("connection closed by Discord: {v}"));
                }
                Ok((opcode, v)) => {
                    if v.get("evt").and_then(|e| e.as_str()) == Some("ERROR") {
                        let msg = v
                            .pointer("/data/message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error");
                        let code = v
                            .pointer("/data/code")
                            .and_then(|c| c.as_i64())
                            .unwrap_or(0);
                        rejected = Some(format!("{msg} (code {code})"));
                    } else {
                        tracing::debug!(
                            target: "luxor_core::discord",
                            opcode,
                            cmd = v.get("cmd").and_then(|c| c.as_str()).unwrap_or("-"),
                            "SET_ACTIVITY acknowledged by Discord"
                        );
                    }
                }
                // Timed-out / partial read: assume delivered rather than flap.
                Err(e) => {
                    tracing::trace!(
                        target: "luxor_core::discord",
                        "SET_ACTIVITY reply not readable (assuming delivered): {e}"
                    );
                }
            }
        } else {
            tracing::trace!(
                target: "luxor_core::discord",
                "SET_ACTIVITY reply wait timed out (assuming delivered)"
            );
        }
        // Remember the frame either way so an identical (still-invalid) frame
        // is not re-spammed every tick; the carousel rotates to new content.
        self.last_update = Some(now);
        self.last_hash = Some(hash);
        if closed {
            self.stream = None;
            // Same as the write-failure path: the next session must re-send
            // the current frame even when its hash is unchanged.
            self.last_hash = None;
            let delay = self.next_backoff();
            self.next_connect_at = Some(now + delay);
            tracing::warn!(
                target: "luxor_core::discord",
                retry_in_s = delay.as_secs(),
                "Discord closed the connection, reconnect scheduled"
            );
        }
        if let Some(reason) = rejected {
            let msg = format!("discord rejected activity: {reason}");
            tracing::error!(
                target: "luxor_core::discord",
                hash,
                details = presence.details.as_deref().unwrap_or("-"),
                state = presence.state.as_deref().unwrap_or("-"),
                "activity rejected: {reason}"
            );
            self.last_error = Some(msg.clone());
            self.last_successful_activity = None;
            return Err(Error::Process(msg));
        }
        tracing::debug!(target: "luxor_core::discord", hash, "activity applied");
        self.last_successful_activity = Some(now);
        self.last_error = None;
        Ok(true)
    }

    /// Clear the presence and drop the connection.
    pub fn clear(&mut self) -> Result<()> {
        tracing::debug!(
            target: "luxor_core::discord",
            was_connected = self.stream.is_some(),
            "clearing presence and dropping connection"
        );
        if let Some(stream) = self.stream.as_mut() {
            let payload = serde_json::json!({
                "cmd": "SET_ACTIVITY",
                "args": { "pid": std::process::id(), "activity": null },
                "nonce": "clear",
            });
            let _ = write_frame(stream, 1, &payload);
        }
        self.stream = None;
        self.last_hash = None;
        self.last_successful_activity = None;
        self.next_connect_at = None;
        self.last_error = None;
        Ok(())
    }
}

fn write_frame(stream: &mut IpcStream, opcode: u32, value: &serde_json::Value) -> Result<()> {
    let body = serde_json::to_vec(value)?;
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&opcode.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    stream.write_all(&buf).map_err(Error::Io)?;
    stream.flush().map_err(Error::Io)?;
    Ok(())
}

fn read_frame(stream: &mut IpcStream) -> Result<(u32, serde_json::Value)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header).map_err(Error::Io)?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    // Defensive cap: a corrupt or hostile frame must not trigger a huge
    // allocation. Discord presence frames are well under this.
    const MAX_FRAME: usize = 64 * 1024;
    if len > MAX_FRAME {
        return Err(Error::Process(format!("discord frame too large: {len} bytes")));
    }
    let mut body = vec![0u8; len];
    stream.read_exact(&mut body).map_err(Error::Io)?;
    let value = serde_json::from_slice(&body)?;
    Ok((opcode, value))
}

/// Platform socket abstraction (Unix Domain Socket / Windows Named Pipe).
enum IpcStream {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    #[cfg(windows)]
    Pipe(std::fs::File),
}

impl IpcStream {
    fn connect() -> Option<IpcStream> {
        #[cfg(unix)]
        {
            use std::os::unix::net::UnixStream;
            // Discord may live under XDG_RUNTIME_DIR, TMPDIR, /tmp, or
            // sandbox subdirs (snap/flatpak). Probe sockets 0..9 in each base.
            let mut bases: Vec<std::path::PathBuf> = Vec::new();
            for env in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
                if let Ok(dir) = std::env::var(env) {
                    if !dir.is_empty() {
                        bases.push(std::path::PathBuf::from(dir));
                    }
                }
            }
            bases.push(std::path::PathBuf::from("/tmp"));
            let extra = [
                // Official Discord packages.
                "snap.discord",
                "app/com.discordapp.Discord",
                "app/com.discordapp.DiscordCanary",
                "app/com.discordapp.DiscordPTB",
                // Vesktop/Vencord and common Flatpak/Snap runtime locations.
                "app/dev.vencord.Vesktop",
                "app/com.vencord.Vesktop",
                "app/com.github.Vencord.Vesktop",
                "app/io.github.vencord.Vesktop",
                "dev.vencord.Vesktop",
                "com.vencord.Vesktop",
                "vesktop",
            ];
            let mut all = bases.clone();
            for b in &bases {
                for e in extra {
                    all.push(b.join(e));
                }
            }
            for base in all {
                for i in 0..10 {
                    let path = base.join(format!("discord-ipc-{i}"));
                    if let Ok(s) = UnixStream::connect(&path) {
                        let timeout = Some(Duration::from_millis(750));
                        let _ = s.set_read_timeout(timeout);
                        let _ = s.set_write_timeout(timeout);
                        tracing::debug!(
                            target: "luxor_core::discord",
                            path = %path.display(),
                            "IPC socket connected"
                        );
                        return Some(IpcStream::Unix(s));
                    }
                }
            }
            tracing::debug!(
                target: "luxor_core::discord",
                "no discord-ipc-0..9 socket found in any known base directory"
            );
            None
        }
        #[cfg(windows)]
        {
            use std::fs::OpenOptions;
            for i in 0..10 {
                let path = format!(r"\\.\pipe\discord-ipc-{i}");
                if let Ok(f) = OpenOptions::new().read(true).write(true).open(&path) {
                    tracing::debug!(
                        target: "luxor_core::discord",
                        path = %path,
                        "IPC named pipe connected"
                    );
                    return Some(IpcStream::Pipe(f));
                }
            }
            tracing::debug!(
                target: "luxor_core::discord",
                r"no \\.\pipe\discord-ipc-0..9 named pipe found"
            );
            None
        }
        #[cfg(not(any(unix, windows)))]
        {
            None
        }
    }

    /// Block until at least one byte is readable or `deadline` passes.
    ///
    /// On Unix this is a no-op — the 750ms socket read timeout set at connect
    /// time already bounds every `read`. On Windows `File::read` on a named
    /// pipe has **no** timeout and blocks forever if the peer never replies
    /// (e.g. a stale `discord-ipc-N` pipe left by a crashed client), which
    /// would wedge the engine and the mutex around it. Poll `PeekNamedPipe`
    /// with a short sleep instead.
    #[cfg_attr(not(windows), allow(unused_variables))]
    fn wait_readable(&self, deadline: Instant) -> std::io::Result<()> {
        #[cfg(windows)]
        {
            let IpcStream::Pipe(f) = self;
            loop {
                if win_pipe_bytes_available(f)? > 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "discord named pipe read timed out",
                    ));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
        #[cfg(not(windows))]
        {
            Ok(())
        }
    }
}

/// How many bytes can be read from a named pipe without blocking
/// (`PeekNamedPipe`). Declared inline so the transport stays `std`-only.
#[cfg(windows)]
fn win_pipe_bytes_available(f: &std::fs::File) -> std::io::Result<u32> {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(
            h_named_pipe: std::os::windows::raw::HANDLE,
            lp_buffer: *mut core::ffi::c_void,
            n_buffer_size: u32,
            lp_bytes_read: *mut u32,
            lp_total_bytes_avail: *mut u32,
            lp_bytes_left_this_message: *mut u32,
        ) -> i32;
    }
    let mut avail: u32 = 0;
    let ok = unsafe {
        PeekNamedPipe(
            f.as_raw_handle(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut avail,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(avail)
    }
}

impl Read for IpcStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            IpcStream::Unix(s) => s.read(buf),
            #[cfg(windows)]
            IpcStream::Pipe(f) => f.read(buf),
        }
    }
}

impl Write for IpcStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            IpcStream::Unix(s) => s.write(buf),
            #[cfg(windows)]
            IpcStream::Pipe(f) => f.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            IpcStream::Unix(s) => s.flush(),
            #[cfg(windows)]
            IpcStream::Pipe(f) => f.flush(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_sanitizes_text_and_buttons() {
        let p = Presence {
            details: Some("a".repeat(200)),
            buttons: vec![
                PresenceButton { label: "ok".into(), url: "https://x.io".into() },
                PresenceButton { label: "bad".into(), url: "http://x.io".into() },
                PresenceButton { label: "ok2".into(), url: "https://y.io".into() },
                PresenceButton { label: "ok3".into(), url: "https://z.io".into() },
            ],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(p.details.as_ref().unwrap().chars().count(), MAX_TEXT);
        // non-https dropped, then truncated to 2; labels are clamped too.
        assert_eq!(p.buttons.len(), 2);
        assert!(p.buttons.iter().all(|b| b.url.starts_with("https://")));
        let long = Presence {
            buttons: vec![PresenceButton { label: "x".repeat(80), url: "https://x.io".into() }],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(long.buttons[0].label.chars().count(), MAX_BUTTON_LABEL);
    }

    /// Discord rejects the whole SET_ACTIVITY when any present text field is
    /// under 2 characters — such fields must be dropped, not sent.
    #[test]
    fn presence_drops_under_length_text() {
        let p = Presence {
            details: Some("x".into()),
            state: Some("  ".into()),
            large_text: Some("ok".into()),
            small_text: Some(String::new()),
            buttons: vec![PresenceButton { label: "  ".into(), url: "https://x.io".into() }],
            ..Default::default()
        }
        .sanitized();
        assert_eq!(p.details, None);
        assert_eq!(p.state, None);
        assert_eq!(p.large_text.as_deref(), Some("ok"));
        assert_eq!(p.small_text, None);
        assert!(p.buttons.is_empty());
    }

    #[test]
    fn activity_json_shape() {
        let p = Presence {
            details: Some("🛠️ luxor · main".into()),
            state: Some("🤖 Claude · 2ч 10м".into()),
            start_timestamp: Some(1718900000),
            large_image: Some("lang_rust".into()),
            large_text: Some("Rust".into()),
            buttons: vec![PresenceButton { label: "Скачать".into(), url: "https://luxor.dev".into() }],
            ..Default::default()
        };
        let j = p.to_activity_json();
        assert_eq!(j["details"], "🛠️ luxor · main");
        assert_eq!(j["timestamps"]["start"], 1718900000);
        assert_eq!(j["assets"]["large_image"], "lang_rust");
        assert_eq!(j["buttons"][0]["url"], "https://luxor.dev");
    }

    #[test]
    fn carousel_rotates_after_interval() {
        let mut c = Carousel::new(Duration::from_secs(10));
        c.set_frames(vec![
            Presence { details: Some("A".into()), ..Default::default() },
            Presence { details: Some("B".into()), ..Default::default() },
        ]);
        let t0 = Instant::now();
        assert_eq!(c.current(t0).unwrap().details.as_deref(), Some("A"));
        // not yet elapsed
        assert_eq!(c.current(t0).unwrap().details.as_deref(), Some("A"));
        let t1 = t0 + Duration::from_secs(11);
        assert_eq!(c.current(t1).unwrap().details.as_deref(), Some("B"));
    }

    #[test]
    fn priority_queue_critical_wins() {
        let mut q = PriorityQueue::new();
        let now = Instant::now();
        q.push(
            QueuedPresence {
                presence: Presence { details: Some("bg".into()), ..Default::default() },
                priority: Priority::Background,
                hold: Duration::from_secs(15),
            },
            now,
        );
        q.push(
            QueuedPresence {
                presence: Presence { details: Some("crit".into()), ..Default::default() },
                priority: Priority::Critical,
                hold: Duration::from_secs(15),
            },
            now,
        );
        assert_eq!(q.active(now).unwrap().details.as_deref(), Some("crit"));
        // after hold expires the override clears
        assert!(q.active(now + Duration::from_secs(16)).is_none());
    }

    #[test]
    fn masking_and_blacklist() {
        assert_eq!(mask_project_name("secret-app", true), "🔒 Private Project");
        assert_eq!(mask_project_name("public", false), "public");
        assert_eq!(mask_file_label("src/auth_keys.rs", true), "Editing a *.rs file");
        assert_eq!(mask_file_label("a.rs", false), "Editing a.rs");
        assert!(blacklisted("feature/work-nda", &["*nda*".into()]));
        assert!(!blacklisted("feature/public", &["*nda*".into()]));
    }

    #[test]
    fn backoff_doubles_and_caps_at_sixty_seconds() {
        let mut ipc = DiscordIpc::new("123");
        assert_eq!(ipc.next_backoff(), Duration::from_secs(1));
        assert_eq!(ipc.next_backoff(), Duration::from_secs(2));
        assert_eq!(ipc.next_backoff(), Duration::from_secs(4));
        for _ in 0..10 {
            ipc.next_backoff();
        }
        assert_eq!(ipc.next_backoff(), Duration::from_secs(60));
        assert_eq!(ipc.next_backoff(), Duration::from_secs(60));
    }

    #[test]
    fn failed_connect_sets_last_error_and_arms_backoff() {
        // No Discord socket exists in the test environment, so connect() must
        // fail with a diagnosable reason instead of silently doing nothing
        // (the original "RPC doesn't work" symptom), and it must arm the
        // reconnect backoff so an immediate retry is refused.
        let mut ipc = DiscordIpc::new("not-a-real-client-id");
        let now = Instant::now();
        if ipc.connect(now).is_err() {
            let msg = ipc.last_error().expect("failed connect must set last_error");
            assert!(!msg.is_empty());
            assert!(!ipc.is_connected());
            // Retry within the backoff window is rejected without touching IO.
            assert!(ipc.connect(now).is_err());
        }
        assert!(!ipc.has_recent_activity(Instant::now()));
    }

    #[test]
    fn set_activity_backoff_after_failed_connect() {
        let mut ipc = DiscordIpc::new("not-a-real-client-id");
        let now = Instant::now();
        let p = Presence { details: Some("x".into()), ..Default::default() };
        // On machines without Discord this fails fast (no socket); with a live
        // Discord the bogus client_id is rejected via the CLOSE frame. Either
        // way it must return promptly instead of hanging (the Windows stale
        // pipe bug) and arm the backoff so an immediate retry is refused.
        if ipc.set_activity(&p, now, false).is_err() {
            assert!(ipc.last_error().is_some());
            assert!(ipc.set_activity(&p, now, true).is_err());
        }
    }

    #[test]
    fn clear_resets_error_and_activity_state() {
        let mut ipc = DiscordIpc::new("123");
        let _ = ipc.connect(Instant::now());
        ipc.clear().expect("clear on a disconnected ipc is fine");
        assert!(ipc.last_error().is_none());
        assert!(!ipc.is_connected());
        assert!(!ipc.has_recent_activity(Instant::now()));
    }

    #[test]
    fn build_frames_respects_privacy_toggles() {
        let ctx = PresenceContext {
            project_name: Some("luxor".into()),
            branch: Some("main".into()),
            agent: Some("Claude Code".into()),
            session_seconds: 7800,
            show_project: true,
            show_branch: true,
            show_agent: true,
            show_audit: false,
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        assert_eq!(frames.len(), 2); // project + ai, no audit
        assert!(frames[0].details.as_ref().unwrap().contains("luxor"));
        assert!(frames[1].state.as_ref().unwrap().contains("2h 10m"));
    }

    #[test]
    fn state_hash_changes_with_content() {
        let a = Presence { details: Some("x".into()), ..Default::default() };
        let b = Presence { details: Some("y".into()), ..Default::default() };
        assert_ne!(state_hash(&a), state_hash(&b));
        assert_eq!(state_hash(&a), state_hash(&a.clone()));
    }

    #[test]
    fn duration_formatting() {
        assert_eq!(fmt_duration(7800), "2h 10m");
        assert_eq!(fmt_duration(600), "10m");
    }

    #[test]
    fn idle_replaces_carousel_with_afk_frame() {
        let ctx = PresenceContext {
            project_name: Some("luxor".into()),
            branch: Some("main".into()),
            agent: Some("Claude Code".into()),
            idle: true,
            idle_since_unix: Some(1_718_900_000),
            show_project: true,
            show_branch: true,
            show_agent: true,
            show_audit: true,
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        // Idle wins over everything: exactly one idle frame, no stale coding
        // status left rotating while the user is away.
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].details.as_deref(), Some("Idle"));
        assert_eq!(frames[0].state.as_deref(), Some("Taking a break"));
        assert_eq!(frames[0].start_timestamp, Some(1_718_900_000));
        assert!(!frames[0].details.as_ref().unwrap().contains("luxor"));
    }

    #[test]
    fn custom_templates_render_placeholders() {
        let ctx = PresenceContext {
            project_name: Some("luxor".into()),
            branch: Some("main".into()),
            agent: Some("Claude Code".into()),
            session_seconds: 7800,
            lines_scanned: Some(1234),
            open_issues: Some(3),
            show_project: true,
            show_branch: true,
            show_agent: true,
            show_audit: true,
            templates: PresenceTemplates {
                project_details: "hacking {project}".into(),
                project_state: "branch = {branch}".into(),
                agent_details: "vibing with {agent} for {session}".into(),
                audit_state_issues: "found {issues} bugs".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        assert_eq!(frames[0].details.as_deref(), Some("hacking luxor"));
        assert_eq!(frames[0].state.as_deref(), Some("branch = main"));
        assert_eq!(
            frames[1].details.as_deref(),
            Some("vibing with Claude Code for 2h 10m")
        );
        assert_eq!(frames[2].state.as_deref(), Some("found 3 bugs"));
    }

    #[test]
    fn custom_idle_template_is_used() {
        let ctx = PresenceContext {
            idle: true,
            templates: PresenceTemplates {
                idle_details: "AFK, brb".into(),
                idle_state: "grabbing coffee".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        assert_eq!(frames[0].details.as_deref(), Some("AFK, brb"));
        assert_eq!(frames[0].state.as_deref(), Some("grabbing coffee"));
    }

    #[test]
    fn empty_templates_normalize_to_defaults() {
        let t = PresenceTemplates {
            idle_details: "   ".into(),
            project_details: String::new(),
            agent_state: "custom {session}".into(),
            ..Default::default()
        }
        .normalized();
        assert_eq!(t.idle_details, "Idle");
        assert_eq!(t.project_details, "Working on {project}");
        // Non-empty custom values survive normalization untouched.
        assert_eq!(t.agent_state, "custom {session}");
    }

    #[test]
    fn unknown_placeholders_pass_through() {
        assert_eq!(
            render_template("hi {name} on {branch}", &[("branch", "main")]),
            "hi {name} on main"
        );
    }

    #[test]
    fn empty_carousel_falls_back_to_generic_frame() {
        // All privacy toggles off previously produced ZERO frames — presence
        // silently disappeared ("RPC doesn't work"). Now a generic always-on
        // frame is guaranteed while the app is open.
        let ctx = PresenceContext {
            session_seconds: 600,
            show_project: false,
            show_branch: false,
            show_agent: false,
            show_audit: false,
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        assert_eq!(frames.len(), 1);
        assert!(frames[0].details.as_ref().unwrap().contains("Luxor"));
        assert!(frames[0].state.as_ref().unwrap().contains("10m"));
    }

    #[test]
    fn fallback_frame_never_leaks_project_or_branch() {
        let ctx = PresenceContext {
            project_name: Some("super-secret".into()),
            branch: Some("nda/feature".into()),
            show_project: false,
            show_branch: false,
            show_agent: false,
            show_audit: false,
            ..Default::default()
        };
        for f in build_carousel_frames(&ctx) {
            let text = format!(
                "{} {}",
                f.details.as_deref().unwrap_or(""),
                f.state.as_deref().unwrap_or("")
            );
            assert!(!text.contains("super-secret"));
            assert!(!text.contains("nda/feature"));
        }
    }

    #[test]
    fn idle_frame_keeps_buttons() {
        let ctx = PresenceContext {
            idle: true,
            buttons: vec![PresenceButton {
                label: "Скачать".into(),
                url: "https://luxor.dev".into(),
            }],
            ..Default::default()
        };
        let frames = build_carousel_frames(&ctx);
        assert_eq!(frames[0].buttons.len(), 1);
    }

    /// End-to-end transport test against a mock Discord IPC socket (plan 14.1):
    /// verifies the opcode-1 frame shape, the rate limiter (with jitter grace)
    /// and the anti-flicker hash — without a running Discord client.
    #[cfg(unix)]
    #[test]
    fn set_activity_sends_wellformed_frames_over_mock_ipc() {
        let (client, server) = std::os::unix::net::UnixStream::pair().unwrap();
        server
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let mut ipc = DiscordIpc::new("client");
        ipc.stream = Some(IpcStream::Unix(client)); // pre-handshaken connection
        let mut server = IpcStream::Unix(server);

        let t0 = Instant::now();
        let a = Presence { details: Some("frame-a".into()), ..Default::default() };
        assert!(ipc.set_activity(&a, t0, false).unwrap(), "first frame must send");
        let (op, v) = read_frame(&mut server).unwrap();
        assert_eq!(op, 1);
        assert_eq!(v["cmd"], "SET_ACTIVITY");
        assert_eq!(v["args"]["activity"]["details"], "frame-a");
        assert_eq!(v["args"]["pid"], std::process::id());
        assert!(ipc.has_recent_activity(t0));

        // Rate limit: a different frame 5 s later is skipped (no bytes sent).
        let b = Presence { details: Some("frame-b".into()), ..Default::default() };
        assert!(!ipc.set_activity(&b, t0 + Duration::from_secs(5), false).unwrap());

        // Jitter grace: a driver tick arriving at ~14.9 s must NOT be dropped —
        // this froze the carousel when the tick cadence equalled the limit.
        assert!(ipc
            .set_activity(&b, t0 + Duration::from_millis(14_900), false)
            .unwrap());
        let (_, v) = read_frame(&mut server).unwrap();
        assert_eq!(v["args"]["activity"]["details"], "frame-b");

        // Anti-flicker skips an identical frame while the live activity is
        // fresh, then periodically re-sends it as a liveness probe. This lets a
        // stale socket be discovered after Discord restarts.
        assert!(!ipc.set_activity(&b, t0 + Duration::from_secs(30), false).unwrap());
        assert!(ipc.set_activity(&b, t0 + Duration::from_secs(75), false).unwrap());
        let (_, v) = read_frame(&mut server).unwrap();
        assert_eq!(v["args"]["activity"]["details"], "frame-b");

        // `force` bypasses the rate limit for critical events while the
        // anti-flicker guard still suppresses a fresh identical payload.
        let c = Presence { details: Some("frame-c".into()), ..Default::default() };
        assert!(ipc.set_activity(&c, t0 + Duration::from_secs(61), true).unwrap());
        let (_, v) = read_frame(&mut server).unwrap();
        assert_eq!(v["args"]["activity"]["details"], "frame-c");
    }

    /// Clearing must send a `null` activity so Discord drops the presence
    /// instead of freezing the last status (plan part 15, graceful shutdown).
    #[cfg(unix)]
    #[test]
    fn clear_sends_null_activity_over_mock_ipc() {
        let (client, server) = std::os::unix::net::UnixStream::pair().unwrap();
        server
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let mut ipc = DiscordIpc::new("client");
        ipc.stream = Some(IpcStream::Unix(client));
        let mut server = IpcStream::Unix(server);

        ipc.clear().unwrap();
        let (op, v) = read_frame(&mut server).unwrap();
        assert_eq!(op, 1);
        assert!(v["args"]["activity"].is_null());
        assert!(!ipc.is_connected());
    }

    #[test]
    fn reconnect_backoff_throttles_missing_discord() {
        // Stub the transport as permanently absent. Using the real connector
        // made this test assert "Discord is not installed on the build machine"
        // — it failed outright on any dev box with Discord running.
        let mut ipc = DiscordIpc::with_connector("client", || None);
        let now = Instant::now();
        let _ = ipc.connect(now);
        let next = ipc.next_connect_at;
        assert!(next.is_some());
        let before = next.unwrap() - Duration::from_millis(1);
        let err = ipc.connect(before).unwrap_err();
        assert_eq!(err.kind(), "process");
        assert_eq!(ipc.next_connect_at, next);
    }

}
