import { useDockStore, type PanelKind } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useWorkbenchStore, type SidebarView } from "@/state/workbenchStore";
import { launcherOpenIde, openPath } from "./ipc";

/** The side bar exists for projects with a folder (not Welcome / blank workspaces). */
export function sidebarAvailable(): boolean {
  const { projects, activeId } = useProjectsStore.getState();
  return projects.some((p) => p.id === activeId && p.path !== "");
}

/**
 * Explorer / Search: toggle the matching side-bar view (activity-bar style);
 * on the Welcome screen, where there is no side bar, open the dock panel.
 */
export function toggleSidebarView(view: SidebarView): void {
  if (sidebarAvailable()) useWorkbenchStore.getState().toggleSidebar(view);
  else useDockStore.getState().openPanel(view === "explorer" ? "files" : "search");
}

/** Show a side-bar view and focus it (Ctrl+Shift+E / Ctrl+Shift+F). */
export function showSidebarView(view: SidebarView): void {
  if (sidebarAvailable()) useWorkbenchStore.getState().showSidebar(view);
  else useDockStore.getState().openPanel(view === "explorer" ? "files" : "search");
}

export function getNavAction(id: string): () => void {
  const { addTerminal, openPanel } = useDockStore.getState();
  const { setPaletteOpen, setSettingsOpen } = useAppStore.getState();
  const openLayoutPresets = () => openPanel("launcher");

  const actions: Record<string, () => void> = {
    terminal: () => addTerminal(),
    ide: () => launcherOpenIde("."),
    filemanager: () => openPath("."),
    git: () => openPanel("git"),
    files: () => toggleSidebarView("explorer"),
    launcher: () => openPanel("launcher"),
    tasks: () => openPanel("tasks"),
    skills: () => openPanel("skills"),
    presets: openLayoutPresets,
    agents: () => openPanel("agents"),
    activity: () => openPanel("activity"),
    analytics: () => openPanel("analytics"),
    search: () => toggleSidebarView("search"),
    snippets: () => openPanel("snippets"),
    http: () => openPanel("http"),
    docker: () => openPanel("docker"),
    devtools: () => openPanel("devtools"),
    github: () => openPanel("github"),
    web: () => openPanel("web"),
    palette: () => setPaletteOpen(true),
    settings: () => setSettingsOpen(true),
  };

  return actions[id] || (() => console.warn(`No action for nav button: ${id}`));
}

export function getNavActionNew(id: string): () => void {
  const { addTerminal, openPanel } = useDockStore.getState();
  const openNew = (kind: Exclude<PanelKind, "terminal" | "diff" | "editor" | "image" | "db" | "pdf">) => openPanel(kind, {}, { forceNew: true });

  const actionsNew: Record<string, () => void> = {
    terminal: () => addTerminal(),
    git: () => openNew("git"),
    files: () => openNew("files"),
    launcher: () => openNew("launcher"),
    tasks: () => openNew("tasks"),
    skills: () => openNew("skills"),
    agents: () => openNew("agents"),
    activity: () => openNew("activity"),
    analytics: () => openNew("analytics"),
    search: () => openNew("search"),
    snippets: () => openNew("snippets"),
    http: () => openNew("http"),
    docker: () => openNew("docker"),
    devtools: () => openNew("devtools"),
    github: () => openNew("github"),
    web: () => openNew("web"),
  };

  return actionsNew[id] || getNavAction(id);
}
