import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview";
import {
  BarChart3,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquare,
  X,
  Bot,
  CheckSquare,
  Container,
  Database,
  FileCode,
  FileText,
  FolderGit2,
  FolderTree,
  GitBranch,
  GitCompare,
  Globe,
  GraduationCap,
  History,
  Image as ImageIcon,
  type LucideIcon,
  Rocket,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Wrench,
} from "lucide-react";

/** Favicon-style icon for a panel tab, keyed by its dockview component id. */
const TAB_ICONS: Record<string, LucideIcon> = {
  welcome: Sparkles,
  files: FolderTree,
  git: GitBranch,
  github: FolderGit2,
  diff: GitCompare,
  tasks: CheckSquare,
  skills: GraduationCap,
  launcher: Rocket,
  agents: Bot,
  search: Search,
  snippets: StickyNote,
  http: Send,
  docker: Container,
  devtools: Wrench,
  activity: History,
  analytics: BarChart3,
  web: Globe,
  terminal: TerminalSquare,
  editor: FileText,
  image: ImageIcon,
  db: Database,
  pdf: FileText,
  html: FileCode,
};

function tabIcon(component: string | undefined): LucideIcon {
  return (component && TAB_ICONS[component]) || FileText;
}
import React, { useEffect, useRef, useState } from "react";

import { isLightTheme } from "@/lib/themes";
import { useAppStore } from "@/state/appStore";
import { openContextMenu, useUiStore, type MenuItem } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";

import { FilesPanel } from "@/panels/FilesPanel";
import { LauncherPanel } from "@/panels/LauncherPanel";
import { WelcomePanel } from "@/panels/WelcomePanel";
import { EmptyDock } from "@/panels/EmptyDock";
// Lightweight, frequently-first panels stay eager: their cost is just their own
// source (a few KB each) and eager loading avoids a code-split chunk fetch on a
// hot path. Heavy panels — anything that drags in a big third-party runtime or
// a lot of source — are lazy-loaded below so they never sit on the startup
// critical path. (Dynamic import() chunks were once observed rendering as blank
// tabs in some Tauri webviews; the Suspense + PanelBoundary wrapping used here
// is the same pattern the editor/diff panels have shipped on reliably.)
import { lazy, Suspense } from "react";
import { t } from "@/lib/i18n";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";

// Lazy editor and diff: these are the only panels that pull in the ~770 KB
// CodeMirror runtime. CodeMirror's first paint dominates startup today — see
// the `index.html` modulepreload for the cm chunk. Wrapping the panel factory
// in `lazy` keeps that chunk off the critical path; the cm bundle is fetched
// the moment the user actually opens a file or a diff.
const EditorPanel = lazy(() =>
  import("@/panels/EditorPanel").then((m) => ({ default: m.EditorPanel })),
);
const DiffPanel = lazy(() =>
  import("@/panels/DiffPanel").then((m) => ({ default: m.DiffPanel })),
);
// Heavy / not-immediately-needed panels. The terminal alone drags in the whole
// xterm runtime (~250 KB) plus three addons; keeping it eager forced all of
// that into the startup graph even when no terminal was ever opened. These are
// fetched the moment the user opens the corresponding tab.
const TerminalPanel = lazy(() =>
  import("@/panels/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);
const TasksPanel = lazy(() =>
  import("@/panels/TasksPanel").then((m) => ({ default: m.TasksPanel })),
);
// GitPanel is ~850 lines of source plus the `virtua` virtual-list runtime; it
// used to be eager, sitting in the entry chunk on every startup even when the
// Git tab was never opened. Same proven Suspense pattern as the other panels.
const GitPanel = lazy(() =>
  import("@/panels/GitPanel").then((m) => ({ default: m.GitPanel })),
);
const SkillsPanel = lazy(() =>
  import("@/panels/SkillsPanel").then((m) => ({ default: m.SkillsPanel })),
);
const ActivityPanel = lazy(() =>
  import("@/panels/ActivityPanel").then((m) => ({ default: m.ActivityPanel })),
);
const AnalyticsPanel = lazy(() =>
  import("@/panels/AnalyticsPanel").then((m) => ({ default: m.AnalyticsPanel })),
);
const SearchPanel = lazy(() =>
  import("@/panels/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);
const SnippetsPanel = lazy(() =>
  import("@/panels/SnippetsPanel").then((m) => ({ default: m.SnippetsPanel })),
);
const DbPanel = lazy(() =>
  import("@/panels/DbPanel").then((m) => ({ default: m.DbPanel })),
);
const DevToolsPanel = lazy(() =>
  import("@/panels/DevToolsPanel").then((m) => ({ default: m.DevToolsPanel })),
);
const BrowserPanel = lazy(() =>
  import("@/panels/BrowserPanel").then((m) => ({ default: m.BrowserPanel })),
);
const DockerPanel = lazy(() =>
  import("@/panels/DockerPanel").then((m) => ({ default: m.DockerPanel })),
);
const HttpPanel = lazy(() =>
  import("@/panels/HttpPanel").then((m) => ({ default: m.HttpPanel })),
);
const GithubPanel = lazy(() =>
  import("@/panels/GithubPanel").then((m) => ({ default: m.GithubPanel })),
);
const AgentsPanel = lazy(() =>
  import("@/panels/AgentsPanel").then((m) => ({ default: m.AgentsPanel })),
);
const ImagePanel = lazy(() =>
  import("@/panels/ImagePanel").then((m) => ({ default: m.ImagePanel })),
);
const PdfPanel = lazy(() =>
  import("@/panels/PdfPanel").then((m) => ({ default: m.PdfPanel })),
);
function lazyPanel<T extends React.ComponentType<IDockviewPanelProps>>(
  loader: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await loader();
    } catch (firstError) {
      // Tauri webviews can occasionally race a dynamic panel chunk request while
      // a newly-opened local HTML preview is taking focus. Retry once so DockView
      // never receives a half-loaded/undefined panel component.
      await new Promise((resolve) => setTimeout(resolve, 75));
      try {
        return await loader();
      } catch {
        throw firstError;
      }
    }
  });
}

const HtmlPreviewPanel = lazyPanel(() =>
  import("@/panels/HtmlPreviewPanel").then((m) => ({ default: m.HtmlPreviewPanel })),
);

/** Last line of defense: a crashing panel must show an error, never a silent
 *  blank tab (debugging blanks remotely is miserable). */
class PanelBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void import("@/lib/ipc").then(({ frontendLog }) =>
      frontendLog(`PANEL_CRASH ${String(error)} ${info.componentStack ?? ""}`.slice(0, 1000)),
    );
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface p-4 text-center">
          <div className="text-sm text-strong">{t("panel.crashed", "This panel crashed")}</div>
          <div className="max-w-full overflow-auto rounded bg-raised px-2 py-1 font-mono text-xs text-muted">
            {String(this.state.error)}
          </div>
          <button
            className="rounded border border-edge px-3 py-1 text-xs text-muted hover:text-strong"
            onClick={() => this.setState({ error: null })}
          >
            {t("common.retry", "Retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <PanelBoundary>{children}</PanelBoundary>;
}

function PanelFallback() {
  return (
    <div className="lx-panel-skeleton lx-fade-in h-full w-full bg-surface">
      <div className="lx-panel-skeleton-line" style={{ width: "40%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "85%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "70%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "90%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "55%" }} />
    </div>
  );
}
import {
  WELCOME_KEY,
  addTerminalPanel,
  closableFromPanel,
  closePanelGuarded,
  closePanelsGuarded,
  dropDockLayout,
  restoreDockLayout,
  saveDockLayout,
  useDockStore,
} from "./dockStore";

/** Wrap a lazily-loaded panel in Suspense so its chunk can stream in without
 *  blanking the tab (the spinner shows for the one network round-trip). */
function Lazy({ children }: { children: React.ReactNode }) {
  return <Wrap><Suspense fallback={<PanelFallback />}>{children}</Suspense></Wrap>;
}

const components = {
  terminal: (props: IDockviewPanelProps) => <Lazy><TerminalPanel {...props} /></Lazy>,
  git: () => <Lazy><GitPanel /></Lazy>,
  diff: (props: IDockviewPanelProps) => <Lazy><DiffPanel {...props} /></Lazy>,
  launcher: () => <Wrap><LauncherPanel /></Wrap>,
  welcome: (props: IDockviewPanelProps) => <Wrap><WelcomePanel {...props} /></Wrap>,
  files: () => <Wrap><FilesPanel /></Wrap>,
  editor: (props: IDockviewPanelProps) => <Lazy><EditorPanel {...props} /></Lazy>,
  image: (props: IDockviewPanelProps) => <Lazy><ImagePanel {...props} /></Lazy>,
  db: (props: IDockviewPanelProps) => <Lazy><DbPanel {...props} /></Lazy>,
  tasks: () => <Lazy><TasksPanel /></Lazy>,
  skills: () => <Lazy><SkillsPanel /></Lazy>,
  web: () => <Lazy><BrowserPanel /></Lazy>,
  pdf: (props: IDockviewPanelProps) => <Lazy><PdfPanel {...props} /></Lazy>,
  activity: () => <Lazy><ActivityPanel /></Lazy>,
  analytics: () => <Lazy><AnalyticsPanel /></Lazy>,
  agents: () => <Lazy><AgentsPanel /></Lazy>,
  search: () => <Lazy><SearchPanel /></Lazy>,
  snippets: () => <Lazy><SnippetsPanel /></Lazy>,
  http: () => <Lazy><HttpPanel /></Lazy>,
  docker: () => <Lazy><DockerPanel /></Lazy>,
  github: () => <Lazy><GithubPanel /></Lazy>,
  devtools: () => <Lazy><DevToolsPanel /></Lazy>,
  html: (props: IDockviewPanelProps) => <Lazy><HtmlPreviewPanel {...props} /></Lazy>,
};

/** Custom dock tab: middle-click close + custom context menu with split actions. */
function DockTab(props: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(props.api.title ?? props.api.id);
  useEffect(() => {
    const d = props.api.onDidTitleChange?.((e: { title: string }) => setTitle(e.title));
    return () => d?.dispose?.();
  }, [props.api]);

  const close = () => {
    const panel = props.containerApi.getPanel(props.api.id);
    void closePanelGuarded(
      panel
        ? closableFromPanel(panel)
        : { id: props.api.id, title: props.api.title, close: () => props.api.close() },
    );
  };

  const moveToSplit = (direction: "right" | "below") => {
    try {
      const panel = props.containerApi.getPanel(props.api.id);
      if (!panel) return;
      const group = props.containerApi.addGroup({ referencePanel: panel, direction });
      panel.api.moveTo({ group });
    } catch (err) {
      console.warn("move to split failed", err);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    openContextMenu(e, [
      {
        label: t("Split right (new terminal)"),
        icon: SquareSplitHorizontal,
        onClick: () =>
          addTerminalPanel(props.containerApi, {}, { referencePanel: props.api.id, direction: "right" }),
      },
      {
        label: t("Split down (new terminal)"),
        icon: SquareSplitVertical,
        onClick: () =>
          addTerminalPanel(props.containerApi, {}, { referencePanel: props.api.id, direction: "below" }),
      },
      { label: t("Move panel to split right"), icon: SquareSplitHorizontal, onClick: () => moveToSplit("right") },
      { label: t("Move panel to split down"), icon: SquareSplitVertical, onClick: () => moveToSplit("below") },
      { separator: true },
      {
        label: t("Float panel"),
        icon: ExternalLink,
        onClick: () => {
          try {
            const panel = props.containerApi.getPanel(props.api.id);
            if (panel) {
              props.containerApi.addFloatingGroup(panel, {
                position: { left: 80, top: 60 },
                width: 560,
                height: 380,
              });
            }
          } catch (err) {
            console.warn("float failed", err);
          }
        },
      },
      {
        label: t("Rename tab…"),
        icon: Pencil,
        onClick: () => {
          void useUiStore
            .getState()
            .prompt({ title: t("Tab title"), initial: props.api.title ?? "" })
            .then((name) => {
              if (name?.trim()) props.api.setTitle(name.trim());
            });
        },
      },
      { separator: true },
      { label: t("tab.close", "Close"), icon: X, hint: "middle-click", onClick: close },
      {
        label: t("tab.close.others", "Close others"),
        icon: Copy,
        onClick: () =>
          void closePanelsGuarded(
            [...props.containerApi.panels]
              .filter((p) => p.id !== props.api.id)
              .map((p) => closableFromPanel(p)),
          ),
      },
      {
        label: t("tab.close.right", "Close tabs to the right"),
        icon: Copy,
        onClick: () => {
          try {
            const group = props.api.group;
            const panels = [...group.panels];
            const idx = panels.findIndex((p) => p.id === props.api.id);
            if (idx >= 0)
              void closePanelsGuarded(
                panels.slice(idx + 1).map((p) => closableFromPanel(p)),
              );
          } catch (err) {
            console.warn("close right failed", err);
          }
        },
      },
      {
        label: t("tab.close.all", "Close all"),
        icon: Copy,
        onClick: () =>
          void closePanelsGuarded(
            [...props.containerApi.panels].map((p) => closableFromPanel(p)),
          ),
      },
    ]);
  };

  const Icon = tabIcon(props.api.component);

  return (
    <div
      className="flex h-full w-full items-center gap-2 px-2.5 text-xs"
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
      onContextMenu={onContextMenu}
    >
      <Icon size={13} className="shrink-0 opacity-60 transition-opacity [.dv-active-tab_&]:opacity-95" />
      <span className="min-w-0 flex-1 truncate [.dv-active-tab_&]:font-medium">{title}</span>
      <button
        className="shrink-0 rounded-full p-1 opacity-55 transition-[opacity,background-color] hover:bg-edge hover:opacity-100 [.dv-active-tab_&]:opacity-75 [.dv-active-tab_&]:hover:opacity-100"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        aria-label={t("Close panel")}
        title={t("Close panel")}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Menu listing every panel kind — used by the tab-strip "+" button (RMB)
 *  and by right-clicking the empty area of a tab strip. */
function panelsMenuItems(
  containerApi: IDockviewHeaderActionsProps["containerApi"],
  groupId?: string,
): MenuItem[] {
  const ui = useAppStore.getState().config?.ui;
  const hidden = new Set(ui?.plus_menu_hidden ?? []);
  const items: MenuItem[] = [
    {
      label: t("cmd.terminal.short", "New terminal"),
      icon: TerminalSquare,
      onClick: () =>
        addTerminalPanel(
          containerApi,
          {},
          groupId ? { referenceGroup: groupId, direction: "within" } : undefined,
        ),
    },
    { separator: true },
  ];
  for (const def of PLUS_MENU_PANELS) {
    if (hidden.has(def.kind)) continue;
    if (def.kind === "web" && !(ui?.browser_enabled ?? false)) continue;
    items.push({
      label: t(`panel.${def.kind}`, def.label),
      icon: def.icon,
      onClick: () => {
        // Add the panel to the specific group where the + was clicked,
        // not the global active dock.
        const api = useDockStore.getState().apis[useDockStore.getState().activeKey];
        if (!api) return;
        const existing = api.panels.find((p) => p.id === `panel-${def.kind}`);
        if (existing) {
          existing.api.setActive();
          return;
        }
        api.addPanel({
          id: `panel-${def.kind}`,
          component: def.kind,
          title: t(`panel.${def.kind}`, def.label),
          position: groupId ? { referenceGroup: groupId, direction: "within" } : undefined,
        });
      },
    });
  }
  return items;
}

/** "+" right after the last tab: click (and right-click) open the full panels
 *  menu — "New terminal" is the first item, so the common case is still one
 *  extra click, but every panel is now discoverable instead of hidden behind a
 *  right-click only a power user would try. */
function LeftGroupActions(props: IDockviewHeaderActionsProps) {
  const openPanelsMenu = (e: React.MouseEvent) =>
    openContextMenu(e, panelsMenuItems(props.containerApi, props.group.id));
  return (
    <div className="flex h-full shrink-0 items-center px-0.5 text-muted" data-testid="group-add">
      <button
        className="flex h-full items-center rounded px-1 text-[--lx-muted] opacity-70 hover:bg-raised hover:opacity-100"
        title={t("dock.add_panel", "New terminal or panel…")}
        aria-label={t("dock.add_panel", "New terminal or panel…")}
        onClick={openPanelsMenu}
        onContextMenu={openPanelsMenu}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

/** Per-group header buttons: explicit split actions. */
function GroupActions(props: IDockviewHeaderActionsProps) {
  const btn =
    "flex h-full items-center rounded px-1 text-[--lx-muted] opacity-70 hover:bg-raised hover:opacity-100";
  return (
    <div className="flex h-full shrink-0 items-center gap-0.5 px-1 text-muted" data-testid="group-actions">
      <button
        className={btn}
        title={t("Split right with a new terminal")}
        onClick={() =>
          addTerminalPanel(props.containerApi, {}, { referenceGroup: props.group.id, direction: "right" })
        }
      >
        <SquareSplitHorizontal size={14} />
      </button>
      <button
        className={btn}
        title={t("Split down with a new terminal")}
        onClick={() =>
          addTerminalPanel(props.containerApi, {}, { referenceGroup: props.group.id, direction: "below" })
        }
      >
        <SquareSplitVertical size={14} />
      </button>
    </div>
  );
}

const tabComponents = { default: DockTab };

/** One persistent dockview per visited project; inactive docks stay mounted
 *  (hidden via `visibility`) so terminals never reload when switching tabs. */
function ProjectDock({ dockKey, active }: { dockKey: string; active: boolean }) {
  const theme = useAppStore((s) => s.config?.theme ?? "dark");
  const registerApi = useDockStore((s) => s.registerApi);
  const unregisterApi = useDockStore((s) => s.unregisterApi);
  const cwd = useProjectsStore((s) => {
    const p = s.projects.find((x) => x.id === dockKey);
    return p && p.path !== "" ? p.path : null;
  });
  // A folder-less ("Blank") workspace: seed the Welcome launcher instead of a
  // bare terminal so the user gets a deliberate menu.
  const isBlank = useProjectsStore((s) => {
    const p = s.projects.find((x) => x.id === dockKey);
    return Boolean(p) && p?.path === "";
  });
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const isBlankRef = useRef(isBlank);
  isBlankRef.current = isBlank;
  const cleanupRef = useRef<(() => void) | null>(null);
  // Guards against ready/unmount races when projects are switched or removed
  // quickly (the dockview may finish initializing after the dock is gone).
  const disposedRef = useRef(false);
  // True when every panel in this dock has been closed → show the empty state
  // overlay instead of a blank void.
  const [empty, setEmpty] = useState(false);

  const onReady = (event: DockviewReadyEvent) => {
    // Note: never early-return here. Under React StrictMode the dockview is
    // recreated and its onReady fires *before* this component's effect re-runs,
    // so a disposedRef guard here would leave the dock permanently empty.
    disposedRef.current = false;
    registerApi(dockKey, event.api);
    restoreDockLayout(dockKey, event.api, cwdRef.current, isBlankRef.current);
    setEmpty(event.api.panels.length === 0);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disposable = event.api.onDidLayoutChange(() => {
      setEmpty(event.api.panels.length === 0);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposedRef.current) saveDockLayout(dockKey, event.api);
      }, 400);
    });
    cleanupRef.current = () => {
      if (timer) clearTimeout(timer);
      disposable.dispose();
      saveDockLayout(dockKey, event.api);
    };
  };

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      unregisterApi(dockKey);
    };
  }, [dockKey, unregisterApi]);

  return (
    // Inactive docks are hidden via opacity + pointer-events instead of
    // `visibility`: dockview re-applies `visibility: visible` on its inner
    // nodes, which made stale docks overlay the active one and the UI looked
    // frozen when switching project tabs. Opacity cannot be overridden by
    // children, and z-index keeps the active dock on top for hit-testing.
    <div
      className={`absolute inset-0 bg-surface ${active ? "z-10" : "pointer-events-none z-0 opacity-0"}`}
      aria-hidden={!active}
      data-testid={`dock-${dockKey}`}
      onDragOver={(e) => {
        // Accept files dragged from the file explorer (custom mime only, so
        // dockview's own tab drag&drop is left untouched).
        if (e.dataTransfer.types.includes("application/x-luxor-file")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const path = e.dataTransfer.getData("application/x-luxor-file");
        if (path) {
          e.preventDefault();
          useDockStore.getState().openFile(path);
        }
      }}
      onContextMenu={(e) => {
        // Right-click on the empty part of a tab strip → panels menu.
        const target = e.target as HTMLElement;
        if (!target.closest(".dv-void-container")) return;
        const api = useDockStore.getState().apis[dockKey];
        if (api) openContextMenu(e, panelsMenuItems(api));
      }}
    >
      <DockviewReact
        components={components}
        defaultTabComponent={tabComponents.default}
        leftHeaderActionsComponent={LeftGroupActions}
        rightHeaderActionsComponent={GroupActions}
        onReady={onReady}
        theme={isLightTheme(theme) ? themeLight : themeDark}
        className="lx-anim-panel h-full w-full"
      />
      {empty && (
        <div className="absolute inset-0 z-20 bg-surface">
          <EmptyDock dockKey={dockKey} />
        </div>
      )}
    </div>
  );
}

function DockLayoutImpl() {
  const activeId = useProjectsStore((s) => s.activeId);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const projectIdsKey = useProjectsStore((s) => s.projects.map((p) => p.id).join("\u0000"));
  const setActiveKey = useDockStore((s) => s.setActiveKey);
  const [mounted, setMounted] = useState<string[]>([]);

  // Until projects have loaded we don't yet know the active workspace. Mounting
  // the Welcome dock now and swapping it for the restored project once
  // `activeId` arrives produces a visible "welcome → workspace" flicker, so hold
  // off (render nothing) until load resolves. Only then fall back to Welcome
  // when there genuinely is no active project.
  const key = activeId ?? (projectsLoaded ? WELCOME_KEY : null);

  useEffect(() => {
    if (!key) return;
    setActiveKey(key);
    setMounted((m) => (m.includes(key) ? m : [...m, key]));
  }, [key, setActiveKey]);

  // Drop docks (and their stored layouts) for removed projects. Keyed on the
  // full id list so a same-length remove+add cycle is still detected.
  useEffect(() => {
    const ids = new Set(useProjectsStore.getState().projects.map((p) => p.id));
    setMounted((m) =>
      m.filter((k) => {
        const keep = k === WELCOME_KEY || ids.has(k);
        if (!keep) dropDockLayout(k);
        return keep;
      }),
    );
  }, [projectIdsKey]);

  return (
    <div className="relative h-full w-full bg-surface" data-testid="dock-layout">
      {mounted.map((k) => (
        <ProjectDock key={k} dockKey={k} active={k === key} />
      ))}
    </div>
  );
}

/** Memoized: DockLayout takes no props, so re-renders of App (language bumps,
 *  config toggles, …) never cascade into the entire dock/panel tree — it only
 *  re-renders from its own store subscriptions (active project, project list). */
export const DockLayout = React.memo(DockLayoutImpl);
