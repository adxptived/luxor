//! Global application settings, stored as TOML in the OS config directory.
//!
//! Location: `{config_dir}/luxor/config.toml`
//! (e.g. `%APPDATA%\luxor` on Windows, `~/.config/luxor` on Linux,
//! `~/Library/Application Support/luxor` on macOS).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Deserialize an enum-typed field leniently: an unknown/removed value (e.g. a
/// theme from a newer Luxor, or one dropped on downgrade) falls back to the
/// field's default instead of failing the *entire* config parse. Without this,
/// one bad enum value would make `load` error and `load_or_recover` reset ALL
/// settings to defaults. Config is always TOML, so an intermediate
/// `toml::Value` is a safe representation.
fn de_enum_lenient<'de, D, T>(deserializer: D) -> std::result::Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    use serde::de::IntoDeserializer;
    let value = toml::Value::deserialize(deserializer)?;
    Ok(T::deserialize(value.into_deserializer()).unwrap_or_default())
}

/// Where the project tab bar lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TabBarPosition {
    #[default]
    Top,
    Side,
}

/// UI theme selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    Dark,
    Light,
    System,
    TokyoNight,
    CatppuccinMocha,
    CatppuccinLatte,
    Dracula,
    Nord,
    GruvboxDark,
    OneDark,
    SolarizedLight,
    RosePine,
    EverforestDark,
    AyuMirage,
    GithubLight,
}

/// Terminal cursor style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CursorStyle {
    #[default]
    Block,
    Underline,
    Bar,
}

/// How file diffs are rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DiffView {
    #[default]
    SideBySide,
    Inline,
}

/// Where the quick-actions bar (launcher buttons) is rendered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum QuickActionsPlacement {
    #[default]
    Top,
    Side,
    Hidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LeftSidebarIconPosition {
    #[default]
    Top,
    Middle,
    Bottom,
}

/// Which entries the custom tray popup shows. The header (open Luxor) and the
/// Quit action are always present; everything else is opt-in so users can keep
/// the popup as minimal as the native menu in the screenshot, or as rich as a
/// quick-launch panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TrayConfig {
    /// Show the recent-projects list.
    pub show_projects: bool,
    /// Show the "New terminal" action.
    pub show_new_terminal: bool,
    /// Show the "New window" action (also gated by `allow_second_window`).
    pub show_new_window: bool,
    /// Show the "Settings" action.
    pub show_settings: bool,
    /// Show the "Keep running in the background" toggle.
    pub show_close_to_tray: bool,
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self {
            show_projects: true,
            show_new_terminal: true,
            show_new_window: false,
            show_settings: true,
            show_close_to_tray: true,
        }
    }
}

/// Sizing & chrome options for the main UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    /// Height of the top bar in pixels (also width of the vertical tab rail).
    pub topbar_size: u16,
    /// Width of the side tab bar in pixels (when `tab_bar_position = side`).
    pub sidebar_width: u16,
    /// Collapse the left project/sidebar rail to icon-only mode.
    pub left_sidebar_collapsed: bool,
    /// Whether the main left sidebar (vertical project/nav rail in side-tab
    /// mode) is open. Closing animates it away; reopen from the top-bar
    /// sidebar toggle. Defaults to open.
    pub left_sidebar_open: bool,
    /// Ordered ids of the small quick-action buttons shown in the window
    /// top bar (e.g. "left", "right", "terminal", "new", "files",
    /// "settings"). Empty = a curated, duplicate-free default.
    pub chrome_actions: Vec<String>,
    /// Vertical placement for collapsed left sidebar / action-rail icons.
    #[serde(deserialize_with = "de_enum_lenient")]
    pub left_sidebar_icon_position: LeftSidebarIconPosition,
    /// Tab corner radius in px (0 = square, default = subtle rounding).
    pub tab_radius: u16,
    /// Where the launcher quick-action buttons live.
    #[serde(deserialize_with = "de_enum_lenient")]
    pub quick_actions: QuickActionsPlacement,
    /// Custom order of the nav buttons (Terminal/Git/Files/…). Unknown ids are
    /// ignored; ids missing from the list keep their default position.
    #[serde(default)]
    pub nav_order: Vec<String>,
    /// Nav button ids hidden by the user.
    #[serde(default = "default_nav_hidden")]
    pub nav_hidden: Vec<String>,
    /// Visible nav button ids forced into the left sidebar/action rail instead of the top bar.
    #[serde(default)]
    pub nav_sidebar: Vec<String>,
    /// Visible nav button ids placed in the top-bar right corner, beside the window controls.
    #[serde(default)]
    pub nav_chrome: Vec<String>,
    /// UI zoom factor (1.0 = 100%). Clamped to 0.5–2.0 by the frontend.
    pub zoom: f64,
    /// Show the built-in web browser nav button / panel. Off by default so the
    /// extra webview never consumes resources unless the user opts in.
    pub browser_enabled: bool,
    /// Keep Luxor running in the tray when the window is closed (agents and
    /// terminals keep working; reopen from the tray icon).
    pub close_to_tray: bool,
    /// Monaco color theme for editors and diffs (e.g. "luxor-dark").
    pub editor_theme: String,
    /// Show the customizable left sidebar.
    pub side_panel_enabled: bool,
    /// Ordered, visible widget ids of the left sidebar (empty = defaults).
    pub side_panel_widgets: Vec<String>,
    /// Width of the left sidebar in pixels.
    pub side_panel_width: u16,
    /// Show the customizable right sidebar.
    pub right_panel_enabled: bool,
    /// Ordered, visible widget ids of the right sidebar (empty = defaults).
    pub right_panel_widgets: Vec<String>,
    /// Width of the right sidebar in pixels.
    pub right_panel_width: u16,
    /// Panel kind embedded in the right sidebar's "embed" widget (empty = none).
    pub right_panel_embed: String,
    /// Rich right-sidebar customization (order, per-widget enabled/accent/
    /// options, panel accent, density) stored as a JSON blob. The schema is
    /// owned by the frontend (`src/lib/rightPanelConfig.ts`); the backend only
    /// persists it. Empty = migrate from `right_panel_widgets`.
    pub right_panel_config: String,
    /// Custom UI font family (CSS font-family list; empty = theme default).
    pub ui_font: String,
    /// Custom monospace font family for code/markdown (empty = default).
    pub mono_font: String,
    /// UI text scale in percent (root font-size; 100 = default). Clamped 80–130.
    pub ui_font_scale: u16,
    /// Show the Monaco minimap in editor panels.
    pub editor_minimap: bool,
    /// Autosave editor panels shortly after the last change.
    pub editor_autosave: bool,
    /// UI language: "en" or "ru".
    pub language: String,
    /// GitHub `owner/repo` used for update checks (empty = checks disabled).
    pub update_repo: String,
    /// Check for updates once on startup (only when `update_repo` is set).
    pub update_check: bool,
    /// Panel ids hidden from the tab-strip "+" menu (empty = show everything).
    pub plus_menu_hidden: Vec<String>,
    /// Allow opening a second Luxor window (File/tray → New window). Off by
    /// default: one window only.
    pub allow_second_window: bool,
    /// Launch Luxor automatically when the user logs in. Off by default.
    pub launch_on_startup: bool,
    /// Which entries the custom tray popup shows.
    pub tray: TrayConfig,
    /// Semi-transparent "glass" UI surfaces (menus, popups, bars) with blur.
    pub glass_enabled: bool,
    /// Glass strength in percent (0 = opaque, 100 = most transparent). 0–60.
    pub glass_opacity: u16,
    /// Show the Diagnostics tab in Dev Tools (subsystem health checks:
    /// Discord RPC, IPC, tooling). Off by default — it is a developer aid,
    /// not something every user needs in their tab strip.
    #[serde(default)]
    pub diagnostics_tab: bool,
}

/// Nav buttons hidden on a fresh install. The visible set is Terminal, Git,
/// Files and Settings; this lists every other button. Keep in sync with
/// `DEFAULT_VISIBLE_NAV` / `DEFAULT_NAV_HIDDEN` in `src/lib/navButtons.ts`.
pub fn default_nav_hidden() -> Vec<String> {
    [
        "launcher", "tasks", "skills", "presets", "ai", "agents", "activity", "search", "snippets",
        "http", "docker", "devtools", "github", "web", "palette",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            topbar_size: 36,
            sidebar_width: 208,
            left_sidebar_collapsed: false,
            left_sidebar_open: true,
            chrome_actions: Vec::new(),
            left_sidebar_icon_position: LeftSidebarIconPosition::default(),
            tab_radius: 7,
            quick_actions: QuickActionsPlacement::default(),
            nav_order: Vec::new(),
            // Fresh installs show only the essentials in the sidebar (Terminal,
            // Git, Files, Settings); everything else is one right-click away.
            // Keep in sync with `DEFAULT_VISIBLE_NAV` in the frontend.
            nav_hidden: default_nav_hidden(),
            nav_sidebar: Vec::new(),
            nav_chrome: vec![
                "ide".into(),
                "filemanager".into(),
                "git".into(),
                "palette".into(),
            ],
            zoom: 1.0,
            browser_enabled: false,
            close_to_tray: true,
            editor_theme: "luxor-dark".into(),
            side_panel_enabled: false,
            side_panel_widgets: Vec::new(),
            side_panel_width: 260,
            right_panel_enabled: false,
            right_panel_widgets: Vec::new(),
            right_panel_width: 280,
            right_panel_embed: String::new(),
            right_panel_config: String::new(),
            ui_font: String::new(),
            mono_font: String::new(),
            ui_font_scale: 100,
            editor_minimap: false,
            editor_autosave: false,
            language: "en".into(),
            update_repo: String::new(),
            update_check: true,
            plus_menu_hidden: Vec::new(),
            allow_second_window: false,
            launch_on_startup: false,
            tray: TrayConfig::default(),
            // Default ON with 20% strength — this matches the app's original
            // look, where every `--lx-glass-bg` surface was an 80% mix of the
            // bar colour. Turning the toggle off makes those surfaces opaque.
            glass_enabled: true,
            glass_opacity: 20,
            diagnostics_tab: false,
        }
    }
}

/// Status-bar widgets (system stats are sampled only when enabled).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct StatusBarConfig {
    pub show_project: bool,
    pub show_git: bool,
    pub show_cpu: bool,
    pub show_ram: bool,
    pub show_net: bool,
    pub show_ping: bool,
    /// Local time (HH:MM).
    pub show_clock: bool,
    /// Current UI zoom (click resets to 100%).
    pub show_zoom: bool,
    /// Open tasks counter (click opens the Tasks board).
    pub show_tasks: bool,
    /// Focus (Pomodoro) timer — only rendered while a session is running, even
    /// when enabled; click to pause/resume. Lets the countdown stay visible
    /// when the sidebar is collapsed.
    pub show_timer: bool,
    /// Running AI CLI agents (Claude Code, Codex, …) with CPU/RAM usage.
    pub show_agents: bool,
    /// `host:port` probed with a TCP connect to measure latency.
    pub ping_host: String,
    /// Stats refresh interval in seconds (min 1).
    pub refresh_secs: u32,
    /// Custom left-to-right order of the status-bar segments ("spacer"
    /// separates the left- and right-aligned groups). Empty = default order.
    pub segment_order: Vec<String>,
}

impl Default for StatusBarConfig {
    fn default() -> Self {
        Self {
            show_project: true,
            show_git: true,
            show_cpu: true,
            show_ram: true,
            show_net: false,
            show_ping: false,
            show_clock: false,
            show_zoom: false,
            show_tasks: false,
            show_timer: true,
            show_agents: true,
            ping_host: "1.1.1.1:443".into(),
            refresh_secs: 2,
            segment_order: Vec::new(),
        }
    }
}

/// A user-configured IDE/editor entry (in addition to auto-detected ones).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct IdeEntry {
    /// Display name shown on the button.
    pub label: String,
    /// Program name on PATH or an absolute path to the executable.
    pub command: String,
}

/// Git module settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GitConfig {
    /// Diff rendering mode in the diff viewer.
    #[serde(deserialize_with = "de_enum_lenient")]
    pub diff_view: DiffView,
    /// Auto-refresh interval for the git panel, in seconds. 0 disables.
    pub auto_refresh_secs: u32,
}

impl Default for GitConfig {
    fn default() -> Self {
        Self {
            diff_view: DiffView::default(),
            auto_refresh_secs: 5,
        }
    }
}

/// A single configurable hotkey: action id -> key chord (e.g. `"Ctrl+Shift+P"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotkey {
    pub action: String,
    pub chord: String,
}

/// Terminal defaults applied to new sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalConfig {
    /// Shell program. `None` = platform default (PowerShell / $SHELL).
    pub shell: Option<String>,
    /// External terminal emulator command for the launcher quick action
    /// (e.g. `wt.exe`, `alacritty`, `ghostty`). `None` = platform default.
    pub external_terminal: Option<String>,
    /// Extra arguments for the shell.
    pub shell_args: Vec<String>,
    /// Add `-NoLogo -NoProfile` for PowerShell when shell args are empty.
    pub fast_powershell_startup: bool,
    pub font_family: String,
    pub font_size: u16,
    /// Maximum scrollback lines kept by the UI.
    pub scrollback: u32,
    /// Whether to use the WebGL renderer for xterm.js.
    pub webgl: bool,
    #[serde(deserialize_with = "de_enum_lenient")]
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    /// Copy selected text to the clipboard automatically.
    pub copy_on_select: bool,
    /// Toast notification when a terminal rings the bell (BEL, e.g. an agent
    /// finished and is waiting for input).
    pub bell_notifications: bool,
    /// Show the per-terminal CPU/RAM badge (process tree of the shell).
    pub show_stats: bool,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            shell: None,
            external_terminal: None,
            shell_args: Vec::new(),
            fast_powershell_startup: true,
            font_family: "Cascadia Mono, JetBrains Mono, Consolas, monospace".into(),
            font_size: 14,
            scrollback: 10_000,
            webgl: true,
            cursor_style: CursorStyle::default(),
            cursor_blink: true,
            copy_on_select: false,
            bell_notifications: true,
            show_stats: true,
        }
    }
}

/// Notifications for finished terminal commands and AI agents.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NotificationsConfig {
    /// Master switch for completion notifications.
    pub enabled: bool,
    /// Also show OS-native (system tray) notifications when the window is
    /// hidden or unfocused — not just in-app toasts.
    pub os_native: bool,
    /// Notify when a long terminal command finishes (builds, tests, …).
    pub command_done: bool,
    /// Minimum command duration (seconds) that triggers a notification.
    pub min_command_secs: u32,
    /// Notify when an AI agent (Claude Code, Codex, …) finishes responding
    /// and is waiting for input.
    pub agent_done: bool,
}

impl Default for NotificationsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            os_native: true,
            command_done: true,
            min_command_secs: 10,
            agent_done: true,
        }
    }
}

/// Root settings object persisted to `config.toml`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    #[serde(deserialize_with = "de_enum_lenient")]
    pub theme: Theme,
    #[serde(deserialize_with = "de_enum_lenient")]
    pub tab_bar_position: TabBarPosition,
    /// Accent color as a hex string (e.g. "#e8b059").
    pub accent_color: String,
    /// Ask for confirmation before destructive actions (discard, branch delete, ...).
    pub confirm_destructive: bool,
    pub terminal: TerminalConfig,
    pub git: GitConfig,
    /// Completion notifications (terminal commands, AI agents).
    pub notifications: NotificationsConfig,
    /// Custom hotkey overrides; defaults are defined in the frontend.
    pub hotkeys: Vec<Hotkey>,
    /// Preferred external editors/IDE commands in priority order (e.g. `["code", "zed"]`).
    pub preferred_editors: Vec<String>,
    /// UI sizing and quick-actions placement.
    pub ui: UiConfig,
    /// Status-bar widget toggles.
    pub status_bar: StatusBarConfig,
    /// User-configured IDEs (merged with auto-detected ones).
    pub custom_ides: Vec<IdeEntry>,
    /// Command of the default IDE for the one-click launch button.
    pub default_ide: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            tab_bar_position: TabBarPosition::default(),
            accent_color: "#e8b059".into(),
            confirm_destructive: true,
            terminal: TerminalConfig::default(),
            git: GitConfig::default(),
            notifications: NotificationsConfig::default(),
            hotkeys: Vec::new(),
            preferred_editors: Vec::new(),
            ui: UiConfig::default(),
            status_bar: StatusBarConfig::default(),
            custom_ides: Vec::new(),
            default_ide: None,
        }
    }
}

/// Directory that holds `config.toml`, the SQLite registry and layout presets.
pub fn config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir()
        .ok_or_else(|| Error::Config("cannot resolve OS config directory".into()))?;
    Ok(base.join("luxor"))
}

pub fn config_file_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("config.toml"))
}

/// Load settings, falling back to defaults when the file is missing.
pub fn load(path: &Path) -> Result<AppConfig> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(path)?;
    toml::from_str(&raw)
        .map_err(|e| Error::Config(format!("failed to parse {}: {e}", path.display())))
}

/// Like [`load`], but never fails on a corrupt file: the broken config is
/// backed up next to the original (`config.toml.corrupt`) and defaults are
/// returned together with the backup path so the UI can tell the user.
pub fn load_or_recover(path: &Path) -> (AppConfig, Option<PathBuf>) {
    match load(path) {
        Ok(cfg) => (cfg, None),
        Err(_) => {
            let backup = path.with_extension("toml.corrupt");
            // Best effort: if the rename fails we still recover with defaults.
            let backed_up = std::fs::rename(path, &backup).is_ok();
            (
                AppConfig::default(),
                if backed_up { Some(backup) } else { None },
            )
        }
    }
}

/// Persist settings atomically (write to temp file, then rename).
/// Serialize a config to TOML (used by save and the diagnostics export).
pub fn to_toml(config: &AppConfig) -> Result<String> {
    toml::to_string_pretty(config).map_err(|e| Error::Config(format!("serialize config: {e}")))
}

pub fn save(path: &Path, config: &AppConfig) -> Result<()> {
    let raw = toml::to_string_pretty(config)
        .map_err(|e| Error::Config(format!("failed to serialize config: {e}")))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, raw)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_load_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let cfg = load(&path).unwrap();
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn roundtrip_save_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let mut cfg = AppConfig {
            theme: Theme::Light,
            tab_bar_position: TabBarPosition::Side,
            preferred_editors: vec!["code".into(), "zed".into()],
            ..Default::default()
        };
        cfg.terminal.font_size = 16;
        cfg.hotkeys.push(Hotkey {
            action: "command_palette".into(),
            chord: "Ctrl+K".into(),
        });
        save(&path, &cfg).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, cfg);
    }

    #[test]
    fn unknown_enum_value_falls_back_to_default_not_reset() {
        // A theme value from a newer build (or a removed one) must not blow up
        // the whole parse — the field falls back to its default and every other
        // setting is preserved.
        let toml_str = "theme = \"some_future_theme\"\naccent_color = \"#abcdef\"\n\
                        tab_bar_position = \"bogus\"\n[terminal]\ncursor_style = \"squiggle\"\n\
                        font_size = 17\n[git]\ndiff_view = \"holographic\"\n";
        let cfg: AppConfig = toml::from_str(toml_str).expect("lenient enum parse must succeed");
        assert_eq!(cfg.theme, Theme::default());
        assert_eq!(cfg.tab_bar_position, TabBarPosition::default());
        assert_eq!(cfg.terminal.cursor_style, CursorStyle::default());
        assert_eq!(cfg.git.diff_view, DiffView::default());
        // Non-enum fields around them are untouched.
        assert_eq!(cfg.accent_color, "#abcdef");
        assert_eq!(cfg.terminal.font_size, 17);
    }

    #[test]
    fn unknown_fields_are_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "theme = \"dark\"\nfuture_option = 42\n").unwrap();
        let cfg = load(&path).unwrap();
        assert_eq!(cfg.theme, Theme::Dark);
    }

    #[test]
    fn recover_backs_up_corrupt_config_and_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "theme = [not toml").unwrap();
        let (cfg, backup) = load_or_recover(&path);
        assert_eq!(cfg, AppConfig::default());
        let backup = backup.expect("backup path");
        assert!(backup.exists());
        assert!(!path.exists());
        // A subsequent load starts clean.
        let (cfg2, backup2) = load_or_recover(&path);
        assert_eq!(cfg2, AppConfig::default());
        assert!(backup2.is_none());
    }

    #[test]
    fn defaults_have_sane_new_fields() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.accent_color, "#e8b059");
        assert!(cfg.confirm_destructive);
        assert!(cfg.terminal.cursor_blink);
        assert_eq!(cfg.git.auto_refresh_secs, 5);
        // v0.4.0 additions.
        assert_eq!(cfg.ui.zoom, 1.0);
        // v0.4.1 additions.
        assert!(cfg.terminal.external_terminal.is_none());
        assert!(cfg.ui.nav_order.is_empty());
        // Fresh installs hide all but the four essential nav buttons.
        assert_eq!(cfg.ui.nav_hidden, default_nav_hidden());
        assert!(cfg.ui.nav_sidebar.is_empty());
        assert_eq!(
            cfg.ui.left_sidebar_icon_position,
            LeftSidebarIconPosition::Top
        );
        assert!(cfg.ui.nav_hidden.contains(&"agents".to_string()));
        assert!(!cfg.ui.nav_hidden.contains(&"terminal".to_string()));
        assert!(!cfg.ui.nav_hidden.contains(&"settings".to_string()));
        assert!(cfg.status_bar.show_project);
        assert!(cfg.status_bar.segment_order.is_empty());
        // v0.6.6 additions.
        assert!(cfg.notifications.enabled);
        assert!(cfg.notifications.os_native);
        assert!(cfg.notifications.command_done);
        assert_eq!(cfg.notifications.min_command_secs, 10);
        assert!(cfg.notifications.agent_done);
        assert!(!cfg.ui.allow_second_window);
        assert!(!cfg.ui.launch_on_startup);
        // v0.6.7 additions.
        assert!(!cfg.ui.editor_autosave);
        assert!(cfg.terminal.shell_args.is_empty());
        assert!(cfg.terminal.fast_powershell_startup);
    }

    #[test]
    fn notifications_roundtrip_and_old_configs_get_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let mut cfg = AppConfig::default();
        cfg.notifications.min_command_secs = 30;
        cfg.notifications.agent_done = false;
        cfg.ui.allow_second_window = true;
        cfg.ui.launch_on_startup = true;
        cfg.ui.editor_autosave = true;
        save(&path, &cfg).unwrap();
        assert_eq!(load(&path).unwrap(), cfg);
        // A v0.6.5 config has no [notifications] section at all.
        std::fs::write(&path, "theme = \"dark\"\n").unwrap();
        let old = load(&path).unwrap();
        assert_eq!(old.notifications, NotificationsConfig::default());
        assert!(!old.ui.allow_second_window);
        assert!(!old.ui.launch_on_startup);
    }

    #[test]
    fn v03_config_without_new_fields_loads_with_defaults() {
        // A config written by v0.3 has no nav/zoom/segment fields; serde
        // defaults must fill them in without erroring.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "theme = \"dark\"\n[ui]\ntopbar_size = 40\n[status_bar]\nshow_git = false\n",
        )
        .unwrap();
        let cfg = load(&path).unwrap();
        assert_eq!(cfg.ui.topbar_size, 40);
        assert_eq!(cfg.ui.zoom, 1.0);
        assert!(!cfg.status_bar.show_git);
    }

    #[test]
    fn old_terminal_config_gets_shell_argument_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "theme = \"dark\"
[terminal]
shell = \"pwsh\"
",
        )
        .unwrap();
        let cfg = load(&path).unwrap();
        assert_eq!(cfg.terminal.shell.as_deref(), Some("pwsh"));
        assert!(cfg.terminal.shell_args.is_empty());
        assert!(cfg.terminal.fast_powershell_startup);
    }

    #[test]
    fn new_themes_roundtrip_through_toml() {
        for (variant, name) in [
            (Theme::RosePine, "rose_pine"),
            (Theme::EverforestDark, "everforest_dark"),
            (Theme::AyuMirage, "ayu_mirage"),
            (Theme::GithubLight, "github_light"),
        ] {
            let toml_str = format!("theme = \"{name}\"\n");
            let cfg: AppConfig = toml::from_str(&toml_str).unwrap();
            assert_eq!(cfg.theme, variant);
        }
    }

    #[test]
    fn roundtrip_with_nav_and_segment_customization() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let mut cfg = AppConfig::default();
        cfg.ui.nav_order = vec!["git".into(), "terminal".into()];
        cfg.ui.nav_hidden = vec!["presets".into()];
        cfg.ui.zoom = 1.25;
        cfg.status_bar.segment_order = vec!["git".into(), "project".into(), "spacer".into()];
        cfg.status_bar.show_project = false;
        save(&path, &cfg).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, cfg);
    }

    #[test]
    fn corrupt_config_is_a_config_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "theme = [not toml").unwrap();
        let err = load(&path).unwrap_err();
        assert_eq!(err.kind(), "config");
    }
}
