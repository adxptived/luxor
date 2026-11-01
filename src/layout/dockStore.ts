import { t } from "@/lib/i18n";
import type { AddPanelPositionOptions, DockviewApi, SerializedDockview } from "dockview";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import { approveAutorun } from "@/lib/autorunGuard";
import type { LayoutPreset, PanelTerminal } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { pushClosedTab, type ReopenInfo } from "@/lib/closedTabs";
import { revealInEditor } from "@/lib/editorBus";
import { runInTerminalPanel, terminalHandle } from "@/lib/terminalBus";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";
import { isPanelDirty } from "@/lib/dirtyGuard";
import { useWorkbenchStore } from "@/state/workbenchStore";
import { neighbourGroup, rememberedGroup } from "./placement";
import { buildLayout, pickStartFile, type BuiltinLayoutId } from "./builtinLayouts";
import {
  decideTerminalToggle,
  filePlacement,
  groupRole,
  previewToReplace,
  terminalPlacement,
  type GroupSnapshot,
  type Placement,
  type TerminalToggleMode,
} from "./workbenchLogic";

export type PanelKind =
  | "terminal"
  | "git"
  | "diff"
  | "launcher"
  | "welcome"
  | "files"
  | "editor"
  | "image"
  | "db"
  | "tasks"
  | "skills"
  | "web"
  | "pdf"
  | "activity"
  | "analytics"
  | "search"
  | "snippets"
  | "http"
  | "docker"
  | "devtools"
  | "github"
  | "agents"
  | "html";

export interface TerminalPanelParams {
  cwd?: string | null;
  autorun?: string[];
  [key: string]: unknown;
}

/** Where to place a new panel relative to an existing panel/group. */
export type SplitDirection = "left" | "right" | "above" | "below" | "within";

/** Dock key used when no project is active. */
export const WELCOME_KEY = "_welcome";

interface DockStore {
  /** One dockview per visited project (kept mounted so terminals survive). */
  apis: Record<string, DockviewApi>;
  activeKey: string;
  presets: LayoutPreset[];
  /** Recently closed tabs, per dock key, most-recent first (Ctrl+Shift+T). */
  closedTabs: Record<string, ReopenInfo[]>;

  registerApi: (key: string, api: DockviewApi) => void;
  unregisterApi: (key: string) => void;
  setActiveKey: (key: string) => void;
  loadPresets: () => Promise<void>;

  /** Remember a closed tab so it can be reopened in its project. */
  rememberClosed: (info: ReopenInfo) => void;
  /** Reopen the most recently closed tab in the active dock. */
  reopenLastClosed: () => void;
  /** Close the active panel of the active dock (guarded; Ctrl+W). */
  closeActivePanel: () => void;

  addTerminal: (params?: TerminalPanelParams) => void;
  /** Add a terminal split off the active panel in the given direction. */
  splitWithTerminal: (direction: SplitDirection, referencePanel?: string) => void;
  openPanel: (
    kind: Exclude<PanelKind, "terminal" | "diff" | "editor" | "image" | "db" | "pdf">,
    params?: Record<string, unknown>,
    opts?: { forceNew?: boolean },
  ) => void;
  openDiff: (params: { repoPath: string; filePath: string; target: string; commitId?: string }) => void;
  /**
   * Open a file in the right viewer. `preview: true` (single click in the
   * explorer) opens a preview tab that the next preview replaces — VS Code
   * style — until it is edited, double-clicked or opened again normally.
   */
  openFile: (path: string, opts?: { line?: number; preview?: boolean }) => void;

  serialize: () => SerializedDockview | null;
  resetLayout: (cwd?: string | null) => void;

  savePreset: (name: string) => Promise<LayoutPreset | null>;
  applyPreset: (preset: LayoutPreset) => void;
  /** Rebuild the active dock as one of the built-in layouts (asks before discarding unsaved files). */
  applyBuiltinLayout: (id: BuiltinLayoutId, cwd: string | null) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
}

let panelSeq = 0;
const nextId = (kind: string) => `${kind}-${Date.now()}-${++panelSeq}`;
const panelIdFromPath = (kind: string, path: string) =>
  `${kind}:${path}`.replace(/[\u0000-\u001f\u007f]/g, "_");

const PANEL_TITLES: Record<PanelKind, string> = {
  terminal: "Terminal",
  git: "Git",
  diff: "Diff",
  launcher: "Launcher",
  welcome: "Welcome",
  files: "Files",
  editor: "Editor",
  image: "Image",
  db: "Database",
  tasks: "Tasks",
  skills: "Skills",
  web: "Browser",
  pdf: "PDF",
  activity: "Activity",
  analytics: "Analytics",
  search: "Search",
  snippets: "Snippets",
  http: "HTTP Client",
  docker: "Docker",
  devtools: "Dev Tools",
  github: "GitHub",
  agents: "AI Agents",
  html: "HTML Preview",
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const DB_EXTS = new Set(["db", "sqlite", "sqlite3", "db3"]);
const HTML_EXTS = new Set(["html", "htm"]);

export function fileExt(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export const useDockStore = create<DockStore>((set, get) => ({
  apis: {},
  activeKey: WELCOME_KEY,
  presets: [],
  closedTabs: {},

  rememberClosed: (info) =>
    set((s) => {
      const key = s.activeKey;
      return { closedTabs: { ...s.closedTabs, [key]: pushClosedTab(s.closedTabs[key] ?? [], info) } };
    }),

  reopenLastClosed: () => {
    const { activeKey, closedTabs } = get();
    const stack = closedTabs[activeKey] ?? [];
    const info = stack[0];
    if (!info) {
      useAppStore.getState().toast(t("tab.reopen.none", "No recently closed tabs"), "info");
      return;
    }
    set({ closedTabs: { ...closedTabs, [activeKey]: stack.slice(1) } });
    reopenTab(info);
  },

  closeActivePanel: () => {
    const api = activeApi();
    const panel = api?.activePanel;
    if (!panel) return;
    void closePanelGuarded({
      id: panel.id,
      title: panel.title,
      component: panelComponent(panel),
      params: panel.params,
      close: () => panel.api.close(),
    });
  },

  registerApi: (key, api) => set((s) => ({ apis: { ...s.apis, [key]: api } })),
  unregisterApi: (key) =>
    set((s) => {
      const apis = { ...s.apis };
      delete apis[key];
      return { apis };
    }),
  setActiveKey: (activeKey) => set({ activeKey }),

  loadPresets: async () => {
    try {
      set({ presets: await ipc.layoutList() });
    } catch (e) {
      useAppStore.getState().toast(`Failed to load presets: ${errorMessage(e)}`, "error");
    }
  },

  addTerminal: (params = {}) => {
    const api = activeApi();
    if (!api) return;
    const placement = terminalPlacement(
      groupSnapshots(api),
      api.activeGroup?.id ?? null,
      rememberedGroup(get().activeKey, "terminal"),
    );
    addTerminalPanel(api, params, ...placementOptions(api, placement, "terminal"));
  },

  splitWithTerminal: (direction, referencePanel) => {
    const api = activeApi();
    if (!api) return;
    const ref =
      referencePanel ?? api.activePanel?.id ?? api.panels[api.panels.length - 1]?.id;
    addTerminalPanel(api, {}, ref ? { referencePanel: ref, direction } : undefined);
  },

  openPanel: (kind, params = {}, opts = {}) => {
    const api = activeApi();
    if (!api) return;
    // By default these panels are singletons: focus the open one. With
    // `forceNew` (double-click on a nav button) we always spawn a fresh tab,
    // browser-style, using a unique id so dockview keeps both instances.
    if (!opts.forceNew) {
      const existing = api.panels.find((p) => p.id === `panel-${kind}`);
      if (existing) {
        existing.api.setActive();
        return;
      }
    }
    api.addPanel({
      id: opts.forceNew ? nextId(kind) : `panel-${kind}`,
      component: kind,
      title: t(`panel.${kind}`, PANEL_TITLES[kind]),
      params,
    });
  },

  openDiff: (params) => {
    const api = activeApi();
    if (!api) return;
    const id = `diff-${params.filePath}-${params.target}`;
    const existing = api.panels.find((p) => p.id === id);
    if (existing) {
      existing.api.updateParameters(params);
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id,
      component: "diff",
      title: `Diff: ${fileName(params.filePath)}`,
      params,
    });
  },

  openFile: (path, opts = {}) => {
    const api = activeApi();
    if (!api) return;
    const ext = fileExt(path);
    const kind: PanelKind = IMAGE_EXTS.has(ext)
      ? "image"
      : DB_EXTS.has(ext)
        ? "db"
        : ext === "pdf"
          ? "pdf"
          : HTML_EXTS.has(ext)
            ? "html"
            : "editor";
    const id = panelIdFromPath(kind, path);
    const existing = api.panels.find((p) => p.id === id);
    if (existing) {
      existing.api.setActive();
      // Opening a previewed file "for real" keeps its tab.
      if (!opts.preview && isPreviewPanel(existing)) existing.api.updateParameters({ preview: false });
      // Already open: jump to the requested line (e.g. a search hit).
      if (kind === "editor" && opts.line) revealInEditor(id, opts.line);
      return;
    }
    const placement = filePlacement(
      groupSnapshots(api),
      api.activeGroup?.id ?? null,
      rememberedGroup(get().activeKey, "file"),
    );
    let [position, initialHeight] = placementOptions(api, placement, "file");
    // A preview replaces the clean preview tab of the target group, in place.
    let replace: string | null = null;
    if (opts.preview && placement.kind === "within") {
      const group = api.groups.find((g) => g.id === placement.groupId);
      const panels = group?.panels ?? [];
      replace = previewToReplace(
        panels.map((p) => ({ id: p.id, preview: isPreviewPanel(p), dirty: isPanelDirty(p.id) })),
      );
      if (replace && group) {
        position = { referenceGroup: group.id, direction: "within", index: panels.findIndex((p) => p.id === replace) };
        initialHeight = undefined;
      }
    }
    const params: Record<string, unknown> = { path };
    if (opts.line) params.gotoLine = opts.line;
    if (opts.preview) params.preview = true;
    try {
      api.addPanel({
        id,
        component: kind,
        title: fileName(path),
        params,
        ...(position ? { position } : {}),
        ...(initialHeight ? { initialHeight } : {}),
      });
      if (replace) api.getPanel(replace)?.api.close();
    } catch (e) {
      // Dockview can throw while restoring/adding custom preview panels in some
      // stale layouts. Never make opening a file fatal: fall back to the editor.
      if (kind !== "editor") {
        const fallbackId = panelIdFromPath("editor", path);
        const fallbackExisting = api.panels.find((p) => p.id === fallbackId);
        if (fallbackExisting) {
          fallbackExisting.api.setActive();
          return;
        }
        api.addPanel({
          id: fallbackId,
          component: "editor",
          title: fileName(path),
          params: opts.line ? { path, gotoLine: opts.line } : { path },
        });
        useAppStore.getState().toast(`Opened ${fileName(path)} in source view`, "info");
        return;
      }
      throw e;
    }
  },

  serialize: () => {
    const api = activeApi();
    return api ? api.toJSON() : null;
  },

  resetLayout: (cwd) => {
    const api = activeApi();
    if (!api) return;
    api.clear();
    api.addPanel({
      id: nextId("terminal"),
      component: "terminal",
      title: t("panel.terminal", PANEL_TITLES.terminal),
      params: { cwd: cwd ?? null },
    });
  },

  savePreset: async (name) => {
    const api = activeApi();
    if (!api) return null;
    const layout = api.toJSON();
    const terminals: PanelTerminal[] = api.panels
      .filter((p) => (p as { view?: { contentComponent?: string } }).view?.contentComponent === "terminal")
      .map((p) => {
        const params = (p.params ?? {}) as TerminalPanelParams;
        return {
          panel_id: p.id,
          cwd: params.cwd ?? null,
          autorun: params.autorun ?? [],
        };
      });
    const now = new Date().toISOString();
    const preset: LayoutPreset = {
      version: 1,
      id: crypto.randomUUID(),
      name,
      dock_layout: layout,
      terminals,
      created_at: now,
      updated_at: now,
    };
    try {
      const stored = await ipc.layoutSave(preset);
      set((s) => ({ presets: [...s.presets.filter((p) => p.id !== stored.id), stored] }));
      useAppStore.getState().toast(`Layout preset "${name}" saved`, "success");
      return stored;
    } catch (e) {
      useAppStore.getState().toast(`Failed to save preset: ${errorMessage(e)}`, "error");
      return null;
    }
  },

  applyPreset: (preset) => {
    const api = activeApi();
    if (!api) return;
    try {
      api.fromJSON(preset.dock_layout as SerializedDockview);
      useAppStore.getState().toast(`Preset "${preset.name}" applied`, "success");
    } catch (e) {
      console.warn("preset restore failed", e);
      useAppStore.getState().toast(`Preset "${preset.name}" could not be applied`, "error");
    }
  },

  applyBuiltinLayout: async (id, cwd) => {
    const api = activeApi();
    if (!api) return;
    let file: string | null = null;
    if (cwd) {
      try {
        file = pickStartFile(await ipc.fsListDir(cwd));
      } catch {
        file = null;
      }
    }
    await closePanelsGuarded(api.panels.map(closableFromPanel));
    if (api.panels.length > 0) {
      useAppStore.getState().toast(t("layout.builtin.kept", "Layout not changed: some tabs were kept open"), "info");
      return;
    }
    const ids = new Map<string, string>();
    try {
      for (const step of buildLayout(id, { cwd, file })) {
        const panelId =
          step.component === "terminal"
            ? nextId("terminal")
            : step.component === "editor" && typeof step.params?.path === "string"
              ? panelIdFromPath("editor", step.params.path)
              : `panel-${step.component}`;
        const kind = step.component as PanelKind;
        const ref = step.ref ? ids.get(step.ref) : undefined;
        const panel = api.addPanel({
          id: panelId,
          component: step.component,
          title: t(`panel.${kind}`, PANEL_TITLES[kind] ?? kind),
          params: step.params,
          ...(ref && step.direction ? { position: { referencePanel: ref, direction: step.direction } } : {}),
        });
        ids.set(step.key, panelId);
        if (step.size && step.direction) {
          try {
            if (step.direction === "left" || step.direction === "right") {
              panel.group.api.setSize({ width: Math.round(api.width * step.size) });
            } else {
              panel.group.api.setSize({ height: Math.round(api.height * step.size) });
            }
          } catch {
            /* sizing is cosmetic */
          }
        }
      }
    } catch (e) {
      console.warn("builtin layout failed", e);
      useAppStore.getState().toast(t("layout.builtin.failed", "Could not build the layout"), "error");
    }
    // The layouts arrange the editor area; the file tree is the side bar.
    if (cwd) useWorkbenchStore.getState().setSidebarOpen(true);
  },

  deletePreset: async (id) => {
    try {
      await ipc.layoutDelete(id);
      set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
    } catch (e) {
      useAppStore.getState().toast(`Failed to delete preset: ${errorMessage(e)}`, "error");
    }
  },
}));

/** Minimal panel surface needed to close a tab safely. The optional
 *  `component`/`params` let the closer be remembered for Ctrl+Shift+T. */
export interface ClosablePanel {
  id: string;
  title?: string;
  component?: string;
  params?: Record<string, unknown>;
  close: () => void;
}

/** Read the dockview component kind off a panel (used to rebuild it later). */
export function panelComponent(panel: unknown): string | undefined {
  return (panel as { view?: { contentComponent?: string } })?.view?.contentComponent;
}

/** Build the reopen descriptor + close thunk for a dockview panel. */
export function closableFromPanel(panel: {
  id: string;
  title?: string;
  params?: Record<string, unknown>;
  api: { close: () => void };
}): ClosablePanel {
  return {
    id: panel.id,
    title: panel.title,
    component: panelComponent(panel),
    params: panel.params,
    close: () => panel.api.close(),
  };
}

/**
 * Close a panel, but ask first when it holds unsaved changes (the CodeMirror
 * editor registers a dirty-probe via `dirtyGuard`). Every close path — close
 * button, middle-click, "Close others/right/all" — must go through this.
 * On a real close we remember the tab so Ctrl+Shift+T can bring it back.
 */
export async function closePanelGuarded(panel: ClosablePanel): Promise<boolean> {
  const { isPanelDirty } = await import("@/lib/dirtyGuard");
  if (isPanelDirty(panel.id)) {
    const name = (panel.title ?? panel.id).replace(/^● /, "");
    const ok = await useUiStore.getState().confirm({
      title: t("tab.unsaved.title", "Discard unsaved changes?"),
      message: `${name} — ${t("tab.unsaved.message", "unsaved changes will be lost.")}`,
      confirmLabel: t("tab.unsaved.discard", "Discard"),
      danger: true,
    });
    if (!ok) return false;
  }
  if (panel.component) {
    useDockStore.getState().rememberClosed({
      component: panel.component,
      params: panel.params,
      title: (panel.title ?? "").replace(/^● /, ""),
    });
  }
  panel.close();
  return true;
}

/** Recreate a previously closed tab in the active dock. */
function reopenTab(info: ReopenInfo): void {
  const store = useDockStore.getState();
  const c = info.component;
  if (!c || c === "welcome") return;
  const p = info.params ?? {};
  if (c === "editor" || c === "image" || c === "db" || c === "pdf") {
    if (typeof p.path === "string") store.openFile(p.path);
  } else if (c === "diff") {
    store.openDiff(p as Parameters<typeof store.openDiff>[0]);
  } else if (c === "terminal") {
    store.addTerminal(p as TerminalPanelParams);
  } else {
    store.openPanel(c as Parameters<typeof store.openPanel>[0], p);
  }
}

/** Close several panels in order, stopping never — each dirty one confirms. */
export async function closePanelsGuarded(panels: ClosablePanel[]): Promise<void> {
  for (const p of panels) {
    // Sequential on purpose: parallel confirms would stack dialogs.
    await closePanelGuarded(p);
  }
}

/** Focus the next/previous group of the active dock (keyboard alternative to clicking). */
export function focusNeighbourGroup(delta: 1 | -1): void {
  const api = activeApi();
  if (!api) return;
  try {
    const target = neighbourGroup(api.groups.map((g) => g.id), api.activeGroup?.id ?? null, delta);
    const group = api.groups.find((g) => g.id === target);
    if (!group) return;
    group.api.setActive();
    (group.activePanel ?? group.panels[0])?.focus();
  } catch (err) {
    console.warn("focus group failed", err);
  }
}

/** Move the active tab into the next/previous group, keeping it active. */
export function moveTabToNeighbourGroup(delta: 1 | -1): void {
  const api = activeApi();
  const panel = api?.activePanel;
  if (!api || !panel) return;
  try {
    const target = neighbourGroup(api.groups.map((g) => g.id), panel.group.id, delta);
    const group = api.groups.find((g) => g.id === target);
    if (!group) return;
    panel.api.moveTo({ group });
    panel.api.setActive();
  } catch (err) {
    console.warn("move tab to group failed", err);
  }
}

/** Activate the next/previous tab in the focused group of the active dock. */
export function cycleTab(delta: 1 | -1): void {
  const api = activeApi();
  if (!api) return;
  try {
    const group = api.activeGroup ?? api.groups[0];
    if (!group || group.panels.length === 0) return;
    const panels = group.panels;
    const idx = panels.findIndex((p) => p.id === group.activePanel?.id);
    const next = panels[(idx + delta + panels.length) % panels.length];
    next?.api.setActive();
  } catch (e) {
    console.warn("cycleTab failed", e);
  }
}

function activeApi(): DockviewApi | null {
  const { apis, activeKey } = useDockStore.getState();
  return apis[activeKey] ?? null;
}

/** The dockview of the active project (or the Welcome dock). */
export function activeDockApi(): DockviewApi | null {
  return activeApi();
}

/** Plain snapshot of the dock's groups for the pure workbench rules. */
export function groupSnapshots(api: DockviewApi): GroupSnapshot[] {
  try {
    return api.groups.map((g) => ({
      id: g.id,
      components: g.panels.map((p) => panelComponent(p)),
      visible: g.api.isVisible,
      grid: g.api.location.type === "grid",
    }));
  } catch {
    return [];
  }
}

/** True for a tab opened as a (replaceable) preview. */
export function isPreviewPanel(panel: { params?: Record<string, unknown> } | undefined): boolean {
  return Boolean(panel?.params && (panel.params as { preview?: unknown }).preview === true);
}

/**
 * Translate a workbench placement into dockview add-panel options. A hidden
 * target group (terminal panel toggled off) is shown first, and a maximized
 * group is restored so the new tab is actually visible.
 */
function placementOptions(
  api: DockviewApi,
  placement: Placement,
  wanted: "file" | "terminal",
): [AddPanelPositionOptions | undefined, number | undefined] {
  try {
    if (placement.kind === "within") {
      const group = api.groups.find((g) => g.id === placement.groupId);
      if (!group) return [undefined, undefined];
      if (placement.reveal || !group.api.isVisible) revealGroups(api, [group.id]);
      return [{ referenceGroup: group.id, direction: "within" }, undefined];
    }
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
    if (placement.kind === "edge") {
      // Bottom terminal panel: about a third of the dock, never a sliver.
      const height = Math.max(160, Math.round(api.height * 0.32));
      return [{ direction: placement.direction }, wanted === "terminal" ? height : undefined];
    }
    if (placement.kind === "split") {
      const group = api.groups.find((g) => g.id === placement.groupId);
      if (!group) return [undefined, undefined];
      return [
        { referenceGroup: group.id, direction: placement.direction },
        Math.max(160, Math.round(group.api.height * 0.62)),
      ];
    }
  } catch {
    /* fall back to dockview's default placement */
  }
  return [undefined, undefined];
}

function revealGroups(api: DockviewApi, ids: string[]): void {
  try {
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
  } catch {
    /* not maximized */
  }
  for (const id of ids) {
    const group = api.groups.find((g) => g.id === id);
    if (group && !group.api.isVisible) group.api.setVisible(true);
  }
}

function focusGroup(api: DockviewApi, id: string): void {
  const group = api.groups.find((g) => g.id === id);
  if (!group) return;
  try {
    group.api.setActive();
    (group.activePanel ?? group.panels[0])?.focus();
  } catch {
    /* group mid-teardown */
  }
}

/**
 * Ctrl+` — show, focus or hide the terminal panel (the groups that hold only
 * terminals), creating a terminal at the bottom when there is none. `show`
 * never hides (used by "focus terminal").
 */
export function toggleTerminalPanel(mode: TerminalToggleMode = "toggle"): void {
  const api = activeApi();
  if (!api) return;
  const dockKey = useDockStore.getState().activeKey;
  const groups = groupSnapshots(api);
  const action = decideTerminalToggle(
    groups,
    api.activeGroup?.id ?? null,
    rememberedGroup(dockKey, "terminal"),
    rememberedGroup(dockKey, "file"),
    mode,
  );
  try {
    switch (action.kind) {
      case "create":
        useDockStore.getState().addTerminal();
        return;
      case "show":
        revealGroups(api, action.groupIds);
        focusGroup(api, action.focus);
        return;
      case "focus": {
        const group = api.groups.find((g) => g.id === action.groupId);
        // A maximized editor group hides the terminals without them being
        // "hidden" — restore the grid so the focused terminal is on screen.
        if (api.hasMaximizedGroup() && !group?.api.isMaximized()) api.exitMaximizedGroup();
        focusGroup(api, action.groupId);
        return;
      }
      case "hide":
        if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
        for (const id of action.groupIds) api.groups.find((g) => g.id === id)?.api.setVisible(false);
        focusGroup(api, action.focus);
        return;
    }
  } catch (err) {
    console.warn("toggle terminal panel failed", err);
  }
}

/** Is the terminal panel of the active dock currently on screen? */
export function terminalPanelState(api: DockviewApi | null): "none" | "hidden" | "visible" {
  if (!api) return "none";
  const terminals = groupSnapshots(api).filter((g) => g.grid && groupRole(g.components) === "terminal");
  if (terminals.length === 0) return "none";
  return terminals.some((g) => g.visible) ? "visible" : "hidden";
}

/** Maximize the active group, or restore the grid when one is maximized. */
export function toggleMaximizeGroup(groupId?: string): void {
  const api = activeApi();
  if (!api) return;
  try {
    if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
      return;
    }
    const group = groupId ? api.groups.find((g) => g.id === groupId) : api.activeGroup;
    const visibleGrid = api.groups.filter((g) => g.api.location.type === "grid" && g.api.isVisible);
    if (!group || group.api.location.type !== "grid" || visibleGrid.length < 2) return;
    group.api.maximize();
  } catch (err) {
    console.warn("maximize group failed", err);
  }
}

/**
 * Move the active tab into a new group beside its current one (Ctrl+\).
 * Files can only be open once per dock, so splitting moves the tab; the group
 * it leaves keeps its other tabs.
 */
export function splitActivePanel(direction: "right" | "below" = "right"): void {
  const api = activeApi();
  const panel = api?.activePanel;
  if (!api || !panel) return;
  try {
    if (panel.group.panels.length < 2) {
      // Nothing would be left behind: open a terminal next to it instead of
      // moving the lone tab around.
      addTerminalPanel(api, {}, { referencePanel: panel.id, direction });
      return;
    }
    const group = api.addGroup({ referencePanel: panel, direction });
    panel.api.moveTo({ group });
    panel.api.setActive();
  } catch (err) {
    console.warn("split panel failed", err);
  }
}

/**
 * Never leave a dock showing nothing: when every remaining group is hidden
 * (the user closed the editors while the terminal panel was toggled off),
 * bring the hidden ones back.
 */
export function ensureVisibleContent(api: DockviewApi): void {
  try {
    const grid = api.groups.filter((g) => g.api.location.type === "grid");
    if (grid.length > 0 && grid.every((g) => !g.api.isVisible)) {
      for (const g of grid) g.api.setVisible(true);
    }
  } catch {
    /* dock mid-teardown */
  }
}

/** Add a terminal panel to a specific dock, optionally at a split position. */
export function addTerminalPanel(
  api: DockviewApi,
  params: TerminalPanelParams = {},
  position?: AddPanelPositionOptions,
  initialHeight?: number,
): string | null {
  try {
    const id = nextId("terminal");
    // Panels created here are direct user actions (launcher click, split,
    // quick action) — their autorun is pre-approved for this session. Panels
    // restored from serialized layouts/presets do NOT pass through here and
    // will hit the autorun confirm dialog instead (audit fix 2.3).
    if (params.autorun?.length) approveAutorun(id);
    api.addPanel({
      id,
      component: "terminal",
      title: t("panel.terminal", PANEL_TITLES.terminal),
      params,
      ...(position ? { position } : {}),
      ...(initialHeight ? { initialHeight } : {}),
    });
    return id;
  } catch (e) {
    console.warn("addTerminalPanel failed", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-project layout persistence (auto-saved to localStorage per dock)
// ---------------------------------------------------------------------------

export const layoutKey = (dockKey: string) => `luxor.layout.${dockKey}`;

export function saveDockLayout(dockKey: string, api: DockviewApi) {
  try {
    const layout = api.toJSON();
    if (layout.panels && Object.keys(layout.panels).length > 0) {
      localStorage.setItem(layoutKey(dockKey), JSON.stringify(layout));
    } else {
      localStorage.removeItem(layoutKey(dockKey));
    }
  } catch {
    // Serialization must never break the app.
  }
}

export function dropDockLayout(dockKey: string) {
  localStorage.removeItem(layoutKey(dockKey));
}

/** Restore a dock's saved layout, or build the default one.
 *
 *  `isBlank` marks a folder-less ("Blank workspace") project: instead of
 *  dropping the user straight into a terminal, we seed the Welcome launcher so
 *  they get a deliberate menu (open folder / new terminal / AI center / …). */
export function restoreDockLayout(
  dockKey: string,
  api: DockviewApi,
  cwd?: string | null,
  isBlank = false,
) {
  void cwd;
  const raw = localStorage.getItem(layoutKey(dockKey));
  if (raw) {
    try {
      api.fromJSON(JSON.parse(raw) as SerializedDockview);
      // The project's file tree now lives in the Explorer side bar. A layout
      // still holding nothing but the old default "Files" tab (the only thing
      // a fresh project used to get) would show the same tree twice — drop
      // that tab once per project; one the user reopens later stays.
      if (
        api.panels.length === 1 &&
        api.panels[0].id === "panel-files" &&
        markWorkbenchMigrated(dockKey)
      ) {
        api.clear();
        return;
      }
      // A stored layout that parses but contains no panels would leave the
      // window looking empty/broken — fall through to the default instead.
      if (api.panels.length > 0) return;
      console.warn("restored layout has no panels, using default");
    } catch (e) {
      console.warn("layout restore failed, using default", e);
    }
  }
  api.clear();
  markWorkbenchMigrated(dockKey);
  if (dockKey === WELCOME_KEY || isBlank) {
    api.addPanel({
      id: "panel-welcome",
      component: "welcome",
      title: isBlank && dockKey !== WELCOME_KEY ? "Blank workspace" : "Welcome",
      params: { blank: isBlank && dockKey !== WELCOME_KEY },
    });
  }
  // A project with a folder starts with an empty editor area: the Explorer
  // side bar shows its files and the dock's empty state lists the shortcuts
  // (Ctrl+P, Ctrl+`, …). No terminal is spawned at startup — that pulls in the
  // xterm runtime and a shell before the user asked for one.
}

const WORKBENCH_MIGRATED_KEY = "luxor.workbench.migrated";

/** Record that `dockKey` got the side-bar migration; true the first time only. */
function markWorkbenchMigrated(dockKey: string): boolean {
  try {
    const raw = localStorage.getItem(WORKBENCH_MIGRATED_KEY);
    const done = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (done.has(dockKey)) return false;
    done.add(dockKey);
    // Bounded: keys of long-deleted projects are not worth keeping forever.
    localStorage.setItem(WORKBENCH_MIGRATED_KEY, JSON.stringify([...done].slice(-500)));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Terminals across projects: switcher and "run in terminal"
// ---------------------------------------------------------------------------

export interface TerminalRef {
  dockKey: string;
  panelId: string;
  title: string;
  /** False while its terminal panel is hidden (Ctrl+J). */
  visible: boolean;
  /** The tab currently shown in its group. */
  front: boolean;
}

/** Every terminal tab of every project dock that is open this session. */
export function listTerminals(): TerminalRef[] {
  const out: TerminalRef[] = [];
  for (const [dockKey, api] of Object.entries(useDockStore.getState().apis)) {
    try {
      for (const panel of api.panels) {
        if (panelComponent(panel) !== "terminal") continue;
        out.push({
          dockKey,
          panelId: panel.id,
          title: panel.title ?? t("panel.terminal", PANEL_TITLES.terminal),
          visible: panel.group.api.isVisible,
          front: panel.group.activePanel?.id === panel.id,
        });
      }
    } catch {
      /* dock mid-teardown */
    }
  }
  return out;
}

/** Bring a terminal tab of the ACTIVE dock on screen and make it the active tab. */
function showTerminalPanel(api: DockviewApi, panelId: string): boolean {
  const panel = api.getPanel(panelId);
  if (!panel) return false;
  revealGroups(api, [panel.group.id]);
  try {
    panel.api.setActive();
  } catch {
    return false;
  }
  return true;
}

/**
 * Switch to the project that owns a terminal and focus it there. The dock of a
 * project is mounted when the project becomes active, so the focus step waits
 * a frame for it.
 */
export function focusTerminal(dockKey: string, panelId: string, setActiveProject: (id: string) => void): void {
  if (useDockStore.getState().activeKey !== dockKey && dockKey !== WELCOME_KEY) setActiveProject(dockKey);
  let tries = 0;
  const attempt = () => {
    const { apis, activeKey } = useDockStore.getState();
    const api = apis[dockKey];
    if (!api || activeKey !== dockKey) {
      if (++tries < 20) requestAnimationFrame(attempt);
      return;
    }
    if (showTerminalPanel(api, panelId)) {
      requestAnimationFrame(() => terminalHandleFocus(dockKey, panelId));
    }
  };
  attempt();
}

function terminalHandleFocus(dockKey: string, panelId: string): void {
  terminalHandle(dockKey, panelId)?.focus();
}

/**
 * The terminal "run in terminal" commands use in the active dock: the active
 * tab of the terminal group used last, else of any terminal group; null when
 * the project has no terminal yet.
 */
function targetTerminal(api: DockviewApi, dockKey: string): string | null {
  const groups = api.groups.filter((g) => groupRole(g.panels.map((p) => panelComponent(p))) === "terminal");
  const remembered = rememberedGroup(dockKey, "terminal");
  const group = groups.find((g) => g.id === remembered) ?? groups.find((g) => g.api.isVisible) ?? groups[0];
  if (group) return (group.activePanel ?? group.panels[0])?.id ?? null;
  // A terminal sharing a group with other panels still counts.
  return api.panels.find((p) => panelComponent(p) === "terminal")?.id ?? null;
}

/**
 * Type `text` into the active project's terminal and run it, creating a
 * terminal in the terminal panel when there is none. The terminal panel is
 * shown, but keyboard focus is handed back to `restoreFocus` (the editor the
 * command came from) so you can keep editing.
 */
export function runInActiveTerminal(
  text: string,
  opts: { cwd?: string | null; restoreFocus?: () => void; focusTerminal?: boolean } = {},
): void {
  const api = activeApi();
  if (!api || !text.trim()) return;
  const dockKey = useDockStore.getState().activeKey;
  let panelId = targetTerminal(api, dockKey);
  if (panelId) {
    showTerminalPanel(api, panelId);
  } else {
    const placement = terminalPlacement(groupSnapshots(api), api.activeGroup?.id ?? null, rememberedGroup(dockKey, "terminal"));
    panelId = addTerminalPanel(api, opts.cwd ? { cwd: opts.cwd } : {}, ...placementOptions(api, placement, "terminal"));
  }
  if (!panelId) return;
  runInTerminalPanel(dockKey, panelId, text);
  if (opts.focusTerminal) {
    const id = panelId;
    requestAnimationFrame(() => terminalHandleFocus(dockKey, id));
  } else if (opts.restoreFocus) {
    const restore = opts.restoreFocus;
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }
}
