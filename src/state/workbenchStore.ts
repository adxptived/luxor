/**
 * Workbench state: the VS Code-style primary side bar (Explorer / Search) that
 * sits outside the dock, plus the bits of editor state other parts of the UI
 * need to follow (which file the active tab shows, "reveal in explorer"
 * requests).
 *
 * Persisted per machine in localStorage (not config.toml): it is window chrome
 * state, like the per-project dock layout, and changes far too often to round-
 * trip through the Rust config on every drag of the resize handle.
 */

import { create } from "zustand";

export type SidebarView = "explorer" | "search";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 272;

const WORKBENCH_KEY = "luxor.workbench.v1";

interface PersistedWorkbench {
  sidebarOpen: boolean;
  sidebarView: SidebarView;
  sidebarWidth: number;
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

/** Parse the stored blob defensively: a corrupt value must never break startup. */
export function parseWorkbench(raw: string | null): PersistedWorkbench {
  const fallback: PersistedWorkbench = {
    sidebarOpen: true,
    sidebarView: "explorer",
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<PersistedWorkbench>;
    return {
      sidebarOpen: typeof v.sidebarOpen === "boolean" ? v.sidebarOpen : fallback.sidebarOpen,
      sidebarView: v.sidebarView === "search" ? "search" : "explorer",
      sidebarWidth: clampSidebarWidth(typeof v.sidebarWidth === "number" ? v.sidebarWidth : fallback.sidebarWidth),
    };
  } catch {
    return fallback;
  }
}

function load(): PersistedWorkbench {
  try {
    return parseWorkbench(localStorage.getItem(WORKBENCH_KEY));
  } catch {
    return parseWorkbench(null);
  }
}

function persist(state: PersistedWorkbench): void {
  try {
    localStorage.setItem(WORKBENCH_KEY, JSON.stringify(state));
  } catch {
    /* preference just won't persist */
  }
}

/**
 * What `toggleSidebar(view)` should do, as a pure function (unit-tested):
 * clicking the view that is already showing hides the side bar; any other view
 * (or a hidden side bar) shows that view.
 */
export function nextSidebarState(
  current: { open: boolean; view: SidebarView },
  requested?: SidebarView,
): { open: boolean; view: SidebarView } {
  const view = requested ?? current.view;
  if (!current.open) return { open: true, view };
  if (requested && requested !== current.view) return { open: true, view: requested };
  return { open: false, view: current.view };
}

interface WorkbenchStore extends PersistedWorkbench {
  /** File shown by the active editor-like tab, per dock (project) key. */
  activeFileByDock: Record<string, string | null>;
  /** Bumped to ask the side bar to move keyboard focus into its view. */
  focusSeq: number;
  /** One-shot "reveal this path in the explorer" request. */
  reveal: { path: string; seq: number } | null;

  toggleSidebar: (view?: SidebarView) => void;
  /** Show the side bar on `view` and focus it (Ctrl+Shift+E / Ctrl+Shift+F). */
  showSidebar: (view: SidebarView, opts?: { focus?: boolean }) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveFile: (dockKey: string, path: string | null) => void;
  revealInExplorer: (path: string) => void;
}

const initial = load();

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => {
  const save = () => {
    const { sidebarOpen, sidebarView, sidebarWidth } = get();
    persist({ sidebarOpen, sidebarView, sidebarWidth });
  };
  return {
    ...initial,
    activeFileByDock: {},
    focusSeq: 0,
    reveal: null,

    toggleSidebar: (view) => {
      const next = nextSidebarState({ open: get().sidebarOpen, view: get().sidebarView }, view);
      set({ sidebarOpen: next.open, sidebarView: next.view });
      save();
    },
    showSidebar: (view, opts = {}) => {
      set((s) => ({
        sidebarOpen: true,
        sidebarView: view,
        focusSeq: opts.focus === false ? s.focusSeq : s.focusSeq + 1,
      }));
      save();
    },
    setSidebarOpen: (open) => {
      if (get().sidebarOpen === open) return;
      set({ sidebarOpen: open });
      save();
    },
    setSidebarWidth: (width) => {
      const next = clampSidebarWidth(width);
      if (get().sidebarWidth === next) return;
      set({ sidebarWidth: next });
      save();
    },
    setActiveFile: (dockKey, path) => {
      if (get().activeFileByDock[dockKey] === path) return;
      set((s) => ({ activeFileByDock: { ...s.activeFileByDock, [dockKey]: path } }));
    },
    revealInExplorer: (path) => {
      set((s) => ({
        sidebarOpen: true,
        sidebarView: "explorer",
        reveal: { path, seq: (s.reveal?.seq ?? 0) + 1 },
        focusSeq: s.focusSeq + 1,
      }));
      save();
    },
  };
});
