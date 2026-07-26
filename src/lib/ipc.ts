/**
 * Typed IPC layer between the React UI and the Rust backend.
 *
 * In the browser (plain `vite dev` without Tauri) every call resolves against
 * a tiny in-memory mock so the UI stays explorable for development.
 */

import type {
  AppConfig,
  BranchInfo,
  ChangedFile,
  CommitInfo,
  DbRows,
  DbTable,
  DbTableInfo,
  DetectedIde,
  DiffTarget,
  ExternalTerminal,
  FileDiff,
  LayoutPreset,
  MarketSkill,
  Project,
  RecentProject,
  DetectedProgram,
  SkillEntry,
  Task,
  PtyExitPayload,
  PtyOutputPayload,
  FsEntry,
  RepoStatus,
  SessionInfo,
  SpawnOptions,
  StashEntry,
  SystemStats,
  CommitStats,
  TextFile,
  AgentInfo,
  AgentProcess,
  TreeStats,
  FileBlame,
  TagInfo,
  ReflogEntry,
  SubmoduleInfo,
  ConflictSides,
  SearchReport,
  ReplaceReport,
  EnvFile,
  LogFileInfo,
  DiskUsageReport,
  DepManifest,
  Snippet,
  Bookmark,
  SessionSnapshot,
  HttpRequestSpec,
  HttpResponseInfo,
  RegistryPackage,
  VulnAdvisory,
  DockerContainer,
  DockerImage,
  ProcessNode,
  CrashReport,
} from "./types";
import { clearLogs, logsAsText, pushLog, pushStructured, type LogLevel, type LogCategory } from "./logBuffer";

export const EVENT_PTY_OUTPUT = "luxor://pty-output";
export const EVENT_PTY_EXIT = "luxor://pty-exit";

export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    // Dynamic: keeps the 650-line browser mock out of the desktop bundle, where
    // this branch is unreachable.
    const { mockInvoke } = await import("./ipcMock");
    return mockInvoke<T>(cmd, args);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    pushStructured("ERROR", "ipc", `invoke failed: ${cmd}`, {
      cmd,
      error: String(e),
      args: args ? Object.keys(args) : [],
    });
    throw e;
  }
}

/**
 * Fire-and-forget an IPC promise WITHOUT losing failures (audit 4.2).
 *
 * Use instead of bare `void ipc.something()` wherever the user should learn
 * that a background action failed. The error is always logged; when
 * `errorToast` is given, a toast is shown via the app store.
 *
 *   fireIpc(ipc.fsDelete(path), "Delete failed");
 */
export function fireIpc(promise: Promise<unknown>, errorToast?: string): void {
  promise.catch((e) => {
    pushStructured("ERROR", "ipc", "background ipc call failed", { error: String(e) });
    if (errorToast) {
      // Late import to avoid a module cycle (appStore imports ipc).
      void import("@/state/appStore").then(({ useAppStore }) => {
        useAppStore.getState().toast(`${errorToast}: ${String(e)}`, "error");
      });
    }
  });
}

export type Unlisten = () => void;

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

// ---------------------------------------------------------------------------
// base64 <-> bytes (terminal data is raw bytes, not guaranteed UTF-8)
// ---------------------------------------------------------------------------

// Prefer the native base64 decoder when the runtime provides it (Chromium 133+,
// which the Tauri webview tracks). It decodes in one native call instead of a
// per-byte `charCodeAt` JS loop — a real win on the PTY output hot path, where
// coalesced batches can be tens of KB each. Falls back to `atob` otherwise.
const fromBase64 = (
  Uint8Array as unknown as {
    fromBase64?: (s: string) => Uint8Array;
  }
).fromBase64;

export function b64ToBytes(b64: string): Uint8Array {
  if (fromBase64) return fromBase64(b64);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Reused across calls — the encoder is stateless, so allocating one per
// keystroke (this is on the terminal-input hot path) is pure waste.
const TEXT_ENCODER = new TextEncoder();

export function strToB64(str: string): string {
  const bytes = TEXT_ENCODER.encode(str);
  // Building the binary string char-by-char (`bin += fromCharCode(b)`) forces
  // a fresh string allocation per byte — O(n²)-ish for large pastes. Convert in
  // big chunks with `fromCharCode.apply` instead (the chunk cap keeps us under
  // the engine's argument-count limit).
  const CHUNK = 0x8000;
  if (bytes.length <= CHUNK) {
    return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]));
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const configGet = () => invoke<AppConfig>("config_get");

/** UI fields the Rust side stores as integers (u16). A fractional value coming
 *  from a high-DPI drag-resize (e.g. clientX = 248.81817…) would otherwise fail
 *  deserialization with "invalid type: floating point …, expected u16". We round
 *  them defensively at the single choke-point so no caller can trip this. zoom
 *  stays a float on purpose and is intentionally not listed here. */
// ui_font_scale is intentionally NOT listed here — it is a float (e.g. 1.25)
// and must NOT be rounded to an integer. Only true u16 fields belong here.
const CONFIG_INT_UI_FIELDS = [
  "topbar_size",
  "sidebar_width",
  "tab_radius",
  "side_panel_width",
  "right_panel_width",
  "glass_opacity",
] as const;

function sanitizeConfig(config: AppConfig): AppConfig {
  const ui = { ...config.ui } as Record<string, unknown>;
  for (const f of CONFIG_INT_UI_FIELDS) {
    const v = ui[f];
    if (typeof v === "number" && !Number.isInteger(v)) ui[f] = Math.round(v);
  }
  return { ...config, ui: ui as unknown as AppConfig["ui"] };
}

export const configSet = (config: AppConfig) =>
  invoke<void>("config_set", { config: sanitizeConfig(config) });

// ---------------------------------------------------------------------------
// Layout presets
// ---------------------------------------------------------------------------

export const layoutList = () => invoke<LayoutPreset[]>("layout_list");
export const layoutGet = (id: string) => invoke<LayoutPreset>("layout_get", { id });
export const layoutSave = (preset: LayoutPreset) => invoke<LayoutPreset>("layout_save", { preset });
export const layoutDelete = (id: string) => invoke<void>("layout_delete", { id });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projectAdd = (path: string, name?: string) =>
  invoke<Project>("project_add", { path, name: name ?? null });
export const projectAddBlank = (name?: string) =>
  invoke<Project>("project_add_blank", { name: name ?? null });
export const projectList = () => invoke<Project[]>("project_list");
export const projectGet = (id: string) => invoke<Project>("project_get", { id });
export const projectUpdate = (project: Project) => invoke<void>("project_update", { project });
export const projectRemove = (id: string) => invoke<void>("project_remove", { id });
export const projectReorder = (ids: string[]) => invoke<void>("project_reorder", { ids });
export const projectTouch = (id: string) => invoke<void>("project_touch", { id });
export const recentList = (limit?: number) =>
  invoke<RecentProject[]>("recent_list", { limit: limit ?? null });
export const recentDelete = (path: string) => invoke<void>("recent_delete", { path });

// ---------------------------------------------------------------------------
// Kanban tasks (Tasks board)
// ---------------------------------------------------------------------------

export const taskList = (projectId: string | null) =>
  invoke<Task[]>("task_list", { projectId });
export const taskAdd = (
  projectId: string | null,
  title: string,
  description = "",
  status?: string,
) => invoke<Task>("task_add", { projectId, title, description, status });
export const taskUpdate = (task: Task) => invoke<void>("task_update", { task });
export const taskMove = (id: string, status: string, position: number) =>
  invoke<void>("task_move", { id, status, position });
export const taskDelete = (id: string) => invoke<void>("task_delete", { id });

// ---------------------------------------------------------------------------
// Agent skills (manager + skills.sh market)
// ---------------------------------------------------------------------------

export const skillsScan = (root: string) => invoke<SkillEntry[]>("skills_scan", { root });
export const skillsCopy = (root: string, skillPath: string, toConvention: string) =>
  invoke<SkillEntry>("skills_copy", { root, skillPath, toConvention });
export const skillsImport = (root: string, convention: string, name: string, content: string) =>
  invoke<SkillEntry>("skills_import", { root, convention, name, content });
export const skillsGlobalRoot = () => invoke<string>("skills_global_root");
export const skillsSetEnabled = (skillPath: string, enabled: boolean) =>
  invoke<string>("skills_set_enabled", { skillPath, enabled });
export const skillsRemove = (skillPath: string) =>
  invoke<void>("skills_remove", { skillPath });
export const marketCatalog = (force = false) =>
  invoke<MarketSkill[]>("market_catalog", { force });
export const marketSearch = (query: string) =>
  invoke<MarketSkill[]>("market_search", { query });
export const marketSkillMd = (source: string, skillId: string) =>
  invoke<string>("market_skill_md", { source, skillId });

/** Open the native folder picker; returns the chosen directory or null. */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri) {
    return window.prompt("Project directory path:") || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

/** Open the native file picker; returns the chosen file path or null. */
export async function pickFile(): Promise<string | null> {
  if (!isTauri) {
    return window.prompt("File path:") || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: false, multiple: false });
  return typeof result === "string" ? result : null;
}

/**
 * Save `content` as a text file. Native save dialog under Tauri; a blob
 * download in the browser. Returns the chosen path (Tauri) or the suggested
 * name (browser), or null when the user cancelled.
 */
export async function saveTextFile(suggestedName: string, content: string): Promise<string | null> {
  if (!isTauri) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return suggestedName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: suggestedName });
  if (!path) return null;
  await fsWriteText(path, content);
  return path;
}

/** Open a URL in the system browser. */
export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) throw new Error(`refusing to open non-http url: ${url}`);
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Open a file with the OS default application (double-click equivalent). */
export async function openPath(path: string): Promise<void> {
  if (!isTauri) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

/** Open `url` in a dedicated native browser window (full web compatibility). */
export async function browserOpenWindow(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke<void>("browser_open_window", { url });
}

// --- Embedded browser (real native child webview) --------------------------
// These drive a top-level webview overlaid on the BrowserPanel viewport, so
// pages load like a normal browser tab (no X-Frame-Options / iframe blocking).

/** Navigation / load-state update emitted by the embedded webview. */
export interface BrowserNav {
  url: string;
  loading: boolean;
}

/** Show + position the embedded browser, navigating to `url` when given. */
export const browserEmbedShow = (
  x: number,
  y: number,
  width: number,
  height: number,
  url?: string,
) => invoke<void>("browser_embed_show", { x, y, width, height, url: url ?? null });

/** Cheap reposition/resize used by the bounds-tracking loop. */
export const browserEmbedSetBounds = (x: number, y: number, width: number, height: number) =>
  invoke<void>("browser_embed_set_bounds", { x, y, width, height });

export const browserEmbedNavigate = (url: string) =>
  invoke<void>("browser_embed_navigate", { url });
export const browserEmbedBack = () => invoke<void>("browser_embed_back");
export const browserEmbedForward = () => invoke<void>("browser_embed_forward");
export const browserEmbedReload = () => invoke<void>("browser_embed_reload");
export const browserEmbedHide = () => invoke<void>("browser_embed_hide");
export const browserEmbedClose = () => invoke<void>("browser_embed_close");

/** Subscribe to embedded-browser navigation events. */
export const onBrowserNav = (handler: (nav: BrowserNav) => void): Promise<Unlisten> =>
  listen<BrowserNav>("browser://nav", handler);

/** Webview-loadable URL for a local file (asset protocol), e.g. for PDFs. */
export async function fileSrc(path: string): Promise<string | null> {
  if (!isTauri) return null;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export const ptySpawn = (opts: SpawnOptions) => invoke<SessionInfo>("pty_spawn", { opts });
export const ptyWrite = (sessionId: string, dataB64: string) =>
  invoke<void>("pty_write", { sessionId, dataB64 });
export const ptyResize = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { sessionId, cols, rows });
export const ptyKill = (sessionId: string) => invoke<void>("pty_kill", { sessionId });
export const ptyList = () => invoke<SessionInfo[]>("pty_list");

export const onPtyOutput = (handler: (p: PtyOutputPayload) => void) =>
  listen<PtyOutputPayload>(EVENT_PTY_OUTPUT, handler);
export const onPtyExit = (handler: (p: PtyExitPayload) => void) =>
  listen<PtyExitPayload>(EVENT_PTY_EXIT, handler);

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export const gitDiscoverRoot = (path: string) =>
  invoke<string | null>("git_discover_root", { path });
export const gitStatus = (repoPath: string) => invoke<RepoStatus>("git_status", { repoPath });
export const gitBlame = (repoPath: string, filePath: string) =>
  invoke<FileBlame>("git_blame", { repoPath, filePath });
export const gitLog = (repoPath: string, limit?: number, fromId?: string) =>
  invoke<CommitInfo[]>("git_log", { repoPath, limit: limit ?? null, fromId: fromId ?? null });
export const gitFileHistory = (repoPath: string, filePath: string, limit?: number) =>
  invoke<CommitInfo[]>("git_file_history", { repoPath, filePath, limit: limit ?? null });
export const gitCommitFiles = (repoPath: string, commitId: string) =>
  invoke<ChangedFile[]>("git_commit_files", { repoPath, commitId });
export const gitCommitStats = (repoPath: string, commitId: string) =>
  invoke<CommitStats>("git_commit_stats", { repoPath, commitId });
export const gitFileDiff = (
  repoPath: string,
  filePath: string,
  target: DiffTarget,
  commitId?: string,
) => invoke<FileDiff>("git_file_diff", { repoPath, filePath, target, commitId: commitId ?? null });
export const gitBranches = (repoPath: string) => invoke<BranchInfo[]>("git_branches", { repoPath });
export const gitStage = (repoPath: string, paths: string[]) =>
  invoke<void>("git_stage", { repoPath, paths });
export const gitUnstage = (repoPath: string, paths: string[]) =>
  invoke<void>("git_unstage", { repoPath, paths });
export const gitDiscard = (repoPath: string, paths: string[]) =>
  invoke<void>("git_discard", { repoPath, paths });
export const gitCommit = (repoPath: string, message: string, amend = false) =>
  invoke<string>("git_commit", { repoPath, message, amend });
export const gitLastCommitMessage = (repoPath: string) =>
  invoke<string | null>("git_last_commit_message", { repoPath });
export const gitBranchCreate = (repoPath: string, name: string, checkout: boolean) =>
  invoke<void>("git_branch_create", { repoPath, name, checkout });
export const gitBranchCheckout = (repoPath: string, name: string) =>
  invoke<void>("git_branch_checkout", { repoPath, name });
export const gitBranchDelete = (repoPath: string, name: string) =>
  invoke<void>("git_branch_delete", { repoPath, name });
export const gitStashSave = (repoPath: string, message?: string) =>
  invoke<void>("git_stash_save", { repoPath, message: message ?? null });
export const gitStashList = (repoPath: string) => invoke<StashEntry[]>("git_stash_list", { repoPath });
export const gitStashApply = (repoPath: string, index: number) =>
  invoke<void>("git_stash_apply", { repoPath, index });
export const gitStashPop = (repoPath: string, index: number) =>
  invoke<void>("git_stash_pop", { repoPath, index });
export const gitStashDrop = (repoPath: string, index: number) =>
  invoke<void>("git_stash_drop", { repoPath, index });
export const gitFetch = (repoPath: string, remote?: string) =>
  invoke<void>("git_fetch", { repoPath, remote: remote ?? null });
export const gitPull = (repoPath: string, remote?: string) =>
  invoke<string>("git_pull", { repoPath, remote: remote ?? null });
export const gitPush = (repoPath: string, remote?: string) =>
  invoke<void>("git_push", { repoPath, remote: remote ?? null });
export const gitTokenSet = (host: string, token: string) =>
  invoke<void>("git_token_set", { host, token });
export const gitTokenDelete = (host: string) => invoke<void>("git_token_delete", { host });
export const gitTokenExists = (host: string) => invoke<boolean>("git_token_exists", { host });

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

export const ptyDetectShells = () => invoke<DetectedProgram[]>("pty_detect_shells");
export const launcherDetectTerminals = () =>
  invoke<DetectedProgram[]>("launcher_detect_terminals");
export const launcherOpenTerminal = (dir: string, terminal?: ExternalTerminal) =>
  invoke<void>("launcher_open_terminal", { dir, terminal: terminal ?? null });
export const launcherOpenFileManager = (dir: string) =>
  invoke<void>("launcher_open_file_manager", { dir });
export const launcherOpenIde = (dir: string, ide?: string) =>
  invoke<void>("launcher_open_ide", { dir, ide: ide ?? null });
export const launcherDetectIdes = () => invoke<DetectedIde[]>("launcher_detect_ides");
export const launcherOpenDefaultApp = (path: string) =>
  invoke<void>("launcher_open_default_app", { path });
export const launcherFindExecutables = (dir: string, limit?: number) =>
  invoke<string[]>("launcher_find_executables", { dir, limit: limit ?? null });
export const launcherRunExecutable = (projectDir: string, exePath: string) =>
  invoke<void>("launcher_run_executable", { projectDir, exePath });

// ---------------------------------------------------------------------------
// Filesystem / viewers
// ---------------------------------------------------------------------------

export const fsListDir = (path: string) => invoke<FsEntry[]>("fs_list_dir", { path });
export const fsSearch = (root: string, query: string, limit = 120) =>
  invoke<FsEntry[]>("fs_search", { root, query, limit });
export const fsReadText = (path: string, maxBytes?: number) =>
  invoke<TextFile>("fs_read_text", { path, maxBytes: maxBytes ?? null });
/** Write a text file. Pass `expectedMtimeMs` (from `TextFile.mtimeMs`) to get
 *  optimistic-concurrency conflict detection: the backend rejects the write
 *  with `kind: "conflict"` if the file changed on disk since it was read.
 *  Returns the file's new mtime (ms) for subsequent saves. */
export const fsWriteText = (path: string, content: string, expectedMtimeMs?: number | null) =>
  invoke<number | null>("fs_write_text", {
    path,
    content,
    expectedMtimeMs: expectedMtimeMs ?? null,
  });
export const fsReadBase64 = (path: string, maxBytes?: number) =>
  invoke<string>("fs_read_base64", { path, maxBytes: maxBytes ?? null });
export const fsCreateFile = (path: string) => invoke<void>("fs_create_file", { path });
export const fsCreateDir = (path: string) => invoke<void>("fs_create_dir", { path });
export const fsRename = (from: string, to: string) => invoke<void>("fs_rename", { from, to });
export const fsCopy = (from: string, to: string) => invoke<void>("fs_copy", { from, to });
export const fsDelete = (path: string, recursive = false) =>
  invoke<void>("fs_delete", { path, recursive });
export const dbTables = (path: string) => invoke<DbTable[]>("db_tables", { path });

export interface DbRowsOpts {
  limit?: number;
  offset?: number;
  orderBy?: string | null;
  desc?: boolean;
  filter?: string | null;
}
export const dbRows = (path: string, table: string, opts: DbRowsOpts = {}) =>
  invoke<DbRows>("db_rows", {
    path,
    table,
    limit: opts.limit ?? null,
    offset: opts.offset ?? null,
    orderBy: opts.orderBy ?? null,
    desc: opts.desc ?? false,
    filter: opts.filter ?? null,
  });
export const dbTableInfo = (path: string, table: string) =>
  invoke<DbTableInfo>("db_table_info", { path, table });
export const dbUpdateCell = (
  path: string,
  table: string,
  rowid: number,
  column: string,
  value: string | null,
) => invoke<void>("db_update_cell", { path, table, rowid, column, value });
export const dbInsertRow = (
  path: string,
  table: string,
  columns: string[],
  values: (string | null)[],
) => invoke<number>("db_insert_row", { path, table, columns, values });
export const dbDeleteRows = (path: string, table: string, rowids: number[]) =>
  invoke<number>("db_delete_rows", { path, table, rowids });

// ---------------------------------------------------------------------------
// System stats / window
// ---------------------------------------------------------------------------

// Several always-mounted consumers (StatusBar, RightPanel system widget) poll
// stats on independent timers. A short TTL cache collapses overlapping polls
// into one IPC round-trip and one sysinfo sample on the Rust side.
let statsCache: { at: number; promise: Promise<SystemStats> } | null = null;
export const statsSample = () => {
  const now = Date.now();
  if (statsCache && now - statsCache.at < 1_000) return statsCache.promise;
  const promise = invoke<SystemStats>("stats_sample");
  statsCache = { at: now, promise };
  // Don't serve a rejected promise from the cache.
  promise.catch(() => {
    if (statsCache?.promise === promise) statsCache = null;
  });
  return promise;
};
export const agentsSample = () => invoke<AgentInfo[]>("agents_sample");
export const agentsProcesses = () => invoke<AgentProcess[]>("agents_processes");
export const ptyTreeStats = (pid: number) => invoke<TreeStats | null>("pty_tree_stats", { pid });
export const cliPollRequests = () => invoke<string[]>("cli_poll_requests");
export const statsPing = (host: string, timeoutMs?: number) =>
  invoke<number | null>("stats_ping", { host, timeoutMs: timeoutMs ?? null });

/** Reveal the (initially hidden) main window once the UI has mounted. */
export const windowReady = () => invoke<void>("window_ready");

/** Open another full Luxor window (requires `ui.allow_second_window`). */
export const windowOpenNew = () => invoke<void>("window_open_new");

/** Update the recent-projects list shown in the tray menu. */
export const traySetProjects = (projects: { id: string; name: string }[]) =>
  invoke<void>("tray_set_projects", { projects });

/** Resize the tray popup to fit its measured content and re-anchor it. */
export const trayPopupFit = (width: number, height: number) =>
  invoke<void>("tray_popup_fit", { width, height });

/** Hide the tray popup if the current cursor position is outside its bounds. */
export const trayPopupHideIfCursorOutside = (padding = 2) =>
  invoke<boolean>("tray_popup_hide_if_cursor_outside", { padding });

// ---------------------------------------------------------------------------
// Browser mock (dev without Tauri)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// v0.5.0 commands
// ---------------------------------------------------------------------------

export const gitTags = (repoPath: string) => invoke<TagInfo[]>("git_tags", { repoPath });
export const gitTagCreate = (repoPath: string, name: string, message?: string, target?: string) =>
  invoke<void>("git_tag_create", { repoPath, name, message: message ?? null, target: target ?? null });
export const gitTagDelete = (repoPath: string, name: string) =>
  invoke<void>("git_tag_delete", { repoPath, name });
export const gitPushTag = (repoPath: string, name: string, remote?: string) =>
  invoke<void>("git_push_tag", { repoPath, name, remote: remote ?? null });
export const gitReflog = (repoPath: string, limit = 100) =>
  invoke<ReflogEntry[]>("git_reflog", { repoPath, limit });
export const gitCherryPick = (repoPath: string, commitId: string) =>
  invoke<string>("git_cherry_pick", { repoPath, commitId });
export const gitSubmodules = (repoPath: string) =>
  invoke<SubmoduleInfo[]>("git_submodules", { repoPath });
export const gitSubmoduleUpdate = (repoPath: string, name: string) =>
  invoke<void>("git_submodule_update", { repoPath, name });
export const gitConflictPaths = (repoPath: string) =>
  invoke<string[]>("git_conflict_paths", { repoPath });
export const gitConflictSides = (repoPath: string, filePath: string) =>
  invoke<ConflictSides>("git_conflict_sides", { repoPath, filePath });
export const gitConflictResolve = (repoPath: string, filePath: string, content: string) =>
  invoke<void>("git_conflict_resolve", { repoPath, filePath, content });

export const dbQuery = (path: string, sql: string, allowWrite: boolean, maxRows = 500) =>
  invoke<DbRows>("db_query", { path, sql, allowWrite, maxRows });
export const fsEncodings = () => invoke<string[]>("fs_encodings");
export const fsDetectEncoding = (path: string) => invoke<string>("fs_detect_encoding", { path });
export const fsReadTextEncoded = (path: string, encoding: string, maxBytes?: number) =>
  invoke<TextFile>("fs_read_text_encoded", { path, encoding, maxBytes: maxBytes ?? null });
export const fsWriteTextEncoded = (
  path: string,
  content: string,
  encoding: string,
  expectedMtimeMs?: number | null,
) =>
  invoke<number | null>("fs_write_text_encoded", {
    path,
    content,
    encoding,
    expectedMtimeMs: expectedMtimeMs ?? null,
  });

export const searchInProject = (
  root: string,
  query: string,
  useRegex: boolean,
  caseSensitive: boolean,
  maxResults = 1000,
) => invoke<SearchReport>("search_in_project", { root, query, useRegex, caseSensitive, maxResults });
export const replaceInProject = (
  root: string,
  query: string,
  replacement: string,
  useRegex: boolean,
  caseSensitive: boolean,
  onlyPaths?: string[],
) =>
  invoke<ReplaceReport>("replace_in_project", {
    root,
    query,
    replacement,
    useRegex,
    caseSensitive,
    onlyPaths: onlyPaths ?? null,
  });

export const envFiles = (root: string) => invoke<EnvFile[]>("env_files", { root });
export const logFiles = (root: string) => invoke<LogFileInfo[]>("log_files", { root });
export const logTail = (path: string, maxBytes?: number) =>
  invoke<string>("log_tail", { path, maxBytes: maxBytes ?? null });
export const diskUsage = (root: string) => invoke<DiskUsageReport>("disk_usage", { root });
export const depManifests = (root: string) => invoke<DepManifest[]>("dep_manifests", { root });

export const noteGet = (projectId: string) => invoke<string>("note_get", { projectId });
export const noteSet = (projectId: string, body: string) =>
  invoke<void>("note_set", { projectId, body });
export const snippetList = () => invoke<Snippet[]>("snippet_list");
export const snippetSave = (snippet: Snippet) => invoke<Snippet>("snippet_save", { snippet });
export const snippetDelete = (id: string) => invoke<void>("snippet_delete", { id });
export const bookmarkList = (projectId?: string) =>
  invoke<Bookmark[]>("bookmark_list", { projectId: projectId ?? null });
export const bookmarkToggle = (projectId: string | null, file: string, line: number, note = "") =>
  invoke<Bookmark | null>("bookmark_toggle", { projectId, file, line, note });
export const bookmarkDelete = (id: string) => invoke<void>("bookmark_delete", { id });
export const sessionList = (projectId?: string) =>
  invoke<SessionSnapshot[]>("session_list", { projectId: projectId ?? null });
export const sessionSave = (projectId: string | null, name: string, data: string) =>
  invoke<SessionSnapshot>("session_save", { projectId, name, data });
export const sessionDelete = (id: string) => invoke<void>("session_delete", { id });

export const httpRequest = (request: HttpRequestSpec) =>
  invoke<HttpResponseInfo>("http_request", { request });
export const registrySearch = (kind: string, query: string, limit = 20) =>
  invoke<RegistryPackage[]>("registry_search", { kind, query, limit });
export const latestVersions = (kind: string, names: string[]) =>
  invoke<Record<string, string>>("latest_versions", { kind, names });
export const osvCheck = (kind: string, packages: [string, string][]) =>
  invoke<VulnAdvisory[]>("osv_check", { kind, packages });

export const dockerVersion = () => invoke<string | null>("docker_version");
export const dockerContainers = (all: boolean) =>
  invoke<DockerContainer[]>("docker_containers", { all });
export const dockerImages = () => invoke<DockerImage[]>("docker_images");
export const dockerLogs = (containerId: string, tail = 500) =>
  invoke<string>("docker_logs", { containerId, tail });
export const dockerAction = (containerId: string, action: string) =>
  invoke<void>("docker_action", { containerId, action });
export const dockerExec = (containerId: string, command: string) =>
  invoke<string>("docker_exec", { containerId, command });

export const processTree = (rootPid: number) => invoke<ProcessNode[]>("process_tree", { rootPid });
export const processKill = (pid: number, withChildren: boolean) =>
  invoke<number>("process_kill", { pid, withChildren });

export const crashList = () => invoke<CrashReport[]>("crash_list");
/** Append a line to the persistent frontend log (fire-and-forget). */
export const frontendLog = (entry: string) => {
  // Mirror into the live in-memory buffer so the Developer log panel shows this
  // session's events immediately (and so the dev/browser build, which has no
  // Rust log file, still has something to display and share).
  pushLog(entry);
  return invoke<void>("frontend_log", { entry }).catch(() => {});
};

/** Structured log entry with level and category. Both mirrors to the
 *  in-memory buffer (for the Developer panel) and persists to frontend.log.
 *  Format: "LEVEL [category] message | {json data}" */
export const frontendLogStructured = (
  level: LogLevel,
  category: LogCategory,
  message: string,
  data?: Record<string, unknown>,
) => {
  pushStructured(level, category, message, data);
  const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
  const entry = `${level} [${category}] ${message}${dataStr}`;
  return invoke<void>("frontend_log", { entry }).catch(() => {});
};
/**
 * Read the tail of the persisted frontend.log (errors, freezes, STARTUP).
 * Falls back to the in-memory session buffer when the native command is
 * unavailable (older builds / browser dev).
 */
export const frontendLogRead = async (): Promise<string> => {
  try {
    return await invoke<string>("frontend_log_read");
  } catch {
    return logsAsText();
  }
};
/** Clear the persisted frontend.log and the live session buffer. */
export const frontendLogClear = async (): Promise<void> => {
  clearLogs();
  await invoke<void>("frontend_log_clear").catch(() => {});
};
/** Open the folder holding frontend.log / config in the OS file manager. */
export const openLogFolder = () => invoke<void>("open_log_folder").catch(() => {});
/** Full plain-text diagnostics report (version, OS, config, crashes, log). */
export const diagCollect = () => invoke<string>("diag_collect");
export const crashRead = (name: string) => invoke<string>("crash_read", { name });

// ---- GitHub / updates ------------------------------------------------------

export const githubRepo = (path: string) =>
  invoke<import("./types").RepoRef | null>("github_repo", { path });
export const githubIssues = (slug: string, state: string) =>
  invoke<import("./types").GhIssue[]>("github_issues", { slug, state });
export const githubIssueComments = (slug: string, number: number) =>
  invoke<import("./types").GhComment[]>("github_issue_comments", { slug, number });
export const githubIssueCreate = (slug: string, title: string, body: string) =>
  invoke<import("./types").GhIssue>("github_issue_create", { slug, title, body });
export const githubCommentAdd = (slug: string, number: number, text: string) =>
  invoke<void>("github_comment_add", { slug, number, text });
export const githubPulls = (slug: string, state: string) =>
  invoke<import("./types").GhPull[]>("github_pulls", { slug, state });
export const githubPullCreate = (
  slug: string,
  title: string,
  body: string,
  head: string,
  base: string,
  draft: boolean,
) => invoke<import("./types").GhPull>("github_pull_create", { slug, title, body, head, base, draft });
export const githubRuns = (slug: string) =>
  invoke<import("./types").GhRun[]>("github_runs", { slug });
export const updateCheck = (repoSlug: string) =>
  invoke<import("./types").UpdateInfo>("update_check", { repoSlug });
