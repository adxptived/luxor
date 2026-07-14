import { AppWindow, FolderOpen, Play, Plus, RefreshCw, SquareTerminal, Star, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { NoFolderCta } from "@/components/NoFolderCta";
import { useDockStore } from "@/layout/dockStore";
import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { isFileManagerIde, isSystemDefaultIde, mergeIdeActions, resolveDefaultIde } from "@/lib/ideActions";
import type { DetectedIde } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useActiveProject, useProjectsStore } from "@/state/projectsStore";

export function LauncherPanel() {
  const project = useActiveProject();
  const updateProject = useProjectsStore((s) => s.updateProject);
  const toast = useAppStore((s) => s.toast);
  const config = useAppStore((s) => s.config);
  const [ides, setIdes] = useState<DetectedIde[]>([]);
  const [executables, setExecutables] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [newCommand, setNewCommand] = useState("");

  useEffect(() => {
    ipc.launcherDetectIdes().then(setIdes, () => {});
  }, []);

  useEffect(() => {
    setExecutables([]);
  }, [project?.id]);

  if (!project || project.path === "") {
    return <NoFolderCta hint={t("Attach a folder to use quick actions and the launcher.")} />;
  }

  const act = (label: string, fn: () => Promise<unknown>, ok?: string) =>
    void fn().then(
      () => ok && toast(ok, "success"),
      (e) => toast(`${label} — ${t("failed:")} ${errorMessage(e)}`, "error"),
    );

  const scan = async () => {
    setScanning(true);
    try {
      setExecutables(await ipc.launcherFindExecutables(project.path));
    } catch (e) {
      toast(`Scan failed: ${errorMessage(e)}`, "error");
    } finally {
      setScanning(false);
    }
  };

  const addFavorite = () => {
    const cmd = newCommand.trim();
    if (!cmd) return;
    if (project.favorite_commands.includes(cmd)) {
      toast(t("Command is already pinned"), "info");
      return;
    }
    void updateProject({ ...project, favorite_commands: [...project.favorite_commands, cmd] });
    setNewCommand("");
  };

  const runFavorite = (cmd: string) => {
    void useDockStore.getState().addTerminal({ cwd: project.path, autorun: [cmd] });
  };

  const ideActions = mergeIdeActions(config?.custom_ides, ides, false);
  const defaultIde = resolveDefaultIde(mergeIdeActions(config?.custom_ides, ides, true), project.preferred_ide ?? config?.default_ide ?? null);
  const defaultIdeLabel = defaultIde ? t(defaultIde.label) : t("IDE");
  const visibleIdeActions = ideActions.filter((ide) => ide.command !== defaultIde?.command);
  const openIdeAction = (ide = defaultIde) => {
    if (!ide) return;
    if (isSystemDefaultIde(ide.command)) {
      act(t("Open"), () => ipc.launcherOpenDefaultApp(project.path), t("Opening with the system default"));
      return;
    }
    if (isFileManagerIde(ide.command)) {
      act(t("Open file manager"), () => ipc.launcherOpenFileManager(project.path), t("Opening file manager"));
      return;
    }
    act(`Open ${ide.label}`, () => ipc.launcherOpenIde(project.path, ide.command), `${t("Opening in")} ${t(ide.label)}`);
  };

  return (
    <div className="h-full overflow-auto bg-surface p-3 text-sm">
      <div className="mb-3 rounded-lg border border-edge bg-[radial-gradient(circle_at_top_left,var(--lx-raised),transparent_46%)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-strong">
              <Wand2 size={17} className="text-accent" /> {t("Project launcher")}
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              {t("Open the current folder in your tools, scan runnable files, and pin repeat commands for one-click starts.")}
            </p>
          </div>
          <span className="min-w-0 truncate rounded-full border border-edge bg-bar px-2 py-1 font-mono text-[10px] text-muted" title={project.path}>
            {project.path}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <Section title={t("Open in…")} subtitle={t("Send the project to your OS tools without leaving Luxor.")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            <Action icon={AppWindow} label={`${t("Open in")} ${defaultIdeLabel}`} hint={t("Selected default IDE")} onClick={() => openIdeAction()} />
            <Action icon={SquareTerminal} label={t("External terminal")} hint={t("Start at project root")} onClick={() => act(t("Open terminal"), () => ipc.launcherOpenTerminal(project.path), t("Opening external terminal"))} />
            <Action icon={FolderOpen} label={t("File manager")} hint={t("Reveal folder")} onClick={() => act(t("Open file manager"), () => ipc.launcherOpenFileManager(project.path), t("Opening file manager"))} />
            {visibleIdeActions.map((ide) => (
              <Action
                key={ide.command}
                icon={AppWindow}
                label={ide.label}
                hint={ide.command === defaultIde?.command ? t("Default") : ide.command}
                onClick={() => openIdeAction(ide)}
              />
            ))}
          </div>
          {ideActions.length === 0 && (
            <EmptyLine icon={AppWindow} text={t("No IDEs detected on PATH. Add custom IDEs in Settings → Launcher; the default/file-manager action still works.")} />
          )}
        </Section>

        <Section title={t("Project executables")} subtitle={t("Discover and launch runnable files from this folder.")}>
          <button
            className="mb-2 flex items-center gap-1.5 rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
            disabled={scanning}
            onClick={() => void scan()}
          >
            <RefreshCw size={13} className={scanning ? "animate-spin" : ""} /> {scanning ? t("Scanning…") : t("Scan project")}
          </button>
          <div className="flex flex-col gap-1.5">
            {executables.map((exe) => (
              <button
                key={exe}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-surface/50 px-2.5 py-1.5 text-left hover:border-accent hover:bg-raised"
                title={`${t("Run")} ${exe}`}
                onClick={() => act(t("Run"), () => ipc.launcherRunExecutable(project.path, exe))}
              >
                <Play size={12} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-strong">{exe}</span>
              </button>
            ))}
            {executables.length === 0 && !scanning && (
              <EmptyLine icon={Play} text={t("Scan to discover runnable files in this project.")} />
            )}
          </div>
        </Section>
      </div>

      <Section title={t("Favorite commands")} subtitle={t("Pin dev loops like `bun dev`, `cargo test`, or your app runner.")}>
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFavorite()}
            placeholder="e.g. cargo run"
            className="min-w-52 flex-1 rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-strong outline-none focus:border-accent"
          />
          <button
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={!newCommand.trim()}
            onClick={addFavorite}
          >
            <Plus size={13} /> {t("Add")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {project.favorite_commands.map((cmd, i) => (
            <div key={`${cmd}-${i}`} className="group flex min-w-0 items-center gap-1 rounded-lg border border-edge bg-surface/50 p-1 hover:border-accent/60 hover:bg-raised">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left"
                title={t("Run in a new terminal tab")}
                onClick={() => runFavorite(cmd)}
              >
                <Play size={12} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-strong">{cmd}</span>
              </button>
              <button
                className="rounded p-1 text-muted opacity-70 hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
                title={t("Remove")}
                onClick={() =>
                  void updateProject({
                    ...project,
                    favorite_commands: project.favorite_commands.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {project.favorite_commands.length === 0 && (
            <div className="md:col-span-2 xl:col-span-3">
              <EmptyLine icon={Star} text={t("No favorites yet. Add the command you run most often and it will also appear in Quick Actions.")} />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-lg border border-edge bg-bar/70 p-3">
      <div className="mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
        <div className="mt-0.5 text-[11px] text-muted">{subtitle}</div>
      </div>
      {children}
    </section>
  );
}

function Action(props: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className="group flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-surface/50 px-3 py-2 text-left transition-[transform,border-color,background-color,box-shadow] hover:-translate-y-px hover:border-accent hover:bg-raised hover:shadow-lg hover:shadow-black/10"
      title={props.hint}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-accent group-hover:bg-accent/10">
        <props.icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-strong">{t(props.label)}</span>
        <span className="block truncate text-[11px] text-muted">{t(props.hint)}</span>
      </span>
    </button>
  );
}

function EmptyLine(props: { icon: React.ComponentType<{ size?: number; className?: string }>; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-muted">
      <props.icon size={13} className="shrink-0 text-accent/70" />
      <span>{props.text}</span>
    </div>
  );
}
