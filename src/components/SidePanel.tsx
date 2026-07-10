/** Optional left side panel (Settings → Interface) with small configurable
 *  widgets: project info, git summary, recent projects and open tasks. */

import {
  CheckSquare,
  FolderGit2,
  GitBranch,
  History,
  Info,
  PanelLeft,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";

import * as ipc from "@/lib/ipc";
import type { RecentProject, RepoStatus, Task } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { t } from "@/lib/i18n";
import { schedulePoll } from "@/lib/poll";
import { useActiveProject, useProjectsStore } from "@/state/projectsStore";

export const SIDE_PANEL_WIDGETS: { id: string; label: string }[] = [
  { id: "project", label: "Project info" }, // labels translated via t() at render
  { id: "git", label: "Git summary" },
  { id: "tasks", label: "Open tasks" },
  { id: "recents", label: "Recent projects" },
];

export const DEFAULT_SIDE_WIDGETS = ["project", "git", "tasks"];

const WIDGET_ICONS: Record<string, LucideIcon> = {
  project: Info,
  git: GitBranch,
  tasks: CheckSquare,
  recents: History,
};

/** Which dock panel each collapsed-rail widget icon opens — used to highlight
 *  the icon whose panel is currently active (matches the NavRail behaviour). */
const WIDGET_PANEL: Record<string, string> = {
  project: "files",
  git: "git",
  tasks: "tasks",
  recents: "files",
};

function Widget({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <section className="lx-card m-2 p-2.5" style={{ borderRadius: "var(--lx-radius-lg)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-raised text-muted">
          <Icon size={12} />
        </span>
        <span className="truncate">{title}</span>
      </div>
      {children}
    </section>
  );
}

function SidePanelImpl() {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const project = useActiveProject();
  const addProjectPath = useProjectsStore((s) => s.addProjectPath);
  const openPanel = useDockStore((s) => s.openPanel);
  // Active panel kind, so the collapsed rail can highlight the matching icon.
  const activePanelId = useDockStore((s) => {
    const id = s.apis[s.activeKey]?.activePanel?.id;
    return id && id.startsWith("panel-") ? id.replace("panel-", "") : null;
  });
  const [git, setGit] = useState<RepoStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recents, setRecents] = useState<RecentProject[]>([]);

  const enabled = config?.ui.side_panel_enabled ?? false;
  const collapsed = config?.ui.left_sidebar_collapsed ?? false;
  const widgets = config?.ui.side_panel_widgets?.length
    ? config.ui.side_panel_widgets
    : DEFAULT_SIDE_WIDGETS;
  const width = Math.min(480, Math.max(180, config?.ui.side_panel_width ?? 260));
  const railWidth = 44;
  const iconPosition = config?.ui.left_sidebar_icon_position ?? "top";
  const iconRailJustify =
    iconPosition === "middle" ? "justify-center" : iconPosition === "bottom" ? "justify-end" : "justify-start";

  // Smooth open/close (mirrors RightPanel): mount at width 0, animate to full
  // on the next frame; on close collapse to 0 and unmount after the transition.
  // Smooth open/close + collapse: mount, then animate width on the next frame.
  // Collapsing keeps icons visible (width animates full -> rail, never to 0).
  const [render, setRender] = useState(enabled);
  const [shown, setShown] = useState(enabled);
  useEffect(() => {
    if (enabled) {
      setRender(true);
      // Double rAF: frame 1 mounts at width 0, frame 2 flips `shown` so the
      // browser has a committed start frame to animate FROM (no jerky open).
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

  // Git summary poll.
  useEffect(() => {
    if (!enabled || collapsed || !widgets.includes("git") || !project || project.path === "") {
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
    // Defer off the open frame, then poll every 8 s via the shared scheduler
    // (paused entirely while the window is hidden).
    let unschedule = () => {};
    const first = setTimeout(() => {
      unschedule = schedulePoll(() => void poll(), 8000);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(first);
      unschedule();
    };
  }, [enabled, collapsed, widgets, project]);

  // Tasks poll.
  useEffect(() => {
    if (!enabled || !widgets.includes("tasks") || !project) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void ipc
        .taskList(project.id)
        .then((t) => !cancelled && setTasks(t))
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
  }, [enabled, widgets, project]);

  // Recents (load once per open).
  useEffect(() => {
    if (!enabled || collapsed || !widgets.includes("recents")) return;
    ipc.recentList(8).then(setRecents, () => {});
  }, [enabled, collapsed, widgets]);

  if (!enabled && !render) return null;

  // shown=false (closing) → 0; collapsed → rail width (icons stay visible).
  const targetWidth = shown ? (collapsed ? railWidth : width) : 0;
  const openTasks = tasks.filter((t) => t.status !== "done");

  return (
    <div
      className="lx-anim-side-panel shrink-0 overflow-hidden border-r border-edge bg-bar"
      style={{ width: targetWidth }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "width" && !enabled) setRender(false);
      }}
      data-testid="side-panel"
    >
      <div
        className={`flex h-full flex-col overflow-y-auto text-xs transition-opacity duration-150 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        style={{ width: collapsed ? railWidth : width }}
      >
      {collapsed ? (
        <div className={`lx-nav-rail flex h-full flex-col items-center gap-1 p-1.5 ${iconRailJustify}`}>
          <button
            className="lx-square-btn flex h-8 w-8 items-center justify-center text-muted hover:text-strong"
            title={t("Expand left sidebar")}
            onClick={() => config && void saveConfig({ ...config, ui: { ...config.ui, left_sidebar_collapsed: false } })}
          >
            <PanelLeft size={15} />
          </button>
          {/* Divider separating the expand toggle from the widget icons. */}
          <div aria-hidden className="my-1 h-px w-5 shrink-0 rounded bg-edge/70" />
          {widgets.map((id) => {
            const Icon = WIDGET_ICONS[id] ?? Info;
            const meta = SIDE_PANEL_WIDGETS.find((w) => w.id === id);
            const badge = id === "tasks" && openTasks.length > 0 ? String(Math.min(openTasks.length, 99)) : null;
            const isActive = activePanelId !== null && WIDGET_PANEL[id] === activePanelId;
            const onClick = () => {
              if (id === "git") openPanel("git");
              else if (id === "tasks") openPanel("tasks");
              else if (id === "project") openPanel("files");
              else if (id === "recents") openPanel("files");
            };
            return (
              <button
                key={id}
                className={`lx-square-btn relative flex h-8 w-8 items-center justify-center text-muted hover:text-strong ${isActive ? "is-active text-strong" : ""}`}
                title={t(meta?.label ?? id)}
                aria-current={isActive ? "true" : undefined}
                onClick={onClick}
                onDoubleClick={() => config && void saveConfig({ ...config, ui: { ...config.ui, left_sidebar_collapsed: false } })}
              >
                <Icon size={15} />
                {badge && (
                  <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--lx-accent)] px-1 text-[9px] font-bold leading-none text-black/85 ring-1 ring-[var(--lx-bar)]">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
      <>
      {widgets.includes("project") && (
        <Widget title={t("Project")} icon={Info}>
          {project ? (
            <>
              <div className="mb-0.5 flex items-center gap-1.5 text-sm font-medium text-strong">
                {project.icon ? (
                  <span>{project.icon}</span>
                ) : (
                  <FolderGit2 size={13} className="opacity-60" />
                )}
                <span className="truncate">{project.name}</span>
              </div>
              {project.path ? (
                <div className="break-all text-muted" title={project.path}>
                  {project.path}
                  {!project.path_exists && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-warning">
                      <TriangleAlert size={10} /> missing
                    </span>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-edge px-2 py-2 text-muted">{t("Blank workspace")}</div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-edge px-2 py-2 text-muted">{t("No project open.")}</div>
          )}
        </Widget>
      )}

      {widgets.includes("git") && git?.branch && (
        <Widget title={t("Git")} icon={GitBranch}>
          <button className="text-left hover:text-strong" onClick={() => openPanel("git")}>
            <div className="text-strong">{git.branch}</div>
            <div className="text-muted">
              ↑{git.ahead} ↓{git.behind} · {git.entries.length} change
              {git.entries.length === 1 ? "" : "s"}
            </div>
          </button>
        </Widget>
      )}

      {widgets.includes("tasks") && project && (
        <Widget title={`${t("Tasks")} (${openTasks.length})`} icon={CheckSquare}>
          {openTasks.slice(0, 6).map((t) => (
            <button
              key={t.id}
              className="block w-full truncate rounded px-1 py-0.5 text-left text-strong hover:bg-raised"
              onClick={() => openPanel("tasks")}
              title={t.title}
            >
              • {t.title}
            </button>
          ))}
          {openTasks.length === 0 && (
            <div className="rounded-lg border border-dashed border-edge px-2 py-2 text-muted">{t("No open tasks.")}</div>
          )}
        </Widget>
      )}

      {widgets.includes("recents") && (
        <Widget title={t("Recent projects")} icon={History}>
          {recents.slice(0, 8).map((r) => (
            <button
              key={r.path}
              className="block w-full truncate rounded px-1 py-0.5 text-left text-strong hover:bg-raised"
              title={r.path}
              onClick={() => void addProjectPath(r.path)}
            >
              {r.name}
            </button>
          ))}
          {recents.length === 0 && (
            <div className="rounded-lg border border-dashed border-edge px-2 py-2 text-muted">No recent projects yet.</div>
          )}
        </Widget>
      )}
      </>
      )}
      </div>
    </div>
  );
}

/** Memoized: no props, so parent (App) re-renders never cascade here — the
 *  panel only re-renders from its own store subscriptions and polls. */
export const SidePanel = memo(SidePanelImpl);
