import { t } from "@/lib/i18n";
import type { AddPanelPositionOptions, DockviewApi, SerializedDockview } from "dockview";
import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import { approveAutorun } from "@/lib/autorunGuard";
import type { LayoutPreset, PanelTerminal } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { pushClosedTab, type ReopenInfo } from "@/lib/closedTabs";
import { revealInEditor } from "@/lib/editorBus";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";

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
  openFile: (path: string, opts?: { line?: number }) => void;

  serialize: () => SerializedDockview | null;
  resetLayout: (cwd?: string | null) => void;

  savePreset: (name: string) => Promise<LayoutPreset | null>;
  applyPreset: (preset: LayoutPreset) => void;
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
    addTerminalPanel(api, params);
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
      // Already open: jump to the requested line (e.g. a search hit).
      if (kind === "editor" && opts.line) revealInEditor(id, opts.line);
      return;
    }
    try {
      api.addPanel({
        id,
        component: kind,
        title: fileName(path),
        params: opts.line ? { path, gotoLine: opts.line } : { path },
      });
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

/** Add a terminal panel to a specific dock, optionally at a split position. */
export function addTerminalPanel(
  api: DockviewApi,
  params: TerminalPanelParams = {},
  position?: AddPanelPositionOptions,
) {
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
    });
  } catch (e) {
    console.warn("addTerminalPanel failed", e);
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
  const raw = localStorage.getItem(layoutKey(dockKey));
  if (raw) {
    try {
      api.fromJSON(JSON.parse(raw) as SerializedDockview);
      // A stored layout that parses but contains no panels would leave the
      // window looking empty/broken — fall through to the default instead.
      if (api.panels.length > 0) return;
      console.warn("restored layout has no panels, using default");
    } catch (e) {
      console.warn("layout restore failed, using default", e);
    }
  }
  api.clear();
  if (dockKey === WELCOME_KEY || isBlank) {
    api.addPanel({
      id: "panel-welcome",
      component: "welcome",
      title: isBlank && dockKey !== WELCOME_KEY ? "Blank workspace" : "Welcome",
      params: { blank: isBlank && dockKey !== WELCOME_KEY },
    });
  } else {
    // Keep the default workspace light. Opening a terminal pulls in the xterm
    // runtime and spawns a shell; doing that during startup delays first usable
    // paint even when the user only wants to browse files. The terminal remains
    // one click away via the tab-strip + button, nav rail and hotkeys.
    api.addPanel({
      id: "panel-files",
      component: "files",
      title: t("panel.files", PANEL_TITLES.files),
      params: { cwd: cwd ?? null },
    });
  }
}
