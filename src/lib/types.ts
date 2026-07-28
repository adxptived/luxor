/** TypeScript mirrors of `luxor-core` models (serde camel/snake_case as emitted). */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type TabBarPosition = "top" | "side";
export type Theme =
  | "dark"
  | "light"
  | "system"
  | "tokyo_night"
  | "catppuccin_mocha"
  | "catppuccin_latte"
  | "dracula"
  | "nord"
  | "gruvbox_dark"
  | "one_dark"
  | "solarized_light"
  | "rose_pine"
  | "everforest_dark"
  | "ayu_mirage"
  | "github_light";
export type QuickActionsPlacement = "top" | "side" | "hidden";
export type LeftSidebarIconPosition = "top" | "middle" | "bottom";
export type CursorStyle = "block" | "underline" | "bar";
export type DiffView = "side_by_side" | "inline";

export interface Hotkey {
  action: string;
  chord: string;
}

export interface TerminalConfig {
  shell: string | null;
  /** External terminal emulator command (null = platform default). */
  external_terminal: string | null;
  shell_args: string[];
  /** Add -NoLogo -NoProfile for PowerShell when shell args are empty. */
  fast_powershell_startup: boolean;
  font_family: string;
  font_size: number;
  scrollback: number;
  webgl: boolean;
  cursor_style: CursorStyle;
  cursor_blink: boolean;
  copy_on_select: boolean;
  /** Toast when a terminal rings the bell. */
  bell_notifications: boolean;
  /** Per-terminal CPU/RAM badge. */
  show_stats: boolean;
}

export interface GitConfig {
  diff_view: DiffView;
  auto_refresh_secs: number;
}

export interface UiConfig {
  topbar_size: number;
  sidebar_width: number;
  /** Collapse the left project/sidebar rail to icon-only mode. */
  left_sidebar_collapsed: boolean;
  /** Whether the main left sidebar (vertical project/nav rail in side-tab mode)
   *  is open. Closing animates it away; reopen from the top-bar toggle. */
  left_sidebar_open: boolean;
  /** Ordered ids of the quick-action buttons in the window top bar
   *  (e.g. "left", "right", "terminal", "new", "files", "settings").
   *  Empty = a curated, duplicate-free default. */
  chrome_actions: string[];
  /** Vertical placement for collapsed left sidebar/nav rail icons. */
  left_sidebar_icon_position: LeftSidebarIconPosition;
  /** Tab corner radius in px (0 = square, default = subtle rounding). */
  tab_radius: number;
  /** Height of each project tab row in the SIDE tab bar (px, 0 = compact
   *  content-driven default). Only applies in side-tab mode. */
  tab_height: number;
  /** Fixed height of the project-tab region in the SIDE tab bar (px, 0 =
   *  automatic — the strip fills leftover sidebar height). Set by dragging the
   *  divider between the tab strip and the nav-button stack. Side-tab mode only. */
  tab_strip_height: number;
  /** Draw a visible outline/border around the active tab (off = selection shown
   *  by background colour only). */
  tab_outline: boolean;
  quick_actions: QuickActionsPlacement;
  /** Custom nav button order (empty = default). */
  nav_order: string[];
  /** Nav button ids hidden by the user. */
  nav_hidden: string[];
  /** Visible nav button ids forced into the left sidebar/action rail instead of the top bar. */
  nav_sidebar: string[];
  /** Visible nav button ids placed in the top-bar right corner, beside the window controls. */
  nav_chrome: string[];
  /** Top-bar nav button ids aligned to the LEFT of the bar (before the tab strip).
   *  Buttons that live in the top bar but are listed in neither this nor
   *  `nav_topbar_center` default to the right-aligned group. */
  nav_topbar_left: string[];
  /** Top-bar nav button ids aligned to the CENTER of the bar. */
  nav_topbar_center: string[];
  /** Built-in web browser button/panel (off by default to save resources). */
  browser_enabled: boolean;
  /** UI zoom factor, 1.0 = 100% (clamped to 0.5–2.0). */
  zoom: number;
  /** Keep running in the tray when the window is closed. */
  close_to_tray: boolean;
  /** Code editor color theme for editors and diffs. */
  editor_theme: string;
  /** Show the customizable left side panel. */
  side_panel_enabled: boolean;
  /** Ordered, visible widget ids of the side panel (empty = defaults). */
  side_panel_widgets: string[];
  /** Width of the side panel in pixels. */
  side_panel_width: number;
  /** Show the customizable right side panel. */
  right_panel_enabled: boolean;
  /** Ordered, visible widget ids of the right panel (empty = defaults). */
  right_panel_widgets: string[];
  /** Width of the right panel in pixels. */
  right_panel_width: number;
  /** Panel kind embedded in the right panel's "embed" widget (empty = none). */
  right_panel_embed: string;
  /** Rich right-sidebar customization (order, per-widget enabled/accent/options,
   *  panel accent, density) as a JSON blob — see `src/lib/rightPanelConfig.ts`.
   *  Empty = migrate from `right_panel_widgets`. */
  right_panel_config: string;
  /** Custom UI font family (empty = theme default). */
  ui_font: string;
  /** Custom monospace font family for code/markdown (empty = default). */
  mono_font: string;
  /** UI text scale in percent (100 = default). Clamped 80–130. */
  ui_font_scale: number;
  /** Show the code minimap in editor panels. */
  editor_minimap: boolean;
  /** Autosave editor panels shortly after the last change. */
  editor_autosave: boolean;
  /** UI language: "en" or "ru". */
  language: string;
  /** GitHub owner/repo used for update checks (empty = disabled). */
  update_repo: string;
  /** Check for updates once on startup. */
  update_check: boolean;
  plus_menu_hidden: string[];
  /** Allow opening a second Luxor window (off = single window). */
  allow_second_window: boolean;
  /** Launch Luxor automatically when the user logs in. */
  launch_on_startup: boolean;
  /** Which entries the custom tray popup shows. */
  tray: TrayConfig;
  /** Semi-transparent "glass" UI surfaces (menus, popups, bars) with blur. */
  glass_enabled: boolean;
  /** Glass strength in percent (0 = opaque, 100 = most transparent). 0–60. */
  glass_opacity: number;
  /** Show the Diagnostics tab in Dev Tools (Discord RPC & subsystem health
   *  checks). Off by default — enable it in Settings → Developer. Optional so
   *  configs saved by older builds still parse. */
  diagnostics_tab?: boolean;
}

/** Visibility of the custom tray-popup entries. The header (open Luxor) and
 *  Quit are always shown; everything else is opt-in. */
export interface TrayConfig {
  show_projects: boolean;
  show_new_terminal: boolean;
  show_new_window: boolean;
  show_settings: boolean;
  show_close_to_tray: boolean;
}

/** Completion notifications (terminal commands, AI agents). */
export interface NotificationsConfig {
  enabled: boolean;
  /** OS-native notifications when the window is hidden/unfocused. */
  os_native: boolean;
  /** Notify when a long terminal command finishes. */
  command_done: boolean;
  /** Minimum command duration (seconds) that triggers a notification. */
  min_command_secs: number;
  /** Notify when an AI agent finishes responding. */
  agent_done: boolean;
}

export interface StatusBarConfig {
  show_project: boolean;
  show_git: boolean;
  show_cpu: boolean;
  show_ram: boolean;
  show_net: boolean;
  show_ping: boolean;
  show_clock: boolean;
  show_zoom: boolean;
  show_tasks: boolean;
  /** Focus timer (only shown while a session is running). */
  show_timer: boolean;
  /** Running AI CLI agents (Claude Code, Codex, …). */
  show_agents: boolean;
  ping_host: string;
  refresh_secs: number;
  /** Custom segment order ("spacer" splits left/right groups; empty = default). */
  segment_order: string[];
}

export interface IdeEntry {
  label: string;
  command: string;
}

export interface AppConfig {
  theme: Theme;
  tab_bar_position: TabBarPosition;
  accent_color: string;
  confirm_destructive: boolean;
  terminal: TerminalConfig;
  git: GitConfig;
  notifications: NotificationsConfig;
  hotkeys: Hotkey[];
  preferred_editors: string[];
  ui: UiConfig;
  status_bar: StatusBarConfig;
  custom_ides: IdeEntry[];
  default_ide: string | null;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  layout_preset_id: string | null;
  favorite_commands: string[];
  linked_executables: string[];
  preferred_ide: string | null;
  tab_order: number;
  created_at: string;
  last_opened_at: string | null;
  /** Custom tab icon (lucide name or emoji), if set. */
  icon: string | null;
  /** Custom tab accent color (hex), if set. */
  color: string | null;
  /** Pinned tabs sort first and cannot be closed by accident. */
  pinned: boolean;
  path_exists: boolean;
}

// ---------------------------------------------------------------------------
// Layout presets
// ---------------------------------------------------------------------------

export interface PanelTerminal {
  panel_id: string;
  cwd: string | null;
  autorun: string[];
}

/** Kanban columns in board order (Tasks board). */
export const TASK_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A kanban task — `title` + `description` form an agent-ready prompt. */
export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** One skill found in a project (agent-skill manager). */
export interface SkillEntry {
  convention: string;
  name: string;
  path: string;
  skill_md: string;
  is_dir: boolean;
  size: number;
  /** Disabled skills carry a `.disabled` suffix on disk; agents skip them. */
  enabled: boolean;
  /** FNV-1a 64 content hash of the main markdown (duplicate detection). */
  content_hash: string;
}

/** One catalog entry on skills.sh (skills market). */
export interface MarketSkill {
  source: string;
  skill_id: string;
  name: string;
  installs: number;
  is_official: boolean;
  url: string;
}

export interface LayoutPreset {
  version: number;
  id: string;
  name: string;
  dock_layout: unknown;
  terminals: PanelTerminal[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  shell?: string | null;
  args?: string[];
  cwd?: string | null;
  cols?: number;
  rows?: number;
  autorun?: string[];
  fast_powershell_startup?: boolean;
}

export interface SessionInfo {
  session_id: string;
  shell: string;
  cwd: string | null;
  /** OS pid of the shell process (per-terminal resource stats). */
  pid: number | null;
}

/** One detected AI CLI agent kind, aggregated over its processes. */
export interface AgentInfo {
  id: string;
  label: string;
  count: number;
  cpu_percent: number;
  mem_bytes: number;
}

/** Resource usage of a terminal's process tree. */
export interface TreeStats {
  root_pid: number;
  processes: number;
  cpu_percent: number;
  mem_bytes: number;
  /** Labels of known AI agents running inside the tree (e.g. "Claude Code"). */
  agents: string[];
}

/** One detected agent process (Agents panel detail rows). */
export interface AgentProcess {
  id: string;
  label: string;
  pid: number;
  cpu_percent: number;
  mem_bytes: number;
  run_secs: number;
  /** Working directory the agent runs in ("where") — "" when unknown. */
  cwd: string;
  /** Parent process id (the shell/terminal that launched it), if known. */
  parent_pid: number | null;
  /** Heuristic: agent is actively working (CPU above the busy threshold). */
  busy: boolean;
  cmd: string;
}

/** One git blame annotation block (start_line is 1-based). */
export interface BlameHunk {
  start_line: number;
  lines: number;
  commit_id: string;
  short_id: string;
  author: string;
  time: number;
  summary: string;
}

/** Blame hunks plus the blamed (HEAD) file content. */
export interface FileBlame {
  hunks: BlameHunk[];
  lines: string[];
  truncated: boolean;
}

export interface PtyOutputPayload {
  session_id: string;
  data_b64: string;
}

export interface PtyExitPayload {
  session_id: string;
  exit_code: number | null;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type FileState =
  | "new"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "conflicted"
  | "untracked"
  | "ignored";

export interface StatusEntry {
  path: string;
  staged: FileState | null;
  unstaged: FileState | null;
}

export interface RepoStatus {
  branch: string | null;
  head_detached: boolean;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
}

export interface CommitInfo {
  id: string;
  short_id: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  summary: string;
  message: string;
}

export interface BranchInfo {
  name: string;
  is_head: boolean;
  is_remote: boolean;
  upstream: string | null;
}

export interface FileDiff {
  path: string;
  old_content: string;
  new_content: string;
  binary: boolean;
}

export type DiffTarget = "worktree" | "index" | "commit";

export interface StashEntry {
  index: number;
  message: string;
}

export interface ChangedFile {
  path: string;
  state: FileState;
  /** Lines added (commit diffs only; 0 elsewhere). */
  insertions: number;
  /** Lines removed (commit diffs only; 0 elsewhere). */
  deletions: number;
}

/** Aggregate stats of one commit (vs its first parent). */
export interface CommitStats {
  files_changed: number;
  insertions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

export type ExternalTerminal =
  | "windows_terminal"
  | "cmd"
  | "powershell"
  | "linux_default"
  | "mac_terminal";

/** A recently closed project (candidate for the "Recent projects" menu). */
export interface RecentProject {
  path: string;
  name: string;
  last_removed_at: string;
  path_exists: boolean;
}

/** A terminal emulator / shell found on the system. */
export interface DetectedProgram {
  command: string;
  label: string;
}

export interface DetectedIde {
  command: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Filesystem / viewers
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string | null;
}

export interface TextFile {
  content: string;
  truncated: boolean;
  /** Modification time (ms since epoch) at read time; send back via
   *  `fsWriteText(..., expectedMtimeMs)` for conflict detection. */
  mtime_ms?: number | null;
}

export interface DbTable {
  name: string;
  rows: number;
}

export interface DbRows {
  columns: string[];
  rows: string[][];
  total: number;
  /** `rowid` per row (parallel to `rows`); empty when the result is not editable. */
  rowids?: number[];
  /** True when individual rows can be updated/deleted in place. */
  editable?: boolean;
}

export interface DbColumn {
  name: string;
  decl_type: string;
  notnull: boolean;
  pk: boolean;
  dflt: string | null;
}

export interface DbTableInfo {
  name: string;
  columns: DbColumn[];
  row_count: number;
  has_rowid: boolean;
  create_sql: string;
  indexes: string[];
}

// ---------------------------------------------------------------------------
// System stats
// ---------------------------------------------------------------------------

export interface SystemStats {
  cpu_percent: number;
  mem_used: number;
  mem_total: number;
  net_rx_bps: number | null;
  net_tx_bps: number | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface BackendError {
  kind: string;
  message: string;
}

export function isBackendError(e: unknown): e is BackendError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as BackendError).message === "string"
  );
}

export function errorMessage(e: unknown): string {
  if (isBackendError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---------------------------------------------------------------------------
// v0.5.0
// ---------------------------------------------------------------------------

export interface TagInfo {
  name: string;
  target_id: string;
  short_target: string;
  message: string | null;
  annotated: boolean;
}

export interface ReflogEntry {
  id: string;
  short_id: string;
  message: string;
  time: number;
}

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  head_id: string | null;
}

export interface ConflictSides {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  current: string;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface SearchReport {
  hits: SearchHit[];
  files_scanned: number;
  truncated: boolean;
}

export interface ReplaceReport {
  files_changed: number;
  replacements: number;
}

export interface EnvVar {
  key: string;
  value: string;
  line: number;
}

export interface EnvFile {
  path: string;
  vars: EnvVar[];
  missing_keys: string[];
}

export interface LogFileInfo {
  path: string;
  size: number;
  modified: number;
}

export interface DirUsage {
  path: string;
  bytes: number;
  cleanable: boolean;
}

export interface DiskUsageReport {
  total_bytes: number;
  dirs: DirUsage[];
}

export interface DepEntry {
  name: string;
  req: string;
  dev: boolean;
}

export interface DepManifest {
  kind: "npm" | "cargo" | "pip";
  path: string;
  deps: DepEntry[];
}

export interface Snippet {
  id: string;
  title: string;
  body: string;
  lang: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  project_id: string | null;
  file: string;
  line: number;
  note: string;
  created_at: string;
}

export interface SessionSnapshot {
  id: string;
  project_id: string | null;
  name: string;
  data: string;
  created_at: string;
}

export interface HttpRequestSpec {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  timeout_ms?: number;
  /** SSRF guard: reject requests to loopback/private/link-local hosts. */
  block_private?: boolean;
}

export interface HttpResponseInfo {
  status: number;
  status_text: string;
  headers: [string, string][];
  body: string;
  truncated: boolean;
  elapsed_ms: number;
}

export interface RegistryPackage {
  name: string;
  version: string;
  description: string;
  url: string;
  downloads: number;
}

export interface VulnAdvisory {
  package: string;
  id: string;
  summary: string;
  severity: string;
  url: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface ProcessNode {
  pid: number;
  parent: number | null;
  name: string;
  cmd: string;
  cpu_percent: number;
  memory_bytes: number;
  depth: number;
}

export interface CrashReport {
  name: string;
  modified: number;
  size: number;
}

// ---- GitHub (Issues / PRs / CI) -------------------------------------------

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  user: string;
  labels: string[];
  comments: number;
  created_at: string;
  updated_at: string;
  body: string;
  html_url: string;
}

export interface GhComment {
  user: string;
  created_at: string;
  body: string;
}

export interface GhPull {
  number: number;
  title: string;
  state: string;
  user: string;
  draft: boolean;
  head: string;
  base: string;
  created_at: string;
  updated_at: string;
  body: string;
  html_url: string;
}

export interface GhRun {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  branch: string;
  event: string;
  run_number: number;
  created_at: string;
  html_url: string;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  update_available: boolean;
  name: string;
  notes: string;
  published_at: string;
  html_url: string;
  assets: [string, string][];
}
