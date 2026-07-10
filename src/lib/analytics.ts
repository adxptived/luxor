/**
 * Typed bridge to the local activity-telemetry & Discord-RPC backend
 * (`luxor_core::telemetry` / `luxor_core::discord`). See
 * `plans/luxor_discord_rpc_plan.md`.
 *
 * Field names are snake_case to match the Rust serde payloads verbatim.
 *
 * In plain `vite dev` (no Tauri) every call resolves against an in-memory mock
 * so the Analytics page stays explorable during UI development.
 */

import { agentsSample, gitStatus, isTauri } from "./ipc";
import { useProjectsStore } from "@/state/projectsStore";

// ---- types (mirror Rust serde output) ----------------------------------

export interface TodaySummary {
  total_seconds: number;
  ai_seconds: number;
  coding_seconds: number;
  audit_seconds: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  audits_run: number;
  issues_fixed: number;
  ai_delta_pct: number | null;
}

export interface DayBucket {
  date: string;
  coding_seconds: number;
  ai_seconds: number;
  audit_seconds: number;
}

export interface AgentSlice {
  agent: string;
  seconds: number;
}

export interface HeatCell {
  date: string;
  seconds: number;
}

export interface ProjectTime {
  name: string;
  seconds: number;
  primary_lang: string | null;
}

export interface Achievement {
  key: string;
  title: string;
  description: string;
  progress: number;
  unlocked_at: number | null;
}

export interface DashboardSnapshot {
  today: TodaySummary;
  week: DayBucket[];
  agents: AgentSlice[];
  heatmap: HeatCell[];
  projects: ProjectTime[];
  streak_days: number;
  achievements: Achievement[];
}

export interface SampleInput {
  category: "coding" | "ai" | "audit" | "idle";
  project_path?: string | null;
  project_name?: string | null;
  agent?: string | null;
  branch?: string | null;
  is_focused?: boolean;
  duration_seconds: number;
}

export interface PresenceButton {
  label: string;
  url: string;
}

/**
 * User-customizable text for every activity frame. Placeholders `{project}`,
 * `{branch}`, `{agent}`, `{session}`, `{lines}`, `{issues}` are substituted
 * by the Rust engine at render time; empty fields fall back to the defaults.
 */
export interface DiscordTemplates {
  idle_details: string;
  idle_state: string;
  fallback_details: string;
  fallback_state: string;
  project_details: string;
  project_state: string;
  agent_details: string;
  agent_state: string;
  audit_details: string;
  audit_state_ok: string;
  audit_state_issues: string;
}

export const DEFAULT_DISCORD_TEMPLATES: DiscordTemplates = {
  idle_details: "Idle",
  idle_state: "Taking a break",
  fallback_details: "Working in Luxor",
  fallback_state: "Session: {session}",
  project_details: "Working on {project}",
  project_state: "On branch {branch}",
  agent_details: "Pair programming with {agent}",
  agent_state: "Session: {session}",
  audit_details: "Scanned {lines}",
  audit_state_ok: "No issues found",
  audit_state_issues: "{issues} issues found",
};

export interface DiscordSettings {
  enabled: boolean;
  rotate_seconds: number;
  show_project: boolean;
  show_branch: boolean;
  show_agent: boolean;
  show_audit: boolean;
  mask_projects: boolean;
  blacklist: string[];
  client_id: string;
  buttons: PresenceButton[];
  templates: DiscordTemplates;
}

export interface DiscordStatus {
  enabled: boolean;
  /** True after a recent SET_ACTIVITY frame was actually sent. */
  connected: boolean;
  /** Raw Discord IPC socket/pipe state for diagnostics. */
  ipc_connected?: boolean;
  /** Most recent transport error (pipe not found, handshake rejected, …). */
  last_error?: string | null;
  /** Remaining reconnect backoff while the IPC transport retries. */
  reconnect_in_ms?: number | null;
}

export interface PresenceInput {
  project_name?: string | null;
  branch?: string | null;
  language?: string | null;
  language_asset?: string | null;
  agent?: string | null;
  agent_asset?: string | null;
  session_seconds: number;
  session_start_unix?: number | null;
  lines_scanned?: number | null;
  open_issues?: number | null;
  /** User is AFK/idle — the backend shows a dedicated idle frame. */
  idle?: boolean;
  /** Unix seconds when the idle period started (elapsed timer on the frame). */
  idle_since_unix?: number | null;
}

export interface Presence {
  details: string | null;
  state: string | null;
  start_timestamp: number | null;
  large_image: string | null;
  large_text: string | null;
  small_image: string | null;
  small_text: string | null;
  buttons: PresenceButton[];
}

export const DEFAULT_DISCORD_SETTINGS: DiscordSettings = {
  // Always-on out of the box: presence shows while the app is open without a
  // trip to the Analytics panel first. Users can still turn it off there.
  enabled: true,
  rotate_seconds: 12,
  show_project: true,
  show_branch: true,
  show_agent: true,
  show_audit: true,
  mask_projects: false,
  blacklist: [],
  client_id: "1519063576348721203",
  buttons: [],
  templates: { ...DEFAULT_DISCORD_TEMPLATES },
};

// ---- discord settings persistence ---------------------------------------
//
// Bug fix: settings previously lived only in AnalyticsPanel local state, so
// after every app restart the Rust engine sat at its `enabled: false` default
// until the user happened to open the Analytics panel — i.e. Discord RPC
// "didn't work". They are now persisted here and re-applied once when the
// background telemetry driver starts.
const DISCORD_SETTINGS_KEY = "luxor.discord.settings";

export function loadDiscordSettings(): DiscordSettings {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(DISCORD_SETTINGS_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<DiscordSettings>;
        return {
          ...DEFAULT_DISCORD_SETTINGS,
          ...stored,
          // Deep-merge templates: settings persisted before this field existed
          // (or with a partial set) must still yield every template.
          templates: { ...DEFAULT_DISCORD_TEMPLATES, ...(stored.templates ?? {}) },
        };
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return { ...DEFAULT_DISCORD_SETTINGS, templates: { ...DEFAULT_DISCORD_TEMPLATES } };
}

export function saveDiscordSettings(settings: DiscordSettings): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISCORD_SETTINGS_KEY, JSON.stringify(settings));
    }
  } catch {
    /* ignore quota/private-mode errors */
  }
}

/**
 * Push the persisted Discord settings into the backend engine. Called once at
 * driver start (App.tsx) so RPC works right after launch without opening the
 * Analytics panel.
 */
export async function bootstrapDiscordSettings(): Promise<void> {
  if (!isTauri) return;
  const settings = loadDiscordSettings();
  // Tauri setup and the webview can race during cold start. Retry briefly so
  // RPC does not depend on the user opening the Analytics panel afterward.
  for (const delayMs of [0, 250, 750]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await discordApplySettings(settings);
      return;
    } catch {
      /* retry while the backend finishes initializing */
    }
  }
}

export interface Insight {
  kind: string;
  severity: "info" | "positive" | "warning";
  title: string;
  message: string;
}

export interface WeeklyDigest {
  total_seconds: number;
  ai_seconds: number;
  coding_seconds: number;
  commits: number;
  busiest_day: string | null;
  prime_time_hour: number;
  ai_dependency_pct: number;
  vs_last_week_pct: number | null;
  top_project: string | null;
  top_agent: string | null;
}

export interface InsightsReport {
  digest: WeeklyDigest;
  insights: Insight[];
}

export interface YearInReview {
  total_seconds: number;
  ai_seconds: number;
  coding_seconds: number;
  commits: number;
  lines_added: number;
  lines_removed: number;
  top_projects: ProjectTime[];
  top_agents: AgentSlice[];
  busiest_day: string | null;
  active_days: number;
}

// ---- invoke (with dev mock) --------------------------------------------

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ---- telemetry API ------------------------------------------------------

export const telemetryDashboard = () => invoke<DashboardSnapshot>("telemetry_dashboard");
export const telemetryRecord = (sample: SampleInput) =>
  invoke<void>("telemetry_record", { sample });
export const telemetryGitEvent = (event: {
  project_path?: string | null;
  event_type: "commit" | "branch_switch" | "merge";
  lines_added?: number;
  lines_removed?: number;
  branch?: string | null;
}) => invoke<void>("telemetry_git_event", { event });
export const telemetryBumpAudit = (auditsRun: number, issuesFixed: number) =>
  invoke<void>("telemetry_bump_audit", { auditsRun, issuesFixed });
export const telemetrySetMasking = (masked: boolean) =>
  invoke<void>("telemetry_set_masking", { masked });
export const telemetrySetAchievement = (key: string, progress: number, unlocked: boolean) =>
  invoke<void>("telemetry_set_achievement", { key, progress, unlocked });
export const telemetryExport = () => invoke<unknown>("telemetry_export");
export const telemetryWipe = () => invoke<void>("telemetry_wipe");
export const telemetryInsights = () => invoke<InsightsReport>("telemetry_insights");
export const telemetryYearInReview = () => invoke<YearInReview>("telemetry_year_in_review");
export const telemetryExportCsv = (days?: number) =>
  invoke<string>("telemetry_export_csv", { days: days ?? null });
export const telemetryExportWakatime = (days?: number) =>
  invoke<unknown>("telemetry_export_wakatime", { days: days ?? null });
export const telemetryShareableCard = (title?: string) =>
  invoke<string>("telemetry_shareable_card", { title: title ?? null });
export const telemetryYearCard = (title?: string) =>
  invoke<string>("telemetry_year_card", { title: title ?? null });
export const telemetryEvaluateAchievements = () =>
  invoke<Achievement[]>("telemetry_evaluate_achievements");
export const telemetryIdleSeconds = () => invoke<number | null>("telemetry_idle_seconds");
export const telemetryActiveWindow = () => invoke<string | null>("telemetry_active_window");

// ---- static project audit (plan 1.3) -----------------------------------

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export interface AuditFinding {
  severity: AuditSeverity;
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  files_scanned: number;
  lines_scanned: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** Run a static audit of a project; also bumps audit counters and raises a
 * critical Discord status on critical findings (plan 1.3 / 4.2). */
export const auditRun = (projectPath: string) =>
  invoke<AuditReport>("audit_run", { projectPath });

// ---- extensible metrics (plan 13.1) ------------------------------------

export interface MetricSample {
  key: string;
  value: number;
  unit: string | null;
}

/** Collect all metrics routed through the MetricRegistry providers. */
export const metricsCollect = () => invoke<MetricSample[]>("metrics_collect");

/** Mirror of `luxor_core::active_window::ai_agent_from_title` (plan 9.1). */
export function aiAgentFromTitle(title: string | null): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  const hints: [string, string][] = [
    ["cursor", "Cursor"],
    ["claude", "Claude Code"],
    ["copilot", "Copilot"],
    ["windsurf", "Windsurf"],
    ["aider", "Aider"],
    ["zed", "Zed"],
    ["trae", "Trae"],
  ];
  return hints.find(([k]) => t.includes(k))?.[1] ?? null;
}
export const webhookSendDigest = (opts: {
  slack_url?: string | null;
  telegram_token?: string | null;
  telegram_chat?: string | null;
}) =>
  invoke<void>("webhook_send_digest", {
    slackUrl: opts.slack_url ?? null,
    telegramToken: opts.telegram_token ?? null,
    telegramChat: opts.telegram_chat ?? null,
  });

// ---- discord API --------------------------------------------------------

export const discordStatus = () => invoke<DiscordStatus>("discord_status");
export const discordApplySettings = (settings: DiscordSettings) =>
  invoke<DiscordStatus>("discord_apply_settings", { settings });
export const discordUpdate = (context: PresenceInput) =>
  invoke<Presence | null>("discord_update", { context });
export const discordPushEvent = (
  details: string,
  label?: string,
  priority?: "critical" | "action" | "background",
  holdSeconds?: number,
) =>
  invoke<void>("discord_push_event", {
    details,
    label: label ?? null,
    priority: priority ?? null,
    holdSeconds: holdSeconds ?? null,
  });
export const discordClear = () => invoke<void>("discord_clear");

// ---- always-on background driver ---------------------------------------
//
// Drives sampling on a fixed cadence: reports what the user is doing (active
// project, AI agent, focus) so the backend records an atomic interval, then
// pushes the current activity context to Discord. Window focus gates "idle"
// (plan part 9.2). Zero-overhead: one timer, defensive try/catch.

let driverTimer: ReturnType<typeof setTimeout> | null = null;
let driverRunning = false;
let sessionSeconds = 0;
let idleSeconds = 0;
// Two cadences, deliberately split for cost. Discord enforces a 15 s minimum
// between presence updates and the carousel advances one frame per push, so
// presence is pushed every 15 s to keep the rotation smooth. But the expensive
// work — scanning the process tree, reading the git branch, OS idle/active-
// window probes and the SQLite write — only needs the slower telemetry cadence,
// so it's throttled to every 2nd tick (30 s). Result: the always-on driver does
// heavy I/O at 30 s and only a tiny cached presence push in between, instead of
// running every sampler on every tick.
const PRESENCE_POLL_SECONDS = 15;
const SAMPLE_POLL_SECONDS = 30;
const TICKS_PER_SAMPLE = Math.max(1, Math.round(SAMPLE_POLL_SECONDS / PRESENCE_POLL_SECONDS));
/** A session is closed only after this much idle (matches the Rust
 * `SESSION_GAP_SECONDS` = 30 min) — a single idle blip must not reset it. */
const SESSION_GAP_SECONDS = 30 * 60;

// ---- privacy preferences (plan 5.1 Paranoid Mode / 5.5 collection toggle) --
//
// The driver records nothing while collection is off or Paranoid Mode is on.
// Persisted locally so the choice survives restarts; defaults to local-only
// collection enabled, Paranoid off.
const TELEMETRY_PREFS_KEY = "luxor.telemetry.prefs";

export interface TelemetryPrefs {
  /** Master switch for local activity collection (plan 5.5). */
  collect: boolean;
  /** Paranoid / Ghost Mode — disables all collection *and* RPC (plan 5.1). */
  paranoid: boolean;
}

let prefs: TelemetryPrefs = loadTelemetryPrefs();

function loadTelemetryPrefs(): TelemetryPrefs {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(TELEMETRY_PREFS_KEY);
      if (raw) return { collect: true, paranoid: false, ...JSON.parse(raw) };
    }
  } catch {
    /* ignore malformed storage */
  }
  return { collect: true, paranoid: false };
}

export function getTelemetryPrefs(): TelemetryPrefs {
  return { ...prefs };
}

export function setTelemetryPrefs(next: TelemetryPrefs): void {
  prefs = { ...next };
  // Paranoid Mode is the stronger switch: enabling it must make the collection
  // toggle visibly and semantically off instead of leaving a contradictory
  // { collect: true, paranoid: true } state in storage.
  if (prefs.paranoid) prefs.collect = false;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TELEMETRY_PREFS_KEY, JSON.stringify(prefs));
    }
  } catch {
    /* ignore */
  }
  // Turning collection off / enabling Paranoid Mode must also drop any live
  // Discord presence immediately.
  if (!prefs.collect || prefs.paranoid) {
    void discordClear().catch(() => {});
  }
}

/**
 * Pure builder for the Discord presence context pushed to the backend each
 * sample. Exported for unit tests — this is where "what the user is doing"
 * (coding / AI pair-programming / idle) is translated into presence fields.
 */
export function buildPresenceInput(args: {
  projectName: string | null;
  branch: string | null;
  agent: string | null;
  category: SampleInput["category"];
  sessionSeconds: number;
  idleSeconds: number;
  nowUnix: number;
}): PresenceInput {
  const idle = args.category === "idle";
  return {
    project_name: args.projectName,
    branch: args.branch,
    agent: idle ? null : args.agent,
    session_seconds: args.sessionSeconds,
    session_start_unix: args.nowUnix - args.sessionSeconds,
    idle,
    idle_since_unix: idle ? args.nowUnix - args.idleSeconds : null,
  };
}

export function startTelemetryDriver(): () => void {
  if (driverTimer || !isTauri) return () => {};
  // Re-apply persisted Discord settings before the first presence push so the
  // engine isn't stuck at its `enabled: false` default until the Analytics
  // panel is opened (the original "RPC doesn't work" bug).
  void bootstrapDiscordSettings();
  let tickIndex = 0;
  // Last presence context, re-pushed on the in-between ticks so the Discord
  // carousel keeps rotating without re-running the heavy samplers.
  let lastPresence: PresenceInput | null = null;

  // Heavy path (slow cadence): sample what the user is doing, record one atomic
  // interval and refresh the cached Discord context. This is the only place that
  // touches the process sampler, git, OS probes and the DB.
  const sample = async (): Promise<void> => {
    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    const { projects, activeId } = useProjectsStore.getState();
    const active = projects.find((p) => p.id === activeId) ?? null;

    // OS idle/AFK detection (plan part 9.3) overrides focus when available.
    let afk = false;
    try {
      const idle = await telemetryIdleSeconds();
      if (idle !== null && idle >= 300) afk = true;
    } catch {
      /* idle counter unavailable on this OS — fall back to focus */
    }

    let category: SampleInput["category"] = focused && !afk ? "coding" : "idle";
    let agent: string | null = null;
    if (focused && !afk) {
      try {
        const agents = await agentsSample();
        const busy = agents.find((a) => a.cpu_percent > 1 || a.count > 0);
        if (busy) {
          category = "ai";
          agent = busy.label;
        }
      } catch {
        /* agents sampler unavailable — keep coding */
      }
      // Refine via the focused window title (a focused AI tool counts as AI
      // even if its CPU is momentarily idle) — plan part 1.1 / 9.1.
      if (!agent) {
        try {
          const matched = aiAgentFromTitle(await telemetryActiveWindow());
          if (matched) {
            category = "ai";
            agent = matched;
          }
        } catch {
          /* active-window unavailable on this OS */
        }
      }
    }

    // Session accounting: accumulate active time; only reset after a real gap
    // (a single idle tick must not wipe the session — matches the Rust session
    // model). Idle ticks don't extend the session timer.
    if (category !== "idle") {
      sessionSeconds += SAMPLE_POLL_SECONDS;
      idleSeconds = 0;
    } else {
      idleSeconds += SAMPLE_POLL_SECONDS;
      if (idleSeconds >= SESSION_GAP_SECONDS) sessionSeconds = 0;
    }

    // Resolve the current git branch for the active project (plan 1.2 / 4)
    // so the branch frame and branch-based blacklist actually work. Skip the
    // git subprocess entirely while idle/AFK — the branch is unused on an idle
    // interval and there's no presence to show, so spawning git would be pure
    // background waste while the user is away.
    let branch: string | null = null;
    if (active?.path && category !== "idle") {
      try {
        branch = (await gitStatus(active.path)).branch ?? null;
      } catch {
        /* not a git repo / status unavailable */
      }
    }

    await telemetryRecord({
      category,
      project_path: active?.path ?? null,
      project_name: active?.name ?? null,
      agent,
      branch,
      is_focused: focused,
      duration_seconds: SAMPLE_POLL_SECONDS,
    });

    lastPresence = buildPresenceInput({
      projectName: active?.name ?? null,
      branch,
      agent,
      category,
      sessionSeconds,
      idleSeconds,
      nowUnix: Math.floor(Date.now() / 1000),
    });
  };

  const tick = async () => {
    try {
      // Respect the privacy switches before touching any sampler or the DB.
      // Also reset session counters so turning tracking back on never bridges a
      // private/off period into the next visible Discord timer.
      if (prefs.paranoid || !prefs.collect) {
        sessionSeconds = 0;
        idleSeconds = 0;
        lastPresence = null;
        return;
      }
      // Heavy sample + telemetry write only on the slow cadence; the cheap
      // presence push below runs every tick to keep the carousel rotating.
      if (tickIndex % TICKS_PER_SAMPLE === 0) {
        await sample();
      }
      tickIndex = (tickIndex + 1) % 1_000_000;
      if (lastPresence) {
        await discordUpdate(lastPresence).catch(() => {});
      }
    } catch {
      /* never let the driver throw into the timer */
    }
  };
  // Chain one-shot timers instead of setInterval. The samplers cross process,
  // git, OS and SQLite boundaries, so a slow tick must finish before another
  // starts; overlapping invocations were a major source of avoidable CPU/I/O.
  const scheduleNext = () => {
    if (!driverRunning) return;
    driverTimer = setTimeout(runTick, PRESENCE_POLL_SECONDS * 1000);
  };
  const runTick = async () => {
    if (!driverRunning) return;
    await tick();
    scheduleNext();
  };
  driverRunning = true;
  void runTick();
  return stopTelemetryDriver;
}

export function stopTelemetryDriver(): void {
  driverRunning = false;
  if (driverTimer) {
    clearTimeout(driverTimer);
    driverTimer = null;
  }
}

// ---- dev mock -----------------------------------------------------------

function mockInvoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  if (cmd === "telemetry_dashboard") return Promise.resolve(mockDashboard() as T);
  if (cmd === "discord_status")
    return Promise.resolve({ enabled: true, connected: false, ipc_connected: false } as T);
  if (cmd === "discord_update") return Promise.resolve(null as T);
  if (cmd === "telemetry_idle_seconds" || cmd === "telemetry_active_window")
    return Promise.resolve(null as T);
  if (cmd === "telemetry_year_in_review") return Promise.resolve(mockYearInReview() as T);
  if (cmd === "telemetry_insights") return Promise.resolve(mockInsights() as T);
  if (cmd === "audit_run")
    return Promise.resolve({
      findings: [
        { severity: "high", rule: "unsafe_block", file: "src/x.rs", line: 42, message: "unsafe block" },
        { severity: "low", rule: "tech_debt", file: "src/y.ts", line: 7, message: "TODO marker" },
      ],
      files_scanned: 128,
      lines_scanned: 24500,
      critical: 0,
      high: 1,
      medium: 0,
      low: 1,
      total: 2,
    } as T);
  if (cmd === "metrics_collect")
    return Promise.resolve([
      { key: "audit.open_issues", value: 1, unit: "count" },
      { key: "telemetry.today_seconds", value: 15600, unit: "seconds" },
      { key: "telemetry.ai_seconds", value: 8100, unit: "seconds" },
    ] as T);
  if (cmd === "telemetry_shareable_card" || cmd === "telemetry_year_card")
    return Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0f1424"/><text x="80" y="120" fill="#8ea2ff" font-size="40">⚡ Luxor (preview)</text></svg>' as T);
  if (cmd === "telemetry_export_csv")
    return Promise.resolve("date,coding_seconds,ai_seconds,audit_seconds,total_seconds\n" as T);
  return Promise.resolve(undefined as T);
}

function mockInsights(): InsightsReport {
  return {
    digest: {
      total_seconds: 36 * 3600,
      ai_seconds: 14 * 3600,
      coding_seconds: 20 * 3600,
      commits: 28,
      busiest_day: new Date().toISOString().slice(0, 10),
      prime_time_hour: 15,
      ai_dependency_pct: 38,
      vs_last_week_pct: 12,
      top_project: "luxor-backend",
      top_agent: "Claude Code",
    },
    insights: [
      { kind: "prime_time", severity: "info", title: "Ваше прайм-тайм", message: "Пик продуктивности около 15:00." },
      { kind: "streak", severity: "positive", title: "В потоке", message: "5 дней подряд активности — так держать!" },
      { kind: "trend", severity: "positive", title: "Динамика недели", message: "Общее время выросло на 12%." },
    ],
  };
}

function mockYearInReview(): YearInReview {
  return {
    total_seconds: 820 * 3600,
    ai_seconds: 310 * 3600,
    coding_seconds: 510 * 3600,
    commits: 1240,
    lines_added: 98000,
    lines_removed: 42000,
    top_projects: [
      { name: "luxor-backend", seconds: 320 * 3600, primary_lang: "Rust" },
      { name: "luxor-frontend", seconds: 260 * 3600, primary_lang: "TypeScript" },
    ],
    top_agents: [
      { agent: "Claude Code", seconds: 210 * 3600 },
      { agent: "Cursor", seconds: 80 * 3600 },
    ],
    busiest_day: new Date().toISOString().slice(0, 10),
    active_days: 243,
  };
}

function mockDashboard(): DashboardSnapshot {
  const today = new Date();
  const heatmap: HeatCell[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const r = Math.sin(i * 0.7) * 0.5 + 0.5;
    heatmap.push({
      date: d.toISOString().slice(0, 10),
      seconds: Math.round(r * r * 6 * 3600),
    });
  }
  const week: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    week.push({
      date: d.toISOString().slice(0, 10),
      coding_seconds: Math.round((1 + Math.random() * 3) * 3600),
      ai_seconds: Math.round((0.5 + Math.random() * 2) * 3600),
      audit_seconds: Math.round(Math.random() * 1800),
    });
  }
  return {
    today: {
      total_seconds: 4 * 3600 + 20 * 60,
      ai_seconds: 2 * 3600 + 15 * 60,
      coding_seconds: 2 * 3600 + 5 * 60,
      audit_seconds: 0,
      lines_added: 450,
      lines_removed: 120,
      commits: 7,
      audits_run: 3,
      issues_fixed: 5,
      ai_delta_pct: 12,
    },
    week,
    agents: [
      { agent: "Claude Code", seconds: 6 * 3600 },
      { agent: "Cursor", seconds: 3 * 3600 },
      { agent: "Copilot", seconds: 3600 },
    ],
    heatmap,
    projects: [
      { name: "luxor-backend", seconds: 9 * 3600, primary_lang: "Rust" },
      { name: "luxor-frontend", seconds: 6 * 3600, primary_lang: "TypeScript" },
      { name: "docs", seconds: 1.5 * 3600, primary_lang: "Markdown" },
    ],
    streak_days: 5,
    achievements: [
      { key: "symbiote", title: "Симбиот", description: "100 часов работы с ИИ", progress: 0.62, unlocked_at: null },
      { key: "purity_keeper", title: "Хранитель чистоты", description: "Исправлено 50 багов", progress: 1, unlocked_at: Date.now() },
      { key: "night_watch", title: "Ночной дозор", description: "10 часов после полуночи", progress: 0.3, unlocked_at: null },
      { key: "streak_7", title: "Неделя в потоке", description: "7 дней подряд кодинга", progress: 5 / 7, unlocked_at: null },
      { key: "streak_30", title: "Месяц дисциплины", description: "30 дней подряд кодинга", progress: 5 / 30, unlocked_at: null },
    ],
  };
}

// ---- formatting helpers (shared with the panel) ------------------------

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}
