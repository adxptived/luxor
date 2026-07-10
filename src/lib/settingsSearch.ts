/**
 * Full-content search index for the Settings modal.
 *
 * The old search only matched section names + a keyword blob; users expect it
 * to find *individual settings* ("scrollback", "close to tray", …). Every row
 * rendered by `SettingsModal` is listed here so the search can surface the
 * matching items and jump to the right section.
 */

export type SettingsSectionId =
  | "appearance"
  | "interface"
  | "notifications"
  | "terminal"
  | "git"
  | "launcher"
  | "statusbar"
  | "hotkeys"
  | "developer"
  | "about";

/** Every individual setting: section + visible title + extra keywords. */
export interface SettingsItem {
  section: SettingsSectionId;
  title: string;
  keywords?: string;
}

export const SETTINGS_ITEMS: SettingsItem[] = [
  // Appearance
  { section: "appearance", title: "Theme", keywords: "dark light system tokyo catppuccin dracula nord gruvbox one dark solarized rose pine everforest ayu github color scheme" },
  { section: "appearance", title: "Code editor theme", keywords: "monaco syntax monokai highlighting colors" },
  { section: "appearance", title: "Accent color", keywords: "highlight hex custom color" },
  { section: "appearance", title: "Editor minimap", keywords: "monaco overview map code preview scrollbar" },
  { section: "appearance", title: "Editor autosave", keywords: "save automatically auto write file monaco автосохранение" },
  { section: "appearance", title: "Confirm before closing tabs", keywords: "dialog warn project close" },
  { section: "appearance", title: "Export settings", keywords: "config json share backup save file" },
  { section: "appearance", title: "Import settings", keywords: "config json restore load file apply" },
  // Interface
  { section: "interface", title: "Tab bar position", keywords: "top side vertical projects" },
  { section: "interface", title: "Tab bar size", keywords: "height width topbar compact" },
  { section: "interface", title: "Quick actions", keywords: "launcher buttons placement top side hidden" },
  { section: "interface", title: "Navigation buttons", keywords: "sidebar nav order hide git files tasks skills web reorder" },
  { section: "interface", title: "Side panel", keywords: "widgets clock stats notes width" },
  { section: "interface", title: "Built-in web browser", keywords: "web youtube iframe embedded app window internet" },
  { section: "interface", title: "Close to tray", keywords: "background minimize quit exit" },
  { section: "interface", title: "Launch on startup", keywords: "autostart auto start login boot windows автозагрузка запуск вход" },
  { section: "interface", title: "Zoom", keywords: "scale ui size ctrl wheel" },
  { section: "interface", title: "Allow second window", keywords: "multi monitor new window open another" },
  // Notifications
  { section: "notifications", title: "Enable notifications", keywords: "master switch toast alerts" },
  { section: "notifications", title: "OS notifications", keywords: "native windows system tray hidden unfocused background" },
  { section: "notifications", title: "Command finished", keywords: "terminal done duration exit code long build" },
  { section: "notifications", title: "Minimum command duration", keywords: "seconds threshold quiet short" },
  { section: "notifications", title: "AI agent finished", keywords: "claude codex gemini qoder devin response done waiting input" },
  // Terminal
  { section: "terminal", title: "Shell", keywords: "bash zsh fish powershell pwsh cmd program" },
  { section: "terminal", title: "Shell arguments", keywords: "args argv command line flags explicit parameters powershell nologo noprofile profile loading" },
  { section: "terminal", title: "Load my PowerShell profile", keywords: "powershell pwsh profile oh-my-posh oh my posh aliases functions prompt load fast startup nologo noprofile skip profile loading performance windows defaults" },
  { section: "terminal", title: "Launches", keywords: "command preview effective launch pwsh startup flags" },
  { section: "terminal", title: "Font size", keywords: "text terminal px" },
  { section: "terminal", title: "Font family", keywords: "monospace nerd font ligatures" },
  { section: "terminal", title: "Scrollback", keywords: "history lines buffer" },
  { section: "terminal", title: "Cursor style", keywords: "block underline bar blink" },
  { section: "terminal", title: "WebGL renderer", keywords: "gpu acceleration performance canvas" },
  { section: "terminal", title: "Copy on select", keywords: "clipboard selection auto" },
  { section: "terminal", title: "Bell notifications", keywords: "bel alert agent done finished toast notify sound" },
  { section: "terminal", title: "CPU / RAM badge", keywords: "resources memory usage process tree stats per terminal" },
  { section: "terminal", title: "External terminal", keywords: "emulator ghostty alacritty kitty wezterm konsole" },
  // Git
  { section: "git", title: "Diff view", keywords: "side by side inline split unified" },
  { section: "git", title: "Refresh interval", keywords: "poll seconds status cadence" },
  // Launcher & IDEs
  { section: "launcher", title: "Preferred editors", keywords: "ide vs code cursor zed default order" },
  { section: "launcher", title: "Custom IDEs", keywords: "editor command add trae antigravity sublime notepad path" },
  { section: "launcher", title: "Detected IDEs", keywords: "auto found path editors installed" },
  { section: "launcher", title: "File manager", keywords: "explorer finder nautilus open folder system" },
  // Status bar
  { section: "statusbar", title: "Status bar segments", keywords: "cpu ram network ping clock zoom tasks project git agents order toggle spacer" },
  { section: "statusbar", title: "Ping host", keywords: "latency tcp host port" },
  { section: "statusbar", title: "Refresh interval", keywords: "stats seconds sample" },
  // Hotkeys
  { section: "hotkeys", title: "Keyboard shortcuts", keywords: "keybindings rebind chord palette terminal git files settings record" },
  // About
  { section: "about", title: "About Luxor", keywords: "version author adxptived github repository update check release changelog license credits о программе версия автор обновления" },
  { section: "about", title: "Check for updates", keywords: "update github release latest version newer download автообновление обновления" },
  // Developer
  { section: "developer", title: "Frontend log", keywords: "logs log panel frontend.log console errors freeze share copy save troubleshoot bug report логи журнал" },
  { section: "developer", title: "Startup timing", keywords: "performance startup first paint app ready slow speed boot производительность запуск" },
  { section: "developer", title: "Export diagnostics", keywords: "diagnostics report bug share config crash log диагностика отчёт" },
  { section: "developer", title: "Clear logs", keywords: "clear reset wipe log журнал очистить" },
  { section: "developer", title: "Open log folder", keywords: "config directory folder reveal frontend.log папка" },
];

export interface SettingsSearchResult {
  /** Sections that have at least one hit, in declaration order. */
  sections: SettingsSectionId[];
  /** Matched item titles per section (for hint rendering), max `limit` each. */
  matches: Partial<Record<SettingsSectionId, string[]>>;
}

/** Case-insensitive search over titles + keywords. Empty query = everything. */
export function searchSettings(query: string, limit = 3): SettingsSearchResult {
  const q = query.toLowerCase().trim();
  const sections: SettingsSectionId[] = [];
  const matches: Partial<Record<SettingsSectionId, string[]>> = {};
  if (!q) return { sections, matches };
  for (const item of SETTINGS_ITEMS) {
    const hay = `${item.title} ${item.keywords ?? ""}`.toLowerCase();
    const hit = q.split(/\s+/).every((w) => hay.includes(w));
    if (!hit) continue;
    if (!sections.includes(item.section)) sections.push(item.section);
    const list = (matches[item.section] ??= []);
    if (list.length < limit) list.push(item.title);
  }
  return { sections, matches };
}
