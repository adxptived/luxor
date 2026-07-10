import { useDockStore, type PanelKind } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { launcherOpenIde, openPath } from "./ipc";

export function getNavAction(id: string): () => void {
  const { addTerminal, openPanel } = useDockStore.getState();
  const { setPaletteOpen, setSettingsOpen } = useAppStore.getState();
  const openLayoutPresets = () => openPanel("launcher");

  const actions: Record<string, () => void> = {
    terminal: () => addTerminal(),
    ide: () => launcherOpenIde("."),
    filemanager: () => openPath("."),
    git: () => openPanel("git"),
    files: () => openPanel("files"),
    launcher: () => openPanel("launcher"),
    tasks: () => openPanel("tasks"),
    skills: () => openPanel("skills"),
    presets: openLayoutPresets,
    agents: () => openPanel("agents"),
    activity: () => openPanel("activity"),
    analytics: () => openPanel("analytics"),
    search: () => openPanel("search"),
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
