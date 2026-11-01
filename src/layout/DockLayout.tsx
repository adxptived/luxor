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
  ChevronDown,
  Copy,
  ExternalLink,
  LocateFixed,
  Maximize2,
  Minimize2,
  Pencil,
  Pin,
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

const FILE_TAB_COMPONENTS = new Set(["editor", "image", "pdf", "db", "html"]);

/** File path shown by a document tab, or null for terminals / tool panels. */
function filePathOf(panel: { params?: Record<string, unknown>; view?: unknown } | null | undefined): string | null {
  if (!panel) return null;
  const component = panelComponent(panel);
  const path = (panel.params as { path?: unknown } | undefined)?.path;
  return component && FILE_TAB_COMPONENTS.has(component) && typeof path === "string" ? path : null;
}
import React, { useEffect, useRef, useState } from "react";

import { isLightTheme } from "@/lib/themes";
import { hintFor } from "@/lib/hotkeys";
import * as ipc from "@/lib/ipc";
import type { DetectedProgram } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { openContextMenu, useUiStore, type MenuItem } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEditorStatus } from "@/state/editorStatusStore";

import { WelcomePanel } from "@/panels/WelcomePanel";
import { EmptyDock } from "@/panels/EmptyDock";
// Lightweight, frequently-first panels stay eager: their cost is just their own
// source (a few KB each) and eager loading avoids a code-split chunk fetch on a
// hot path. Heavy panels — anything that drags in a big third-party runtime or
// a lot of source — are lazy-loaded below so they never sit on the startup
// critical path. (Dynamic import() chunks were once observed rendering as blank
// tabs in some Tauri webviews; the Suspense + PanelErrorBoundary wrapping used here
// is the same pattern the editor/diff panels have shipped on reliably.)
import { lazy, Suspense } from "react";
import { t, useT } from "@/lib/i18n";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";

const FilesPanel = lazy(() =>
  import("@/panels/FilesPanel").then((m) => ({ default: m.FilesPanel })),
);
const LauncherPanel = lazy(() =>
  import("@/panels/LauncherPanel").then((m) => ({ default: m.LauncherPanel })),
);

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

function Wrap({ children }: { children: React.ReactNode }) {
  return <PanelErrorBoundary>{children}</PanelErrorBoundary>;
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
  ensureVisibleContent,
  isPreviewPanel,
  panelComponent,
  restoreDockLayout,
  saveDockLayout,
  toggleMaximizeGroup,
  toggleTerminalPanel,
  useDockStore,
} from "./dockStore";
import { groupRole } from "./workbenchLogic";
import { useWorkbenchStore } from "@/state/workbenchStore";
import { deleteTerminalState, terminalStateId } from "@/lib/terminalState";
import { DockKeyContext } from "./DockKeyContext";
import { forgetDock, rememberGroup } from "./placement";
import { useTerminalStatus } from "@/state/terminalStatus";
import { FileIcon } from "@/components/FileIcon";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";

/** Wrap a lazily-loaded panel in Suspense so its chunk can stream in without
 *  blanking the tab (the spinner shows for the one network round-trip). */
function Lazy({ children }: { children: React.ReactNode }) {
  return <Wrap><Suspense fallback={<PanelFallback />}>{children}</Suspense></Wrap>;
}

const components = {
  terminal: (props: IDockviewPanelProps) => <Lazy><TerminalPanel {...props} /></Lazy>,
  git: () => <Lazy><GitPanel /></Lazy>,
  diff: (props: IDockviewPanelProps) => <Lazy><DiffPanel {...props} /></Lazy>,
  launcher: () => <Lazy><LauncherPanel /></Lazy>,
  welcome: (props: IDockviewPanelProps) => <Wrap><WelcomePanel {...props} /></Wrap>,
  files: () => <Lazy><FilesPanel /></Lazy>,
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
/**
 * 1-based position among the terminal tabs of the same group that carry the
 * same title ("aurora-shop", "aurora-shop" → 1, 2); null when the title is
 * unique. Terminals are named after their folder, so two shells in one project
 * would otherwise be indistinguishable.
 */
function useDuplicateIndex(props: IDockviewPanelHeaderProps): number | null {
  const [index, setIndex] = useState<number | null>(null);
  const isTerminal = props.api.component === "terminal";
  useEffect(() => {
    if (!isTerminal) return;
    let subs: Array<{ dispose(): void }> = [];
    const compute = () => {
      try {
        const group = props.api.group;
        const mine = props.api.title ?? "";
        const same = (group?.panels ?? []).filter(
          (p) => (p.title ?? "") === mine && panelComponent(p) === "terminal",
        );
        setIndex(same.length > 1 ? same.findIndex((p) => p.id === props.api.id) + 1 : null);
      } catch {
        /* group mid-teardown */
      }
    };
    const resubscribe = () => {
      subs.forEach((d) => d.dispose());
      subs = (props.api.group?.panels ?? []).map((p) => p.api.onDidTitleChange(compute));
      compute();
    };
    resubscribe();
    const api = props.containerApi;
    const listeners = [api.onDidAddPanel(resubscribe), api.onDidRemovePanel(resubscribe), api.onDidMovePanel(resubscribe)];
    return () => {
      listeners.forEach((d) => d.dispose());
      subs.forEach((d) => d.dispose());
    };
  }, [isTerminal, props.api, props.containerApi]);
  return index;
}

function DockTab(props: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(props.api.title ?? props.api.id);
  const duplicate = useDuplicateIndex(props);
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

  const filePath = (props.params as { path?: unknown } | undefined)?.path;
  const tabFile = typeof filePath === "string" && /^(editor|image|pdf|db|html)$/.test(props.api.component) ? filePath : null;
  // A preview tab (single click in the explorer) is replaced by the next
  // preview; editing, double-clicking the tab or "Keep open" pins it.
  const preview = isPreviewPanel({ params: props.params as Record<string, unknown> | undefined });
  const pin = () => props.api.updateParameters({ preview: false });

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

  const groupPanels = () => {
    try {
      return [...props.api.group.panels];
    } catch {
      return [];
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const relative = (() => {
      if (!tabFile) return null;
      const root = useProjectsStore.getState().projects.find((p) => p.id === useDockStore.getState().activeKey)?.path;
      if (!root) return null;
      const norm = (p: string) => p.replace(/\\/g, "/");
      const base = norm(root).replace(/\/+$/, "");
      return norm(tabFile).startsWith(`${base}/`) ? norm(tabFile).slice(base.length + 1) : null;
    })();
    const copy = (text: string) =>
      void navigator.clipboard
        ?.writeText(text)
        .then(() => useAppStore.getState().toast(t("Path copied"), "success"))
        .catch(() => useAppStore.getState().toast(t("Copy failed"), "error"));
    // Terminals and tool panels get "split with a new terminal"; documents lead with their
    // file actions (VS Code order) instead of terminal splits.
    const splitNew: MenuItem[] = [
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
    ];
    const fileItems: MenuItem[] = tabFile
      ? [
          ...(preview ? [{ label: t("Keep open"), icon: Pin, hint: t("double-click"), onClick: pin }] : []),
          {
            label: t("Reveal in Explorer"),
            icon: LocateFixed,
            onClick: () => useWorkbenchStore.getState().revealInExplorer(tabFile),
          },
          { label: t("Copy path"), icon: Copy, onClick: () => copy(tabFile) },
          ...(relative ? [{ label: t("Copy relative path"), icon: Copy, onClick: () => copy(relative) }] : []),
          { separator: true },
        ]
      : [];
    openContextMenu(e, [
      ...fileItems,
      ...(!tabFile ? splitNew : []),
      { label: t("Move panel to split right"), icon: SquareSplitHorizontal, onClick: () => moveToSplit("right") },
      { label: t("Move panel to split down"), icon: SquareSplitVertical, onClick: () => moveToSplit("below") },
      ...(!tabFile && preview ? [{ label: t("Keep open"), icon: Pin, hint: t("double-click"), onClick: pin }] : []),
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
              if (!name?.trim()) return;
              props.api.setTitle(name.trim());
              // Terminals retitle themselves from the shell; a name the user
              // chose wins over that.
              props.api.updateParameters({ customTitle: true });
            });
        },
      },
      { separator: true },
      { label: t("tab.close", "Close"), icon: X, hint: "middle-click", onClick: close },
      {
        label: t("tab.close.others", "Close others"),
        icon: Copy,
        onClick: () =>
          // Others in this group only (as in VS Code): "close others" on an
          // editor tab used to close every terminal in the project too.
          void closePanelsGuarded(
            groupPanels()
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
          void closePanelsGuarded(groupPanels().map((p) => closableFromPanel(p))),
      },
    ]);
  };

  const Icon = tabIcon(props.api.component);
  const activity = useTerminalStatus((s) => (props.api.component === "terminal" ? s.byPanel[props.api.id] : undefined));
  const dot =
    activity === "running"
      ? { cls: "bg-accent animate-pulse", label: t("Running") }
      : activity === "failed"
        ? { cls: "bg-danger", label: t("Process exited with an error") }
        : activity === "exited"
          ? { cls: "bg-muted/60", label: t("Process exited") }
          : null;

  return (
    <div
      className="flex h-full w-full items-center gap-2 px-2.5 text-xs"
      data-component={props.api.component}
      data-preview={preview || undefined}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
      onDoubleClick={() => {
        if (preview) pin();
      }}
      onContextMenu={onContextMenu}
    >
      {tabFile ? (
        <FileIcon name={tabFile.split(/[\\/]/).pop() ?? tabFile} isDir={false} size={14} className="shrink-0" />
      ) : (
        <Icon size={13} className="shrink-0 opacity-60 transition-opacity [.dv-active-tab_&]:opacity-95" />
      )}
      <span
        className={`min-w-0 flex-1 truncate [.dv-active-tab_&]:font-medium ${preview ? "italic" : ""}`}
        title={preview ? t("Preview — opening another file replaces this tab. Double-click to keep it open.") : undefined}
      >
        {title}
        {duplicate !== null && (
          <span className="ml-1 tabular-nums text-muted" data-testid="tab-duplicate-index">
            {duplicate}
          </span>
        )}
      </span>
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot.cls}`} title={dot.label} aria-label={dot.label} />}
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

/** Shells found on this machine (first entry = the system default). Fetched
 *  once, in the background, the first time a dock mounts. */
let detectedShells: DetectedProgram[] = [];
let shellsRequested = false;
function prefetchShells(): void {
  if (shellsRequested) return;
  shellsRequested = true;
  void ipc.ptyDetectShells().then(
    (list) => {
      detectedShells = list;
    },
    () => {
      detectedShells = [];
    },
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
  const where = groupId ? { referenceGroup: groupId, direction: "within" as const } : undefined;
  const items: MenuItem[] = [
    {
      label: t("cmd.terminal.short", "New terminal"),
      icon: TerminalSquare,
      hint: hintFor("terminal.new", useAppStore.getState().config),
      onClick: () => addTerminalPanel(containerApi, {}, where),
    },
    // Other shells installed here (PowerShell 7, Git Bash, WSL, zsh, …).
    ...detectedShells.slice(1).map((sh) => ({
      label: sh.label,
      hint: t("shell"),
      icon: TerminalSquare,
      onClick: () => addTerminalPanel(containerApi, { shell: sh.command }, where),
    })),
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

/** Re-render when this dock's maximized group changes. */
function useMaximizedGroup(containerApi: IDockviewHeaderActionsProps["containerApi"]): boolean {
  const [maximized, setMaximized] = useState(() => containerApi.hasMaximizedGroup());
  useEffect(() => {
    const sub = containerApi.onDidMaximizedGroupChange(() => setMaximized(containerApi.hasMaximizedGroup()));
    return () => sub.dispose();
  }, [containerApi]);
  return maximized;
}

/** Per-group header buttons: split with a terminal, maximize, and — on the
 *  terminal panel — hide it (Ctrl+` brings it back). */
function GroupActions(props: IDockviewHeaderActionsProps) {
  const btn =
    "flex h-full items-center rounded px-1 text-[--lx-muted] opacity-70 hover:bg-raised hover:opacity-100";
  const maximized = useMaximizedGroup(props.containerApi);
  const isTerminalGroup = groupRole(props.panels.map((p) => panelComponent(p))) === "terminal";
  const grid = (() => {
    try {
      return props.group.api.location.type === "grid";
    } catch {
      return false;
    }
  })();
  const thisMaximized = maximized && (() => {
    try {
      return props.group.api.isMaximized();
    } catch {
      return false;
    }
  })();
  const canMaximize = grid && (thisMaximized || props.containerApi.groups.length > 1);
  return (
    <div className="flex h-full shrink-0 items-center gap-0.5 px-1 text-muted" data-testid="group-actions">
      <button
        className={btn}
        title={t("Split right with a new terminal")} aria-label={t("Split right with a new terminal")}
        onClick={() =>
          addTerminalPanel(props.containerApi, {}, { referenceGroup: props.group.id, direction: "right" })
        }
      >
        <SquareSplitHorizontal size={14} />
      </button>
      <button
        className={btn}
        title={t("Split down with a new terminal")} aria-label={t("Split down with a new terminal")}
        onClick={() =>
          addTerminalPanel(props.containerApi, {}, { referenceGroup: props.group.id, direction: "below" })
        }
      >
        <SquareSplitVertical size={14} />
      </button>
      {canMaximize && (
        <button
          className={btn}
          data-testid="group-maximize"
          title={thisMaximized ? t("Restore group size") : t("Maximize group (double-click the tab bar)")}
          aria-label={thisMaximized ? t("Restore group size") : t("Maximize group (double-click the tab bar)")}
          aria-pressed={thisMaximized}
          onClick={() => {
            props.group.api.setActive();
            toggleMaximizeGroup(props.group.id);
          }}
        >
          {thisMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      )}
      {isTerminalGroup && grid && (
        <button
          className={btn}
          data-testid="terminal-panel-hide"
          title={t("Hide terminal panel (Ctrl+`)")}
          aria-label={t("Hide terminal panel (Ctrl+`)")}
          onClick={() => {
            // Toggle from a focused terminal group = hide.
            props.group.api.setActive();
            toggleTerminalPanel();
          }}
        >
          <ChevronDown size={14} />
        </button>
      )}
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
    prefetchShells();
    registerApi(dockKey, event.api);
    restoreDockLayout(dockKey, event.api, cwdRef.current, isBlankRef.current);
    setEmpty(event.api.panels.length === 0);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disposable = event.api.onDidLayoutChange(() => {
      setEmpty(event.api.panels.length === 0);
      ensureVisibleContent(event.api);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposedRef.current) saveDockLayout(dockKey, event.api);
      }, 400);
    });
    // A closed terminal's saved scrollback goes with it. (Moving a panel does
    // not fire this; project/dock teardown is handled by the startup prune.)
    const removeSub = event.api.onDidRemovePanel((panel) => {
      deleteTerminalState(terminalStateId(dockKey, panel.id));
      // The explorer highlights the active editor's file; forget a closed one.
      const wb = useWorkbenchStore.getState();
      const removedPath = (panel.params as { path?: unknown } | undefined)?.path;
      if (removedPath && wb.activeFileByDock[dockKey] === removedPath) {
        wb.setActiveFile(dockKey, filePathOf(event.api.activePanel));
      }
      const es = useEditorStatus.getState();
      if (es.activeByDock[dockKey] === panel.id) {
        const next = event.api.activePanel;
        es.setActive(dockKey, next && panelComponent(next) === "editor" ? next.id : null);
      }
    });
    // Remember which group last held a file / terminal so the next "open file"
    // or "new terminal" lands there instead of in whichever group is active.
    const activeSub = event.api.onDidActivePanelChange((panel) => {
      if (panel) rememberGroup(dockKey, panelComponent(panel), panel.group.id);
      // Focusing a terminal keeps the last file highlighted (like an IDE);
      // only another document changes it.
      const path = filePathOf(panel);
      if (path) useWorkbenchStore.getState().setActiveFile(dockKey, path);
      // Same for the editor status in the app status bar (Ln/Col, language):
      // it follows the last active editor; another document type clears it.
      if (panel && path) {
        useEditorStatus.getState().setActive(dockKey, panelComponent(panel) === "editor" ? panel.id : null);
      }
    });
    useWorkbenchStore.getState().setActiveFile(dockKey, filePathOf(event.api.activePanel));
    {
      const p = event.api.activePanel;
      useEditorStatus.getState().setActive(dockKey, p && panelComponent(p) === "editor" ? p.id : null);
    }
    cleanupRef.current = () => {
      if (timer) clearTimeout(timer);
      disposable.dispose();
      removeSub.dispose();
      activeSub.dispose();
      forgetDock(dockKey);
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
      className={`absolute inset-0 bg-surface ${active ? "z-[var(--lx-z-local)]" : "pointer-events-none z-0 opacity-0"}`}
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
      onDoubleClick={(e) => {
        // Double-click the empty part of a tab strip → maximize / restore that
        // group (the common IDE gesture).
        const target = e.target as HTMLElement;
        if (!target.closest(".dv-void-container")) return;
        const api = useDockStore.getState().apis[dockKey];
        const group = api?.groups.find((g) => g.element.contains(target));
        if (group) {
          group.api.setActive();
          toggleMaximizeGroup(group.id);
        }
      }}
    >
      <DockKeyContext.Provider value={dockKey}>
      <DockviewReact
        components={components}
        defaultTabComponent={tabComponents.default}
        leftHeaderActionsComponent={LeftGroupActions}
        rightHeaderActionsComponent={GroupActions}
        onReady={onReady}
        theme={isLightTheme(theme) ? themeLight : themeDark}
        className="lx-anim-panel h-full w-full"
      />
      </DockKeyContext.Provider>
      {empty && (
        <div className="absolute inset-0 z-[var(--lx-z-local-overlay)] bg-surface">
          <EmptyDock dockKey={dockKey} />
        </div>
      )}
    </div>
  );
}

function DockLayoutImpl() {
  // Subscribe to language changes. This component is `memo`-wrapped and its
  // props do not change on a language switch, so without this it would keep
  // rendering the previous language's strings.
  useT();
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
    // The project is on screen: its "something finished" badge is read.
    useTerminalStatus.getState().seen(key);
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
