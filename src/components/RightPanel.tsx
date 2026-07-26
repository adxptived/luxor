/** Optional, highly configurable RIGHT side panel (Settings → Interface).
 *  Mirrors the left SidePanel but offers a much wider, more diverse set of
 *  widgets — project info, git summary, open tasks, recent projects, a live
 *  clock, a focus timer, a persistent scratchpad, quick-launch buttons, the
 *  project's favorite commands, live system + agent stats, and an "embed"
 *  widget that mounts ANY panel (terminal-less: git, files, browser, AI, …)
 *  right inside the sidebar.
 *
 *  Customization lives IN the panel itself (pencil icon in the header):
 *  drag & drop ordering, per-widget show/hide, per-widget accent colors and
 *  per-widget options (clock format, timer presets, row counts, …), plus a
 *  panel-wide accent and density. Persisted via `ui.right_panel_config`
 *  (see `src/lib/rightPanelConfig.ts`). */

import { formatDate, formatTime } from "@/lib/format";
import {
  Activity as ActivityIcon,
  AppWindow,
  Bot,
  Check,
  CheckSquare,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GripVertical,
  History,
  Info,
  MemoryStick,
  NotebookPen,
  PanelRightClose,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Rocket,
  Search as SearchIcon,
  Settings2,
  SquareKanban,
  SquareTerminal,
  Timer as TimerIcon,
  TriangleAlert,
  Zap,
} from "lucide-react";
import React, { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t, useT } from "@/lib/i18n";
import { schedulePoll } from "@/lib/poll";
import {
  ACCENT_PRESETS,
  moveWidget,
  parseRightPanelConfig,
  serializeRightPanelConfig,
  setWidgetAccent,
  setWidgetEnabled,
  setWidgetOptions,
  toLegacyWidgetList,
  type RightPanelConfig,
  type RightWidgetId,
  type RightWidgetOptions,
} from "@/lib/rightPanelConfig";
import type { AgentInfo, RecentProject, RepoStatus, SystemStats, Task } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { fmtClock, useFocusRemaining, useFocusTimer } from "@/state/focusTimerStore";
import { useActiveProject, useProjectsStore } from "@/state/projectsStore";

// Embeddable panels — only the ones that render without a dockview panel api
// (no terminal/diff/editor/image/db/pdf, which need per-panel props). Keep even
// the small embeddable panels lazy: Settings imports EMBEDDABLE_PANELS for labels,
// and that must not drag every possible embedded panel into the startup graph.
const EMBED_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  git: lazy(() => import("@/panels/GitPanel").then((m) => ({ default: m.GitPanel }))),
  files: lazy(() => import("@/panels/FilesPanel").then((m) => ({ default: m.FilesPanel }))),
  web: lazy(() => import("@/panels/BrowserPanel").then((m) => ({ default: m.BrowserPanel }))),
  agents: lazy(() => import("@/panels/AgentsPanel").then((m) => ({ default: m.AgentsPanel }))),
  tasks: lazy(() => import("@/panels/TasksPanel").then((m) => ({ default: m.TasksPanel }))),
  skills: lazy(() => import("@/panels/SkillsPanel").then((m) => ({ default: m.SkillsPanel }))),
  search: lazy(() => import("@/panels/SearchPanel").then((m) => ({ default: m.SearchPanel }))),
  snippets: lazy(() => import("@/panels/SnippetsPanel").then((m) => ({ default: m.SnippetsPanel }))),
  http: lazy(() => import("@/panels/HttpPanel").then((m) => ({ default: m.HttpPanel }))),
  docker: lazy(() => import("@/panels/DockerPanel").then((m) => ({ default: m.DockerPanel }))),
  github: lazy(() => import("@/panels/GithubPanel").then((m) => ({ default: m.GithubPanel }))),
  devtools: lazy(() => import("@/panels/DevToolsPanel").then((m) => ({ default: m.DevToolsPanel }))),
  launcher: lazy(() => import("@/panels/LauncherPanel").then((m) => ({ default: m.LauncherPanel }))),
  activity: lazy(() => import("@/panels/ActivityPanel").then((m) => ({ default: m.ActivityPanel }))),
};

/** All widget ids the right panel can show, in the default order. */
export const RIGHT_PANEL_WIDGETS: { id: string; label: string }[] = [
  { id: "project", label: "Project info" }, // labels translated via t() at render
  { id: "git", label: "Git summary" },
  { id: "tasks", label: "Open tasks" },
  { id: "launch", label: "Quick launch" },
  { id: "favorites", label: "Favorite commands" },
  { id: "notes", label: "Scratchpad" },
  { id: "clock", label: "Clock" },
  { id: "timer", label: "Focus timer" },
  { id: "system", label: "System stats" },
  { id: "agents", label: "AI agents" },
  { id: "recents", label: "Recent projects" },
  { id: "embed", label: "Embedded panel" },
];

export const DEFAULT_RIGHT_WIDGETS = ["clock", "git", "notes", "launch"];

/** Panel kinds that can be embedded in the right panel (id → label, component). */
export const EMBEDDABLE_PANELS: { id: string; label: string }[] = [
  { id: "git", label: "Git" },
  { id: "files", label: "Files" },
  { id: "web", label: "Browser" },
  { id: "agents", label: "AI Agents" },
  { id: "tasks", label: "Tasks" },
  { id: "skills", label: "Skills" },
  { id: "search", label: "Search" },
  { id: "snippets", label: "Snippets" },
  { id: "http", label: "HTTP Client" },
  { id: "docker", label: "Docker" },
  { id: "github", label: "GitHub" },
  { id: "devtools", label: "Dev Tools" },
  { id: "launcher", label: "Launcher" },
  { id: "activity", label: "Activity" },
];

const WIDGET_LABELS: Record<RightWidgetId, string> = Object.fromEntries(
  RIGHT_PANEL_WIDGETS.map((w) => [w.id, w.label]),
) as Record<RightWidgetId, string>;

const NOTES_KEY = "luxor.rightPanel.notes";

/** Local error boundary so a misbehaving embedded panel can't crash the app. */
class EmbedBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <div className="p-3 text-xs text-muted">{t("This panel can't be embedded here.")}</div>;
    }
    return this.props.children;
  }
}

/** Panel-wide look options every widget shell reads (titles / dividers). */
const PanelUi = React.createContext<{ showTitles: boolean; dividers: boolean }>({
  showTitles: true,
  dividers: true,
});

function Widget({
  title,
  icon: Icon,
  compact,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  compact?: boolean;
  children: React.ReactNode;
}) {
  const ui = React.useContext(PanelUi);
  return (
    <div
      className={`lx-rp-widget ${ui.dividers ? "border-b border-edge last:border-b-0" : ""} ${
        compact ? "p-1.5" : "p-2.5"
      }`}
    >
      {ui.showTitles && (
        <div
          className={`flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted ${
            compact ? "mb-1" : "mb-1.5"
          }`}
        >
          <span className="lx-rp-widget-icon flex h-4 w-4 items-center justify-center rounded">
            <Icon size={11} />
          </span>
          <span className="lx-rp-widget-title">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}

function ClockWidget({ o, compact }: { o: RightWidgetOptions; compact: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const showSeconds = o.show_seconds ?? true;
  useEffect(() => {
    // Shared scheduler already pauses while hidden, so the clock stops ticking
    // (and stops re-rendering) in the tray without a per-tick visibility check.
    return schedulePoll(() => setNow(new Date()), showSeconds ? 1000 : 15000);
  }, [showSeconds]);
  const time = formatTime(now, {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" as const } : {}),
    ...(o.hour12 !== undefined ? { hour12: o.hour12 } : {}),
  });
  const date = formatDate(now, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Widget title={t("Clock")} icon={Clock} compact={compact}>
      <div className="font-mono text-xl tabular-nums text-strong">{time}</div>
      {(o.show_date ?? true) && <div className="capitalize text-muted">{date}</div>}
    </Widget>
  );
}

function NotesWidget({ o, compact }: { o: RightWidgetOptions; compact: boolean }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(NOTES_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const save = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (save.current) clearTimeout(save.current);
  }, []);
  const onChange = (v: string) => {
    setText(v);
    clearTimeout(save.current);
    save.current = setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, v);
      } catch {
        /* private mode — best effort */
      }
    }, 400);
  };
  return (
    <Widget title={t("Scratchpad")} icon={NotebookPen} compact={compact}>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("Jot something down…")}
        spellCheck={false}
        style={{ height: o.height ?? 112 }}
        className="w-full resize-none rounded border border-edge bg-raised px-2 py-1.5 text-xs text-strong outline-none focus:border-accent"
      />
    </Widget>
  );
}

/** Pomodoro-style focus countdown. State lives in the shared `focusTimerStore`
 *  so it keeps running when this widget unmounts (e.g. the sidebar is hidden)
 *  and is mirrored in the status bar. */
function TimerWidget({ o, compact }: { o: RightWidgetOptions; compact: boolean }) {
  const mins = useFocusTimer((s) => s.mins);
  const running = useFocusTimer((s) => s.running);
  const toggle = useFocusTimer((s) => s.toggle);
  const reset = useFocusTimer((s) => s.reset);
  const setLength = useFocusTimer((s) => s.setLength);
  const left = useFocusRemaining();
  const presets = o.presets && o.presets.length > 0 ? o.presets : [15, 25, 50];
  return (
    <Widget title={t("Focus timer")} icon={TimerIcon} compact={compact}>
      <div className="mb-1.5 font-mono text-2xl tabular-nums text-strong">{fmtClock(left)}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-muted hover:border-muted hover:text-strong"
          onClick={toggle}
        >
          {running ? <Pause size={12} /> : <Play size={12} />} {running ? t("Pause") : t("Start")}
        </button>
        <button
          className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-muted hover:border-muted hover:text-strong"
          onClick={reset}
          title={t("Reset")}
         aria-label={t("Reset")}>
          <RotateCcw size={12} />
        </button>
        {presets.map((m) => (
          <button
            key={m}
            className={`rounded border px-1.5 py-0.5 text-2xs ${
              mins === m ? "border-muted text-strong" : "border-edge text-muted hover:text-strong"
            }`}
            onClick={() => setLength(m)}
          >
            {m}m
          </button>
        ))}
      </div>
    </Widget>
  );
}

function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <div
        className="lx-rp-bar h-full rounded-full bg-muted"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function SystemWidget({ o, compact }: { o: RightWidgetOptions; compact: boolean }) {
  const [s, setS] = useState<SystemStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void ipc
        .statsSample()
        .then((x) => !cancelled && setS(x))
        .catch(() => {});
    };
    const unschedule = schedulePoll(poll, 2000);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, []);
  if (!s) return null;
  const memPct = s.mem_total > 0 ? (s.mem_used / s.mem_total) * 100 : 0;
  return (
    <Widget title={t("System stats")} icon={ActivityIcon} compact={compact}>
      {(o.show_cpu ?? true) && (
        <>
          <div className="mb-0.5 flex items-center justify-between text-muted">
            <span className="flex items-center gap-1">
              <Cpu size={11} /> {t("CPU")}
            </span>
            <span className="tabular-nums text-strong">{s.cpu_percent.toFixed(0)}%</span>
          </div>
          <Bar pct={s.cpu_percent} />
        </>
      )}
      {(o.show_ram ?? true) && (
        <>
          <div className={`mb-0.5 flex items-center justify-between text-muted ${(o.show_cpu ?? true) ? "mt-1.5" : ""}`}>
            <span className="flex items-center gap-1">
              <MemoryStick size={11} /> {t("RAM")}
            </span>
            <span className="tabular-nums text-strong">
              {fmtGb(s.mem_used)} / {fmtGb(s.mem_total)}
            </span>
          </div>
          <Bar pct={memPct} />
        </>
      )}
    </Widget>
  );
}

function AgentsWidget({ o, compact, onOpen }: { o: RightWidgetOptions; compact: boolean; onOpen: () => void }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void ipc
        .agentsSample()
        .then((x) => !cancelled && setAgents(x))
        .catch(() => {});
    };
    // The agent sampler walks the full OS process list — the scheduler pauses
    // it entirely while hidden.
    const unschedule = schedulePoll(poll, 5000);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, []);
  const max = o.max_items ?? 6;
  const total = agents.reduce((n, a) => n + a.count, 0);
  const totalCpu = agents.reduce((n, a) => n + a.cpu_percent, 0);
  const totalMem = agents.reduce((n, a) => n + a.mem_bytes, 0);
  return (
    <Widget title={`${t("AI agents")} (${total})`} icon={Bot} compact={compact}>
      {agents.length === 0 && <div className="text-muted">{t("No agents running.")}</div>}
      {agents.slice(0, max).map((a) => (
        <button
          key={a.id}
          className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-raised"
          onClick={onOpen}
        >
          <span className="truncate text-strong">
            {a.label} ×{a.count}
          </span>
          <span className="tabular-nums text-muted">{a.cpu_percent.toFixed(0)}%</span>
        </button>
      ))}
      {agents.length > 0 && (
        <div className="mt-1 flex items-center justify-between border-t border-edge pt-1 text-2xs tabular-nums text-muted">
          <span>{t("Total")}</span>
          <span>
            {totalCpu.toFixed(0)}% · {(totalMem / 1024 ** 2).toFixed(0)}M
          </span>
        </div>
      )}
    </Widget>
  );
}

// ─── Edit mode ──────────────────────────────────────────────────────────────

/** Accent swatch row: presets + "auto" + a free color input. */
function AccentPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (accent: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        className={`flex h-5 items-center rounded border px-1.5 text-3xs ${
          value === null ? "border-accent text-accent" : "border-edge text-muted hover:text-strong"
        }`}
        onClick={() => onChange(null)}
        title={t("Use the app accent")}
      >
        {t("Auto")}
      </button>
      {ACCENT_PRESETS.map((hex) => (
        <button
          key={hex}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-edge transition-transform hover:scale-110"
          style={{ background: hex }}
          onClick={() => onChange(hex)}
          title={hex}
          aria-label={hex}
        >
          {value === hex && <Check size={11} className="text-white drop-shadow" />}
        </button>
      ))}
      <label
        className="relative flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-muted"
        title={t("Custom color")}
      >
        <span
          className="absolute inset-0"
          style={{
            background:
              value && !ACCENT_PRESETS.includes(value)
                ? value
                : "conic-gradient(#e03131,#f08c00,#2f9e44,#1971c2,#e64980,#e03131)",
          }}
        />
        <input
          type="color"
          value={value ?? "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={t("Custom color")}
        />
      </label>
    </div>
  );
}

function OptToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-0.5">
      <span className="text-muted">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function OptNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 rounded border border-edge bg-raised px-1 py-0.5 text-right text-xs text-strong outline-none focus:border-accent"
      />
    </label>
  );
}

/** Per-widget option editors (only widgets that HAVE options get a gear). */
function WidgetOptionsEditor({
  id,
  options,
  onPatch,
}: {
  id: RightWidgetId;
  options: RightWidgetOptions;
  onPatch: (patch: RightWidgetOptions) => void;
}) {
  switch (id) {
    case "clock":
      return (
        <>
          <OptToggle label={t("12-hour format")} checked={options.hour12 ?? false} onChange={(v) => onPatch({ hour12: v })} />
          <OptToggle
            label={t("Show seconds")}
            checked={options.show_seconds ?? true}
            onChange={(v) => onPatch({ show_seconds: v })}
          />
          <OptToggle label={t("Show date")} checked={options.show_date ?? true} onChange={(v) => onPatch({ show_date: v })} />
        </>
      );
    case "timer":
      return (
        <label className="flex flex-col gap-1 py-0.5">
          <span className="text-muted">{t("Presets (minutes, comma-separated)")}</span>
          <input
            type="text"
            defaultValue={(options.presets ?? [15, 25, 50]).join(", ")}
            onBlur={(e) => {
              const presets = e.target.value
                .split(/[,\s]+/)
                .map((x) => Number.parseInt(x, 10))
                .filter((n) => Number.isFinite(n) && n > 0);
              onPatch({ presets });
            }}
            className="rounded border border-edge bg-raised px-1.5 py-0.5 text-xs text-strong outline-none focus:border-accent"
          />
        </label>
      );
    case "tasks":
    case "recents":
    case "agents":
    case "favorites":
      return (
        <OptNumber
          label={t("Max rows")}
          value={options.max_items ?? (id === "recents" ? 8 : 6)}
          min={1}
          max={20}
          onChange={(v) => onPatch({ max_items: v })}
        />
      );
    case "notes":
      return (
        <OptNumber label={t("Height (px)")} value={options.height ?? 112} min={60} max={400} onChange={(v) => onPatch({ height: v })} />
      );
    case "system":
      return (
        <>
          <OptToggle label={t("Show CPU")} checked={options.show_cpu ?? true} onChange={(v) => onPatch({ show_cpu: v })} />
          <OptToggle label={t("Show RAM")} checked={options.show_ram ?? true} onChange={(v) => onPatch({ show_ram: v })} />
        </>
      );
    case "git":
      return (
        <OptToggle
          label={t("Show counters")}
          checked={options.show_counts ?? true}
          onChange={(v) => onPatch({ show_counts: v })}
        />
      );
    default:
      return null;
  }
}

const HAS_OPTIONS: ReadonlySet<RightWidgetId> = new Set([
  "clock",
  "timer",
  "tasks",
  "recents",
  "agents",
  "favorites",
  "notes",
  "system",
  "git",
]);

/** The edit-mode widget list: drag to reorder, eye to toggle, palette + gear. */
function PanelEditor({
  cfg,
  onChange,
  onClose,
  width,
  onWidthChange,
}: {
  cfg: RightPanelConfig;
  onChange: (next: RightPanelConfig) => void;
  onClose: () => void;
  width: number;
  onWidthChange: (px: number) => void;
}) {
  const [openId, setOpenId] = useState<RightWidgetId | null>(null);
  const [dragId, setDragId] = useState<RightWidgetId | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const commitDrop = (index: number) => {
    if (dragId !== null) onChange(moveWidget(cfg, dragId, index));
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <div className="lx-anim-fade-in flex flex-col gap-1 p-2">
      <div className="px-0.5 pb-1 text-2xs text-muted">
        {t("Drag to reorder. Toggle, tint and tune each widget.")}
      </div>
      {cfg.widgets.map((w, i) => {
        const open = openId === w.id;
        return (
          <div
            key={w.id}
            className={`rounded-md border transition-colors ${
              overIndex === i && dragId !== w.id ? "border-accent" : "border-edge"
            } ${dragId === w.id ? "opacity-40" : ""} ${w.enabled ? "bg-raised/40" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragId(w.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", w.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIndex !== i) setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop(i);
            }}
          >
            <div className="flex items-center gap-1 px-1.5 py-1">
              <GripVertical size={12} className="shrink-0 cursor-grab text-muted" />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-edge"
                style={{ background: w.accent ?? "var(--lx-accent)" }}
                title={w.accent ?? t("Auto")}
              />
              <span className={`min-w-0 flex-1 truncate ${w.enabled ? "text-strong" : "text-muted"}`}>
                {t(WIDGET_LABELS[w.id])}
              </span>
              {HAS_OPTIONS.has(w.id) && (
                <button
                  className={`rounded p-0.5 hover:bg-raised ${open ? "text-accent" : "text-muted hover:text-strong"}`}
                  onClick={() => setOpenId(open ? null : w.id)}
                  title={t("Widget settings")}
                  aria-expanded={open}
                >
                  <Settings2 size={13} />
                </button>
              )}
              <button
                className="rounded p-0.5 text-muted hover:bg-raised hover:text-strong"
                onClick={() => onChange(setWidgetEnabled(cfg, w.id, !w.enabled))}
                title={w.enabled ? t("Hide widget") : t("Show widget")}
              >
                {w.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
            {open && (
              <div className="lx-anim-expand border-t border-edge px-2 py-1.5 text-xs">
                <div className="mb-1.5">
                  <div className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted">{t("Accent")}</div>
                  <AccentPicker value={w.accent} onChange={(a) => onChange(setWidgetAccent(cfg, w.id, a))} />
                </div>
                <WidgetOptionsEditor
                  id={w.id}
                  options={w.options}
                  onPatch={(patch) => onChange(setWidgetOptions(cfg, w.id, patch))}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-2 rounded-md border border-edge px-2 py-1.5">
        <div className="mb-1 text-3xs font-semibold uppercase tracking-wide text-muted">{t("Panel accent")}</div>
        <AccentPicker value={cfg.accent} onChange={(a) => onChange({ ...cfg, accent: a })} />
        <div className="mb-1 mt-2 text-3xs font-semibold uppercase tracking-wide text-muted">{t("Density")}</div>
        <div className="flex gap-1">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              className={`rounded border px-2 py-0.5 text-2xs ${
                cfg.density === d ? "border-accent text-accent" : "border-edge text-muted hover:text-strong"
              }`}
              onClick={() => onChange({ ...cfg, density: d })}
            >
              {d === "comfortable" ? t("Comfortable") : t("Compact")}
            </button>
          ))}
        </div>
        <div className="mb-1 mt-2 text-3xs font-semibold uppercase tracking-wide text-muted">{t("Font size")}</div>
        <div className="flex gap-1">
          {(
            [
              ["xs", t("Small")],
              ["sm", t("Normal")],
              ["md", t("Large")],
            ] as const
          ).map(([fs, label]) => (
            <button
              key={fs}
              className={`rounded border px-2 py-0.5 text-2xs ${
                cfg.font_size === fs ? "border-accent text-accent" : "border-edge text-muted hover:text-strong"
              }`}
              onClick={() => onChange({ ...cfg, font_size: fs })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs">
          <OptToggle
            label={t("Show widget titles")}
            checked={cfg.show_titles}
            onChange={(v) => onChange({ ...cfg, show_titles: v })}
          />
          <OptToggle
            label={t("Show dividers")}
            checked={cfg.dividers}
            onChange={(v) => onChange({ ...cfg, dividers: v })}
          />
          <OptNumber
            label={t("Panel width (px)")}
            value={width}
            min={200}
            max={520}
            onChange={onWidthChange}
          />
        </div>
      </div>

      <button
        className="lx-btn-primary mt-1 rounded px-2 py-1 text-center text-xs font-medium"
        onClick={onClose}
      >
        {t("Done")}
      </button>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

function RightPanelImpl() {
  // Subscribe to language changes. This component is `memo`-wrapped and its
  // props do not change on a language switch, so without this it would keep
  // rendering the previous language's strings.
  useT();
  const config = useAppStore((s) => s.config);
  const project = useActiveProject();
  const addProjectPath = useProjectsStore((s) => s.addProjectPath);
  const openPanel = useDockStore((s) => s.openPanel);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const [git, setGit] = useState<RepoStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [editing, setEditing] = useState(false);

  const enabled = config?.ui.right_panel_enabled ?? false;
  // Smooth open/close: `render` keeps the content mounted (so its polling
  // intervals run) and `shown` drives the animated width. On open we mount at
  // width 0 first, then flip `shown` on the next frame so the browser animates
  // 0 → full width; on close we collapse to 0 and unmount only once the width
  // transition has finished. This replaces the old snap-open ("jerky") behavior.
  const [render, setRender] = useState(enabled);
  const [shown, setShown] = useState(enabled);
  useEffect(() => {
    if (enabled) {
      setRender(true);
      // Double rAF: frame 1 mounts the DOM at width 0, frame 2 flips `shown`
      // so the browser has a committed starting frame to animate FROM. Without
      // this the panel jumps to full width with no transition ("jerky open").
      let id1 = 0;
      let id2 = 0;
      id1 = requestAnimationFrame(() => {
        id2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(id1);
        cancelAnimationFrame(id2);
      };
    }
    setShown(false);
    return undefined;
  }, [enabled]);

  const rpConfig = useMemo(
    () => parseRightPanelConfig(config?.ui.right_panel_config ?? "", config?.ui.right_panel_widgets ?? []),
    [config?.ui.right_panel_config, config?.ui.right_panel_widgets],
  );
  const saveRpConfig = useCallback(
    (next: RightPanelConfig) => {
      const cur = useAppStore.getState().config;
      if (!cur) return;
      void useAppStore.getState().saveConfig({
        ...cur,
        ui: {
          ...cur.ui,
          right_panel_config: serializeRightPanelConfig(next),
          // Keep the legacy string list mirrored for config sharing/older builds.
          right_panel_widgets: toLegacyWidgetList(next),
        },
      });
    },
    [],
  );

  const visible = rpConfig.widgets.filter((w) => w.enabled);
  const has = (id: RightWidgetId) => visible.some((w) => w.id === id);
  const compact = rpConfig.density === "compact";
  const fontClass = rpConfig.font_size === "xs" ? "text-2xs" : rpConfig.font_size === "md" ? "text-sm" : "text-xs";
  const panelUi = useMemo(
    () => ({ showTitles: rpConfig.show_titles, dividers: rpConfig.dividers }),
    [rpConfig.show_titles, rpConfig.dividers],
  );
  const saveWidth = useCallback((px: number) => {
    const cur = useAppStore.getState().config;
    if (!cur || !Number.isFinite(px)) return;
    void useAppStore.getState().saveConfig({
      ...cur,
      ui: { ...cur.ui, right_panel_width: Math.min(520, Math.max(200, Math.round(px))) },
    });
  }, []);
  const width = Math.min(520, Math.max(200, config?.ui.right_panel_width ?? 280));
  const responsiveWidth = `min(${width}px, max(180px, 32vw))`;
  const embedKind = config?.ui.right_panel_embed ?? "";
  const dir = project && project.path !== "" ? project.path : null;

  // Git summary poll.
  useEffect(() => {
    if (!enabled || !has("git") || !project || project.path === "") {
      setGit(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const root = (await ipc.gitDiscoverRoot(project.path).catch(() => null)) ?? project.path;
        const st = await ipc.gitStatus(root);
        if (!cancelled) setGit(st);
      } catch {
        if (!cancelled) setGit(null);
      }
    };
    // Small defer keeps git status off the panel-open frame; then the shared
    // scheduler runs it every 8 s while visible.
    let unschedule = () => {};
    const first = setTimeout(() => {
      unschedule = schedulePoll(() => void poll(), 8000);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(first);
      unschedule();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rpConfig, project]);

  // Tasks poll.
  useEffect(() => {
    if (!enabled || !has("tasks") || !project) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void ipc
        .taskList(project.id)
        .then((x) => !cancelled && setTasks(x))
        .catch(() => {});
    };
    let unschedule = () => {};
    const first = setTimeout(() => {
      unschedule = schedulePoll(poll, 15000);
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(first);
      unschedule();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rpConfig, project]);

  // Recents (load once per open).
  useEffect(() => {
    if (!enabled || !has("recents")) return;
    ipc.recentList(8).then(setRecents, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rpConfig]);

  if (!enabled && !render) return null;

  const openTasks = tasks.filter((x) => x.status !== "done");
  const collapse = () => {
    if (config) void useAppStore.getState().saveConfig({ ...config, ui: { ...config.ui, right_panel_enabled: false } });
  };

  const launchItems = [
    { id: "terminal", label: t("Terminal"), icon: SquareTerminal, onClick: () => addTerminal() },
    { id: "files", label: t("Files"), icon: FolderOpen, onClick: () => openPanel("files") },
    { id: "git", label: t("Git"), icon: FolderGit2, onClick: () => openPanel("git") },
    { id: "search", label: t("Search"), icon: SearchIcon, onClick: () => openPanel("search") },
    { id: "tasks", label: t("Tasks"), icon: SquareKanban, onClick: () => openPanel("tasks") },
    { id: "launcher", label: t("Launcher"), icon: Rocket, onClick: () => openPanel("launcher") },
  ];

  const EmbedComp = EMBED_COMPONENTS[embedKind] ?? null;

  const renderWidget = (w: (typeof rpConfig.widgets)[number], index: number) => {
    const o = w.options;
    // Per-widget accent: overriding --lx-accent locally re-tints everything the
    // widget draws with accent tokens; `.lx-rp-accented` also re-derives the
    // soft/hover mixes (see styles.css) so chips and fills follow along.
    const style = w.accent ? ({ "--lx-accent": w.accent } as React.CSSProperties) : undefined;
    const cls = w.accent ? "lx-rp-accented" : undefined;
    const wrap = (node: React.ReactNode) =>
      node === null ? null : (
        <div
          key={w.id}
          className={`lx-anim-widget-in ${cls ?? ""}`}
          style={{ ...style, animationDelay: `${Math.min(index, 8) * 30}ms` }}
        >
          {node}
        </div>
      );

    switch (w.id) {
      case "clock":
        return wrap(<ClockWidget o={o} compact={compact} />);
      case "notes":
        return wrap(<NotesWidget o={o} compact={compact} />);
      case "timer":
        return wrap(<TimerWidget o={o} compact={compact} />);
      case "system":
        return wrap(<SystemWidget o={o} compact={compact} />);
      case "agents":
        return wrap(<AgentsWidget o={o} compact={compact} onOpen={() => openPanel("agents")} />);
      case "project":
        return wrap(
          <Widget title={t("Project")} icon={Info} compact={compact}>
            {project ? (
              <>
                <div className="mb-0.5 flex items-center gap-1.5 text-sm font-medium text-strong">
                  {project.icon ? <span>{project.icon}</span> : <FolderGit2 size={13} className="opacity-60" />}
                  <span className="truncate">{project.name}</span>
                </div>
                {project.path ? (
                  <div className="break-all text-muted" title={project.path}>
                    {project.path}
                    {!project.path_exists && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-warning">
                        <TriangleAlert size={10} /> {t("missing")}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-muted">{t("Blank workspace")}</div>
                )}
              </>
            ) : (
              <div className="text-muted">{t("No project open.")}</div>
            )}
          </Widget>,
        );
      case "git":
        return wrap(
          git?.branch ? (
            <Widget title={t("Git")} icon={GitBranch} compact={compact}>
              <button className="text-left hover:text-strong" onClick={() => openPanel("git")}>
                <div className="text-strong">{git.branch}</div>
                {(o.show_counts ?? true) && (
                  <div className="text-muted">
                    ↑{git.ahead} ↓{git.behind} · {git.entries.length} {t("changes")}
                  </div>
                )}
              </button>
            </Widget>
          ) : null,
        );
      case "tasks":
        return wrap(
          project ? (
            <Widget title={`${t("Tasks")} (${openTasks.length})`} icon={CheckSquare} compact={compact}>
              {openTasks.slice(0, o.max_items ?? 6).map((x) => (
                <button
                  key={x.id}
                  className="block w-full truncate rounded px-1 py-0.5 text-left text-strong hover:bg-raised"
                  onClick={() => openPanel("tasks")}
                  title={x.title}
                >
                  • {x.title}
                </button>
              ))}
              {openTasks.length === 0 && <div className="text-muted">{t("No open tasks.")}</div>}
            </Widget>
          ) : null,
        );
      case "launch":
        return wrap(
          <Widget title={t("Quick launch")} icon={Rocket} compact={compact}>
            <div className="grid grid-cols-2 gap-1">
              {launchItems.map((it) => (
                <button
                  key={it.id}
                  className="flex items-center gap-1.5 rounded border border-edge px-2 py-1 text-left text-muted hover:border-muted hover:text-strong"
                  onClick={it.onClick}
                >
                  <it.icon size={13} className="shrink-0 text-muted" />
                  <span className="truncate">{it.label}</span>
                </button>
              ))}
            </div>
          </Widget>,
        );
      case "favorites":
        return wrap(
          project ? (
            <Widget title={t("Favorite commands")} icon={Zap} compact={compact}>
              {project.favorite_commands.length === 0 && <div className="text-muted">{t("No favorites yet.")}</div>}
              {project.favorite_commands.slice(0, o.max_items ?? 6).map((cmd, i) => (
                <button
                  key={`${cmd}-${i}`}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-raised"
                  title={`${t("Run in new terminal:")} ${cmd}`}
                  onClick={() => addTerminal({ cwd: dir, autorun: [cmd] })}
                >
                  <Play size={11} className="shrink-0 text-muted" />
                  <span className="truncate font-mono text-2xs text-strong">{cmd}</span>
                </button>
              ))}
            </Widget>
          ) : null,
        );
      case "recents":
        return wrap(
          <Widget title={t("Recent projects")} icon={History} compact={compact}>
            {recents.slice(0, o.max_items ?? 8).map((r) => (
              <button
                key={r.path}
                className="block w-full truncate rounded px-1 py-0.5 text-left text-strong hover:bg-raised"
                title={r.path}
                onClick={() => void addProjectPath(r.path)}
              >
                {r.name}
              </button>
            ))}
            {recents.length === 0 && <div className="text-muted">{t("Nothing yet.")}</div>}
          </Widget>,
        );
      case "embed":
        return wrap(
          <div className="flex flex-col border-b border-edge">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
              <AppWindow size={12} /> {t("Embedded panel")}
            </div>
            {EmbedComp ? (
              <div className="relative h-[360px] overflow-hidden border-t border-edge">
                <EmbedBoundary>
                  <Suspense
                    fallback={
                      <div className="flex h-full w-full items-center justify-center text-muted">{t("Loading…")}</div>
                    }
                  >
                    <EmbedComp />
                  </Suspense>
                </EmbedBoundary>
              </div>
            ) : (
              <div className="px-2.5 pb-2.5 text-muted">{t("Pick a panel to embed in Settings → Interface.")}</div>
            )}
          </div>,
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="lx-anim-right-panel shrink-0 overflow-hidden border-l border-edge bg-bar"
      style={{
        width: shown ? responsiveWidth : 0,
        ...(rpConfig.accent ? ({ "--lx-accent": rpConfig.accent } as React.CSSProperties) : {}),
      }}
      onTransitionEnd={(e) => {
        // Only react to the width transition finishing while closing.
        if (e.propertyName === "width" && !enabled) setRender(false);
      }}
      data-testid="right-panel"
    >
      <div
        className={`flex h-full flex-col overflow-y-auto ${fontClass} transition-opacity duration-150 ${
          shown ? "opacity-100" : "opacity-0"
        } ${rpConfig.accent ? "lx-rp-accented" : ""}`}
        style={{ width: responsiveWidth }}
      >
        <div className="flex items-center justify-between border-b border-edge px-2.5 py-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{t("Panel")}</span>
          <div className="flex items-center gap-0.5">
            <button
              className={`rounded p-0.5 hover:bg-raised ${editing ? "text-accent" : "text-muted hover:text-strong"}`}
              title={editing ? t("Done editing") : t("Customize panel")}
              onClick={() => setEditing((v) => !v)}
              aria-pressed={editing}
            >
              <Pencil size={13} />
            </button>
            <button
              className="rounded p-0.5 text-muted hover:bg-raised hover:text-strong"
              title={t("Hide right panel")}
              onClick={collapse}
             aria-label={t("Hide right panel")}>
              <PanelRightClose size={14} />
            </button>
          </div>
        </div>

        {editing ? (
          <PanelEditor
            cfg={rpConfig}
            onChange={saveRpConfig}
            onClose={() => setEditing(false)}
            width={width}
            onWidthChange={saveWidth}
          />
        ) : (
          <PanelUi.Provider value={panelUi}>{visible.map((w, i) => renderWidget(w, i))}</PanelUi.Provider>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized: mounted statically at the app root, so it should only re-render on
 * its own store subscriptions, not on every unrelated root re-render.
 */
export const RightPanel = memo(RightPanelImpl);
