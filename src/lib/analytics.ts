/**
 * Typed bridge to the local activity-telemetry backend
 * (`luxor_core::telemetry`). Everything stays on this machine.
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
 * counters on every run (plan 1.3). */
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
// ---- always-on background driver ---------------------------------------
//
// Drives sampling on a fixed cadence: reports what the user is doing (active
// project, AI agent, focus) so the backend records an atomic interval. Window
// focus gates "idle" (plan part 9.2). Zero-overhead: one timer, defensive
// try/catch.

let driverTimer: ReturnType<typeof setTimeout> | null = null;
let driverRunning = false;
let sessionSeconds = 0;
let idleSeconds = 0;
// One sampling cadence. Every tick scans the process tree, reads the git
// branch, probes OS idle / the active window and writes SQLite, so it is kept
// slow (30 s) and chained (a tick finishes before the next is scheduled).
const SAMPLE_POLL_SECONDS = 30;
/** A session is closed only after this much idle (matches the Rust
 * `SESSION_GAP_SECONDS` = 30 min) — a single idle blip must not reset it. */
const SESSION_GAP_SECONDS = 30 * 60;
/** Seconds without keyboard/mouse input before the user counts as AFK.
 * Mirrors `luxor_core::activity_os::AFK_THRESHOLD_SECONDS`. */
export const AFK_THRESHOLD_SECONDS = 300;

/**
 * Is the user working right now?
 *
 * The OS input-idle counter (`GetLastInputInfo` on Windows,
 * `CGEventSourceSecondsSinceLastEventType` on macOS) is the authority: Luxor is
 * a cockpit, so the user spends most of their time typing in an external
 * editor, a terminal or the AI agent's own window, and the app frequently sits
 * in the tray. Requiring `document.hasFocus()` classified all of that as idle time.
 *
 * Window focus is only the fallback for platforms without an idle counter
 * (Linux returns `null`).
 */
export function isUserActive(args: { focused: boolean; osIdleSeconds: number | null }): boolean {
  if (args.osIdleSeconds === null) return args.focused;
  return args.osIdleSeconds < AFK_THRESHOLD_SECONDS;
}

/**
 * Translate "is the user active + which AI agent is running" into the activity
 * category recorded by telemetry. An agent detected just before the user
 * walked away must never be credited to an idle interval.
 */
export function classifyActivity(args: {
  focused: boolean;
  osIdleSeconds: number | null;
  agent: string | null;
}): { category: SampleInput["category"]; agent: string | null } {
  if (!isUserActive(args)) return { category: "idle", agent: null };
  return args.agent
    ? { category: "ai", agent: args.agent }
    : { category: "coding", agent: null };
}

// ---- privacy preferences (plan 5.1 Paranoid Mode / 5.5 collection toggle) --
//
// The driver records nothing while collection is off or Paranoid Mode is on.
// Persisted locally so the choice survives restarts; defaults to local-only
// collection enabled, Paranoid off.
const TELEMETRY_PREFS_KEY = "luxor.telemetry.prefs";

export interface TelemetryPrefs {
  /** Master switch for local activity collection (plan 5.5). */
  collect: boolean;
  /** Paranoid / Ghost Mode — disables all collection (plan 5.1). */
  paranoid: boolean;
  /** Store project names/paths hashed instead of readable (plan 5.3). */
  mask_projects: boolean;
}

let prefs: TelemetryPrefs = loadTelemetryPrefs();

function loadTelemetryPrefs(): TelemetryPrefs {
  const defaults: TelemetryPrefs = { collect: true, paranoid: false, mask_projects: false };
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(TELEMETRY_PREFS_KEY);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
      // Masking used to live in the (removed) Discord settings; keep the choice.
      const legacy = localStorage.getItem("luxor.discord.settings");
      if (legacy) {
        const old = JSON.parse(legacy) as { mask_projects?: boolean };
        if (old.mask_projects === true) return { ...defaults, mask_projects: true };
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaults;
}

export function getTelemetryPrefs(): TelemetryPrefs {
  return { ...prefs };
}

export function setTelemetryPrefs(next: TelemetryPrefs): void {
  const maskChanged = next.mask_projects !== prefs.mask_projects;
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
  if (maskChanged) void telemetrySetMasking(prefs.mask_projects).catch(() => {});
}

export function startTelemetryDriver(): () => void {
  if (driverTimer || !isTauri) return () => {};
  // The backend keeps masking in memory only: re-apply the saved choice.
  void telemetrySetMasking(prefs.mask_projects).catch(() => {});

  // Sample what the user is doing and record one atomic interval. This is the
  // only place that touches the process sampler, git, OS probes and the DB.
  const sample = async (): Promise<void> => {
    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    const { projects, activeId } = useProjectsStore.getState();
    const active = projects.find((p) => p.id === activeId) ?? null;

    // OS idle/AFK detection (plan part 9.3) overrides focus when available:
    // working in an external editor or with Luxor in the tray is still working.
    let osIdleSeconds: number | null = null;
    try {
      osIdleSeconds = await telemetryIdleSeconds();
    } catch {
      /* idle counter unavailable on this OS — fall back to focus */
    }

    let detectedAgent: string | null = null;
    if (isUserActive({ focused, osIdleSeconds })) {
      try {
        const agents = await agentsSample();
        const busy = agents.find((a) => a.cpu_percent > 1 || a.count > 0);
        if (busy) detectedAgent = busy.label;
      } catch {
        /* agents sampler unavailable — keep coding */
      }
      // Refine via the focused window title (a focused AI tool counts as AI
      // even if its CPU is momentarily idle) — plan part 1.1 / 9.1.
      if (!detectedAgent) {
        try {
          detectedAgent = aiAgentFromTitle(await telemetryActiveWindow());
        } catch {
          /* active-window unavailable on this OS */
        }
      }
    }
    const { category, agent } = classifyActivity({
      focused,
      osIdleSeconds,
      agent: detectedAgent,
    });

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
    // interval and the branch is not recorded, so spawning git would be pure
    // background waste while the user is away.
    let branch: string | null = null;
    if (active?.path && category !== "idle") {
      try {
        branch = (await gitStatus(active.path)).branch ?? null;
      } catch {
        /* not a git repo / status unavailable */
      }
    }

    try {
      await telemetryRecord({
        category,
        project_path: active?.path ?? null,
        project_name: active?.name ?? null,
        agent,
        branch,
        is_focused: focused,
        duration_seconds: SAMPLE_POLL_SECONDS,
      });
    } catch {
      /* analytics persistence is best effort */
    }
  };

  const tick = async () => {
    try {
      // Respect the privacy switches before touching any sampler or the DB.
      // Also reset session counters so turning tracking back on never bridges a
      // private/off period into the next session timer.
      if (prefs.paranoid || !prefs.collect) {
        sessionSeconds = 0;
        idleSeconds = 0;
        return;
      }
      await sample();
    } catch {
      /* never let the driver throw into the timer */
    }
  };
  // Chain one-shot timers instead of setInterval. The samplers cross process,
  // git, OS and SQLite boundaries, so a slow tick must finish before another
  // starts; overlapping invocations were a major source of avoidable CPU/I/O.
  const scheduleNext = () => {
    if (!driverRunning) return;
    driverTimer = setTimeout(runTick, SAMPLE_POLL_SECONDS * 1000);
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
