import { create } from "zustand";

import * as ipc from "@/lib/ipc";
import type { Project } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "./appStore";
import { registerMigration } from "@/lib/stateMigration";

// Phase 23: Register state migration for projects store.
registerMigration<{ projects: Project[]; activeId: string | null }>("luxor.projectsState", 1, {});

const MAX_CLOSED_PROJECT_TABS = 20;

type ClosedProjectTab = Pick<Project, "id" | "name" | "path" | "icon" | "color">;

interface ProjectsStore {
  projects: Project[];
  activeId: string | null;
  /** True once `load()` has finished (success or failure). Until then the
   *  active project is unknown, so the dock layout must not fall back to the
   *  Welcome screen — doing so flashes a throwaway dock before the restored
   *  workspace snaps in. */
  loaded: boolean;
  /** Recently closed top-level project tabs, most recent first. */
  closedProjectTabs: ClosedProjectTab[];

  load: () => Promise<void>;
  addProject: () => Promise<void>;
  /** Register a known folder directly (Recent projects / Welcome screen). */
  addProjectPath: (path: string, name?: string) => Promise<Project | null>;
  addBlank: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  /** Browser-style project tab navigation (Ctrl+Tab / Ctrl+Shift+Tab). */
  cycleActive: (delta: 1 | -1) => void;
  /** Reopen the most recently closed top-level project tab, browser-style. */
  reopenClosedProjectTab: () => Promise<boolean>;
  updateProject: (project: Project) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

const ACTIVE_KEY = "luxor.activeProject";

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  activeId: null,
  loaded: false,
  closedProjectTabs: [],

  load: async () => {
    try {
      const projects = await ipc.projectList();
      const saved = localStorage.getItem(ACTIVE_KEY);
      const activeId =
        projects.find((p) => p.id === saved)?.id ?? projects[0]?.id ?? null;
      // Set projects, the resolved active id and the loaded flag in a single
      // update so the dock renders the correct workspace on the very first
      // render after load — no intermediate Welcome-screen flash.
      set({ projects, activeId, loaded: true });
      if (activeId) void ipc.projectTouch(activeId).catch(() => {});
    } catch (e) {
      // Even on failure, mark as loaded so the UI can settle on the Welcome
      // screen instead of waiting behind the splash forever.
      set({ loaded: true });
      useAppStore.getState().toast(`Failed to load projects: ${errorMessage(e)}`, "error");
    }
  },

  addProject: async () => {
    try {
      const path = await ipc.pickDirectory();
      if (!path) return;
      const project = await ipc.projectAdd(path);
      set((s) => ({ projects: [...s.projects.filter((p) => p.id !== project.id), project] }));
      get().setActive(project.id);
    } catch (e) {
      useAppStore.getState().toast(`Failed to add project: ${errorMessage(e)}`, "error");
    }
  },

  addProjectPath: async (path, name) => {
    try {
      const project = await ipc.projectAdd(path, name);
      set((s) => ({ projects: [...s.projects.filter((p) => p.id !== project.id), project] }));
      return project;
    } catch (e) {
      useAppStore.getState().toast(`Failed to reopen project: ${errorMessage(e)}`, "error");
      return null;
    }
  },

  addBlank: async () => {
    try {
      const project = await ipc.projectAddBlank();
      set((s) => ({ projects: [...s.projects.filter((p) => p.id !== project.id), project] }));
      get().setActive(project.id);
    } catch (e) {
      useAppStore.getState().toast(`Failed to add workspace: ${errorMessage(e)}`, "error");
    }
  },

  removeProject: async (id) => {
    try {
      const closing = get().projects.find((p) => p.id === id);
      await ipc.projectRemove(id);
      const projects = get().projects.filter((p) => p.id !== id);
      set((s) => ({
        projects,
        closedProjectTabs: closing
          ? [{ id: closing.id, name: closing.name, path: closing.path, icon: closing.icon, color: closing.color }, ...s.closedProjectTabs]
              .filter((p, i, arr) => !p.path || i === arr.findIndex((x) => x.path === p.path))
              .slice(0, MAX_CLOSED_PROJECT_TABS)
          : s.closedProjectTabs,
      }));
      if (get().activeId === id) get().setActive(projects[0]?.id ?? null);
    } catch (e) {
      useAppStore.getState().toast(`Failed to remove project: ${errorMessage(e)}`, "error");
    }
  },

  setActive: (id) => {
    set({ activeId: id });
    // Storage can be unavailable (privacy mode, disabled WebView storage, full
    // quota). Project switching must still succeed when persistence does not.
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* best-effort preference persistence */
    }
    if (id) void ipc.projectTouch(id).catch(() => {});
  },

  cycleActive: (delta) => {
    const { projects, activeId } = get();
    if (projects.length < 2) return;
    const ordered = [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const current = activeId ? ordered.findIndex((p) => p.id === activeId) : -1;
    const next = ordered[(Math.max(0, current) + delta + ordered.length) % ordered.length];
    if (next && next.id !== activeId) get().setActive(next.id);
  },

  reopenClosedProjectTab: async () => {
    const [tab, ...rest] = get().closedProjectTabs;
    if (!tab) return false;
    set({ closedProjectTabs: rest });
    const reopened = tab.path
      ? await get().addProjectPath(tab.path, tab.name)
      : await ipc.projectAddBlank(tab.name).then((project) => {
          set((s) => ({ projects: [...s.projects.filter((p) => p.id !== project.id), project] }));
          return project;
        });
    if (!reopened) return false;
    const project = { ...reopened, icon: tab.icon, color: tab.color };
    if (project.icon !== reopened.icon || project.color !== reopened.color) {
      await get().updateProject(project);
    }
    get().setActive(project.id);
    return true;
  },

  updateProject: async (project) => {
    try {
      await ipc.projectUpdate(project);
      set((s) => ({ projects: s.projects.map((p) => (p.id === project.id ? project : p)) }));
    } catch (e) {
      useAppStore.getState().toast(`Failed to update project: ${errorMessage(e)}`, "error");
    }
  },

  reorder: async (ids) => {
    const byId = new Map(get().projects.map((p) => [p.id, p]));
    const projects = ids.map((id) => byId.get(id)).filter((p): p is Project => Boolean(p));
    set({ projects });
    try {
      await ipc.projectReorder(ids);
    } catch (e) {
      useAppStore.getState().toast(`Failed to reorder: ${errorMessage(e)}`, "error");
    }
  },
}));

export function useActiveProject(): Project | null {
  const { projects, activeId } = useProjectsStore();
  return projects.find((p) => p.id === activeId) ?? null;
}
