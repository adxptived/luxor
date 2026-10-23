import { FolderGit2, FolderPlus, FolderTree, LayoutGrid, Plus, SquareTerminal } from "lucide-react";

import { t } from "@/lib/i18n";
import { hintFor } from "@/lib/hotkeys";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";
import { BUILTIN_LAYOUTS } from "@/layout/builtinLayouts";
import { useDockStore } from "@/layout/dockStore";
import { openContextMenu, type MenuItem } from "@/state/uiStore";
import { useAppStore } from "@/state/appStore";
import { useProjectsStore } from "@/state/projectsStore";

/**
 * Shown when a dock has no panels left open. Keeps the empty state actionable,
 * visually intentional, and friendly at both full-window and tiny split sizes.
 */
export function EmptyDock({ dockKey }: { dockKey: string }) {
  const addTerminal = useDockStore((s) => s.addTerminal);
  const openPanel = useDockStore((s) => s.openPanel);
  const addProject = useProjectsStore((s) => s.addProject);
  const applyBuiltinLayout = useDockStore((s) => s.applyBuiltinLayout);
  const projectPath = useProjectsStore((s) => {
    const p = s.projects.find((x) => x.id === dockKey);
    return p && p.path !== "" ? p.path : null;
  });
  const hasFolder = useProjectsStore((s) => {
    const p = s.projects.find((x) => x.id === dockKey);
    return Boolean(p) && p?.path !== "";
  });

  const allPanels = (e: React.MouseEvent) => {
    const ui = useAppStore.getState().config?.ui;
    const hidden = new Set(ui?.plus_menu_hidden ?? []);
    const items: MenuItem[] = [
      { label: t("cmd.terminal.short", "New terminal"), icon: SquareTerminal, onClick: () => addTerminal() },
      { separator: true },
    ];
    for (const def of PLUS_MENU_PANELS) {
      if (hidden.has(def.kind)) continue;
      if (def.kind === "web" && !(ui?.browser_enabled ?? false)) continue;
      items.push({
        label: t(`panel.${def.kind}`, def.label),
        icon: def.icon,
        onClick: () => openPanel(def.kind as Parameters<typeof openPanel>[0]),
      });
    }
    openContextMenu(e, items);
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-auto bg-surface px-4 py-8"
      data-testid="empty-dock"
    >
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center text-center">
          <div className="lx-empty-icon flex h-11 w-11 items-center justify-center rounded-lg bg-accent/10 text-accent" aria-hidden>
            <LayoutGrid size={20} />
          </div>
          <div className="mt-3 text-sm font-medium text-strong">{t("Nothing open")}</div>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted text-pretty">
            {t("Every tab in this workspace is closed. Reopen the essentials or choose any panel from the menu.")}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <EmptyAction icon={SquareTerminal} label={t("New terminal")} hint={hintFor("terminal.new", useAppStore.getState().config) || "Ctrl+`"} primary onClick={() => addTerminal()} />
          <EmptyAction icon={FolderTree} label={t("Files")} hint={t("Browse project")} onClick={() => openPanel("files")} />
          {hasFolder ? (
            <EmptyAction icon={FolderGit2} label={t("Git")} hint={t("Changes & history")} onClick={() => openPanel("git")} />
          ) : (
            <EmptyAction icon={FolderPlus} label={t("Open folder…")} hint={t("Attach project")} onClick={() => void addProject()} />
          )}
        </div>

        <div className="mt-6 px-1 text-2xs font-medium text-muted">{t("Ready-made layouts")}</div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {BUILTIN_LAYOUTS.map((l) => (
            <EmptyAction
              key={l.id}
              icon={LayoutGrid}
              label={t(l.label)}
              hint={t(l.description)}
              onClick={() => void applyBuiltinLayout(l.id, projectPath)}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-2xs text-muted">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
            onClick={allPanels}
          >
            <Plus size={13} /> {t("More panels…")}
          </button>
          <span>{t("Tip: right-click tabs, sidebar and status bar for customization.")}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyAction(props: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`group flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        props.primary ? "bg-accent/10 text-strong hover:bg-accent/15" : "bg-raised/50 text-strong hover:bg-raised"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          props.primary ? "bg-accent/15 text-accent" : "bg-raised text-muted group-hover:text-strong"
        }`}
      >
        <props.icon size={14} className="shrink-0" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{props.label}</span>
        <span className="block truncate text-2xs text-muted">{props.hint}</span>
      </span>
    </button>
  );
}
