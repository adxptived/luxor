import {
  Activity,
  ArrowDownUp,
  Bot,
  Check,
  CircleDot,
  Clock,
  Cpu,
  GitBranch,
  MemoryStick,
  PanelRight,
  RotateCcw,
  SlidersHorizontal,
  Timer as TimerIcon,
  ZoomIn,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { schedulePoll } from "@/lib/poll";
import { fmtCpu } from "@/lib/cpu";
import { setDragGhost } from "@/lib/dragGhost";
import {
  SEGMENT_TOGGLES,
  SPACER_ID,
  moveSegment,
  resolveSegmentOrder,
  segmentLabel,
} from "@/lib/statusSegments";
import {
  STATUS_ALIGN_OPTIONS,
  alignToJustify,
  loadStatusBarAlign,
  saveStatusBarAlign,
  type StatusBarAlign,
} from "@/lib/statusBarPrefs";
import type { AgentInfo, RepoStatus, StatusBarConfig, SystemStats, Task } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { fmtClock, useFocusRemaining, useFocusTimer } from "@/state/focusTimerStore";
import { openContextMenu } from "@/state/uiStore";
import { useActiveProject } from "@/state/projectsStore";
import pkg from "../../package.json";

const APP_VERSION: string = (pkg as { version: string }).version;

const fmtGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)}G`;

const fmtMem = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}G` : `${Math.round(bytes / 1024 ** 2)}M`;

function fmtRate(bps: number | null): string {
  if (bps === null) return "–";
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)}M/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)}K/s`;
  return `${Math.round(bps)}B/s`;
}

function StatusBarImpl() {
  const project = useActiveProject();
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const sb = config?.status_bar;
  const openPanel = useDockStore((s) => s.openPanel);
  const [git, setGit] = useState<RepoStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [dragSeg, setDragSeg] = useState<string | null>(null);
  const [dragOverSeg, setDragOverSeg] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [clock, setClock] = useState(() => new Date());
  const [align, setAlign] = useState<StatusBarAlign>(() => loadStatusBarAlign());
  const toast = useAppStore((s) => s.toast);
  const setZoom = useAppStore((s) => s.setZoom);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  // Live focus-timer mirror (shown only while running, so no toggle needed).
  const focusRunning = useFocusTimer((s) => s.running);
  const focusToggle = useFocusTimer((s) => s.toggle);
  const focusLeft = useFocusRemaining();

  // Phase 4: pulse-on-change for status segments. Track a snapshot of the
  // values that drive the segment text; when they change, add a CSS class
  // that triggers the lx-status-pulse animation.
  const prevSnapshot = useRef("");
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    const snap = JSON.stringify({ git: git?.branch, cpu: stats?.cpu_percent, ram: stats?.mem_used, ping, agents: agents.length, tasks: tasks?.filter((t) => t.status !== "done").length });
    if (snap !== prevSnapshot.current) {
      prevSnapshot.current = snap;
      setPulseKey((k) => k + 1);
    }
  }, [git, stats, ping, agents, tasks]);

  const showGit = sb?.show_git ?? true;
  const wantsStats = (sb?.show_cpu ?? true) || (sb?.show_ram ?? true) || (sb?.show_net ?? false);
  const wantsPing = sb?.show_ping ?? false;
  const wantsAgents = sb?.show_agents ?? true;
  const refreshMs = Math.max(1, sb?.refresh_secs ?? 2) * 1000;
  const pingHost = sb?.ping_host ?? "1.1.1.1:443";
  const order = resolveSegmentOrder(sb?.segment_order ?? []);

  // Git status poll (repo root discovered so subfolders work too).
  useEffect(() => {
    if (!showGit || !project || project.path === "") {
      setGit(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const root = (await ipc.gitDiscoverRoot(project.path).catch(() => null)) ?? project.path;
        const status = await ipc.gitStatus(root);
        if (!cancelled) setGit(status);
      } catch {
        if (!cancelled) setGit(null);
      }
    };
    // Shared scheduler: leading refresh, then every 5 s while visible; fully
    // paused (no timer) while the window is hidden — git status is heavy.
    const unschedule = schedulePoll(() => void poll(), 5000);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, [project, showGit]);

  // System stats poll.
  useEffect(() => {
    if (!wantsStats) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void ipc
        .statsSample()
        .then((s) => !cancelled && setStats(s))
        .catch(() => {});
    };
    // Scheduler skips ticks (and stops entirely) while hidden, so the CPU/RAM
    // sampler no longer wakes the process in the tray.
    const unschedule = schedulePoll(poll, refreshMs);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, [wantsStats, refreshMs]);

  // Ping poll (less frequent).
  useEffect(() => {
    if (!wantsPing) {
      setPing(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void ipc
        .statsPing(pingHost)
        .then((ms) => !cancelled && setPing(ms))
        .catch(() => !cancelled && setPing(null));
    };
    const unschedule = schedulePoll(poll, Math.max(refreshMs * 2, 4000));
    return () => {
      cancelled = true;
      unschedule();
    };
  }, [wantsPing, pingHost, refreshMs]);

  // Running AI CLI agents poll (less frequent — it walks the process list).
  useEffect(() => {
    if (!wantsAgents) {
      setAgents([]);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void ipc
        .agentsSample()
        .then((a) => !cancelled && setAgents(a))
        .catch(() => {});
    };
    // Walking the full process list is the most expensive sample — keep it away
    // from the startup paint by deferring the first tick, then hand off to the
    // shared scheduler (which pauses entirely while hidden).
    let unschedule = () => {};
    const first = setTimeout(() => {
      unschedule = schedulePoll(poll, Math.max(refreshMs * 2, 4000));
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(first);
      unschedule();
    };
  }, [wantsAgents, refreshMs]);

  // Clock tick (only when the segment is on).
  const wantsClock = sb?.show_clock ?? false;
  useEffect(() => {
    if (!wantsClock) return;
    return schedulePoll(() => setClock(new Date()), 15000);
  }, [wantsClock]);

  // Open-tasks counter.
  const wantsTasks = sb?.show_tasks ?? false;
  useEffect(() => {
    if (!wantsTasks || !project) {
      setTasks(null);
      return;
    }
    let cancelled = false;
    const poll = () =>
      void ipc
        .taskList(project.id)
        .then((t) => !cancelled && setTasks(t))
        .catch(() => {});
    const unschedule = schedulePoll(poll, 15000);
    return () => {
      cancelled = true;
      unschedule();
    };
  }, [wantsTasks, project]);

  /** Quick git actions straight from the status bar. */
  const gitMenu = (e: React.MouseEvent) => {
    if (!project || !git?.branch) return;
    e.preventDefault();
    e.stopPropagation();
    const run = (label: string, fn: (root: string) => Promise<unknown>) => {
      void (async () => {
        try {
          const root = (await ipc.gitDiscoverRoot(project.path).catch(() => null)) ?? project.path;
          await fn(root);
          toast(`${label} — ${t("done")}`, "success");
        } catch (err) {
          toast(`${label} — ${t("failed:")} ${errorMessage(err)}`, "error");
        }
      })();
    };
    openContextMenu(e, [
      { label: t("Open Git explorer"), icon: GitBranch, onClick: () => openPanel("git") },
      { separator: true },
      { label: "Fetch", onClick: () => run("Fetch", (r) => ipc.gitFetch(r)) },
      { label: "Pull", onClick: () => run("Pull", (r) => ipc.gitPull(r)) },
      { label: "Push", onClick: () => run("Push", (r) => ipc.gitPush(r)) },
    ]);
  };

  const toggleSegment = (id: string) => {
    if (!config || !sb) return;
    const key = SEGMENT_TOGGLES[id];
    if (!key) return;
    void saveConfig({ ...config, status_bar: { ...sb, [key]: !sb[key] } });
  };

  const barMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, [
      ...Object.keys(SEGMENT_TOGGLES).map((id) => ({
        label: segmentLabel(id),
        icon: sb?.[SEGMENT_TOGGLES[id]] ? Check : undefined,
        onClick: () => toggleSegment(id),
      })),
      { separator: true },
      ...STATUS_ALIGN_OPTIONS.map((opt) => ({
        label: t(opt.label),
        icon: align === opt.id ? Check : undefined,
        onClick: () => {
          setAlign(opt.id);
          saveStatusBarAlign(opt.id);
        },
      })),
      { separator: true },
      {
        label: t("Reset segment order"),
        icon: RotateCcw,
        onClick: () => {
          if (config && sb) void saveConfig({ ...config, status_bar: { ...sb, segment_order: [] } });
        },
      },
      {
        label: t("Status bar settings…"),
        icon: SlidersHorizontal,
        onClick: () => setSettingsOpen(true, "statusbar"),
      },
    ]);
  };

  const onSegDrop = (targetId: string) => {
    if (dragSeg && dragSeg !== targetId && config && sb) {
      void saveConfig({
        ...config,
        status_bar: { ...sb, segment_order: moveSegment(sb.segment_order ?? [], dragSeg, targetId) },
      });
    }
    setDragSeg(null);
    setDragOverSeg(null);
  };

  const visible = (id: string): boolean => {
    if (!sb) return true;
    const key = SEGMENT_TOGGLES[id] as keyof StatusBarConfig | undefined;
    return key ? Boolean(sb[key]) : true;
  };

  const renderSegment = (id: string): React.ReactNode => {
    switch (id) {
      case "project":
        return project ? (
          <span className="truncate" title={project.path || t("Blank workspace")}>
            {project.name}
          </span>
        ) : (
          <span>{t("no project")}</span>
        );
      case "git": {
        if (!git?.branch) return null;
        const staged = git.entries.filter((en) => en.staged).length;
        const unstaged = git.entries.length - staged;
        return (
          <button
            className="flex items-center gap-1 hover:text-strong"
            onClick={() => openPanel("git")}
            onContextMenu={gitMenu}
            title={`Branch ${git.branch} · ${staged} staged, ${unstaged} unstaged · ↑${git.ahead} ahead ↓${git.behind} behind
Click: Git explorer · right-click: fetch / pull / push`}
          >
            <GitBranch size={11} />
            {git.branch}
            {git.ahead > 0 && ` ↑${git.ahead}`}
            {git.behind > 0 && ` ↓${git.behind}`}
            {staged > 0 && <span className="text-success">●{staged}</span>}
            {unstaged > 0 && <span className="text-warning">●{unstaged}</span>}
          </button>
        );
      }
      case "cpu":
        return stats ? (
          <span className="flex items-center gap-1" title={t("CPU usage")}>
            <Cpu size={11} />
            {stats.cpu_percent.toFixed(0)}%
          </span>
        ) : null;
      case "ram":
        return stats ? (
          <span className="flex items-center gap-1" title={t("Memory used / total")}>
            <MemoryStick size={11} />
            {fmtGb(stats.mem_used)}/{fmtGb(stats.mem_total)}
          </span>
        ) : null;
      case "net":
        return stats ? (
          <span className="flex items-center gap-1" title={t("Network ↓ down ↑ up")}>
            <ArrowDownUp size={11} />↓{fmtRate(stats.net_rx_bps)} ↑{fmtRate(stats.net_tx_bps)}
          </span>
        ) : null;
      case "ping":
        return (
          <span className="flex items-center gap-1" title={`${t("TCP ping to")} ${pingHost}`}>
            <Activity size={11} />
            {ping === null ? "–" : `${ping}ms`}
          </span>
        );
      case "agents": {
        if (agents.length === 0) return null;
        const total = agents.reduce((n, a) => n + a.count, 0);
        const cpu = agents.reduce((n, a) => n + a.cpu_percent, 0);
        const mem = agents.reduce((n, a) => n + a.mem_bytes, 0);
        const detail = agents
          .map((a) => `${a.label} ×${a.count} — CPU ${a.cpu_percent.toFixed(0)}% · ${fmtMem(a.mem_bytes)}`)
          .join("\n");
        return (
          <button
            data-testid="status-agents"
            className="flex items-center gap-1 hover:text-strong"
            title={`${t("Running AI agents:")}\n${detail}\n\n${t("Click to open the Agents panel")}`}
            onClick={() => openPanel("agents")}
          >
            <Bot size={11} />
            {total === 1 ? agents[0].label : `${total} agents`} · {fmtCpu(cpu)} ·{" "}
            {fmtMem(mem)}
          </button>
        );
      }
      case "tasks": {
        if (!tasks) return null;
        const open = tasks.filter((t) => t.status !== "done").length;
        return (
          <button
            className="flex items-center gap-1 hover:text-strong"
            onClick={() => openPanel("tasks")}
            title={`${open} open task${open === 1 ? "" : "s"} — click to open the Tasks board`}
          >
            <CircleDot size={11} />
            {open}
          </button>
        );
      }
      case "timer": {
        // Only present while a focus session is running; click to pause/resume.
        if (!focusRunning) return null;
        return (
          <button
            data-testid="status-timer"
            className="flex items-center gap-1 tabular-nums hover:text-strong"
            onClick={focusToggle}
            title={t("Focus timer — click to pause/resume")}
          >
            <TimerIcon size={11} />
            {fmtClock(focusLeft)}
          </button>
        );
      }
      case "clock":
        return (
          <span className="flex items-center gap-1" title={clock.toLocaleString()}>
            <Clock size={11} />
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        );
      case "zoom": {
        const z = config?.ui.zoom ?? 1;
        if (Math.abs(z - 1) < 0.001) return null;
        return (
          <button
            className="flex items-center gap-1 hover:text-strong"
            onClick={() => setZoom(1)}
            title={t("UI zoom — click to reset to 100%")}
          >
            <ZoomIn size={11} />
            {Math.round(z * 100)}%
          </button>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div
      className="lx-anim-statusbar relative flex h-6 shrink-0 items-center border-t border-edge bg-[var(--lx-glass-bg)] px-3 text-xs text-muted" style={{ backdropFilter: "blur(var(--lx-glass-blur))", WebkitBackdropFilter: "blur(var(--lx-glass-blur))" }}
      onContextMenu={barMenu}
      data-testid="statusbar"
      title={t("Right-click to customize the status bar (segments, order, alignment)")}
    >
      <div
        className="absolute inset-y-0 left-3 right-3 flex min-w-0 items-center gap-3 overflow-hidden"
        style={{ justifyContent: alignToJustify(align) }}
      >
      {order.map((id) => {
        if (id === SPACER_ID) {
          // The spacer only splits the bar into left/right groups in "spread"
          // mode; for explicit left/center/right alignment it collapses so the
          // whole cluster can hug the chosen edge.
          if (align !== "spread") return null;
          return (
            <span
              key={id}
              className="ml-auto"
              onDragOver={(e) => {
                if (!dragSeg) return;
                e.preventDefault();
                setDragOverSeg(id);
              }}
              onDrop={() => onSegDrop(id)}
            />
          );
        }
        if (!visible(id)) return null;
        const content = renderSegment(id);
        if (content === null) return null;
        return (
          <span
            key={id}
            draggable
            data-segment={id}
            onDragStart={(e) => {
              setDragSeg(id);
              setDragGhost(e, segmentLabel(id));
            }}
            onDragEnd={() => {
              setDragSeg(null);
              setDragOverSeg(null);
            }}
            onDragOver={(e) => {
              if (!dragSeg) return;
              e.preventDefault();
              setDragOverSeg(id);
            }}
            onDrop={() => onSegDrop(id)}
            className={`flex min-w-0 cursor-default items-center transition-colors var(--lx-dur-fast) var(--lx-ease) ${
              dragOverSeg === id && dragSeg && dragSeg !== id
                ? "shadow-[inset_2px_0_0_0_var(--lx-muted)]"
                : ""
            }`}
            data-pulse={pulseKey}
          >
            {content}
          </span>
        );
      })}
      </div>
      <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 bg-bar pl-1">
        <button
          className="shrink-0 rounded px-1 text-[11px] tabular-nums text-muted hover:bg-raised hover:text-strong"
          title={t("About Luxor — click for version & updates")}
          onClick={() => setSettingsOpen(true, "about")}
        >
          v{APP_VERSION}
        </button>
        <button
          className={`shrink-0 rounded p-0.5 hover:bg-raised hover:text-strong ${
            config?.ui.right_panel_enabled ? "text-strong" : "text-muted"
          }`}
          title={t("Toggle right panel")}
          onClick={() =>
            config && void saveConfig({ ...config, ui: { ...config.ui, right_panel_enabled: !config.ui.right_panel_enabled } })
          }
        >
          <PanelRight size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Memoized: mounted statically at the app root and prop-less, so it should only
 * re-render from its own store subscriptions and interval-driven local state,
 * not from unrelated root re-renders.
 */
export const StatusBar = memo(StatusBarImpl);
