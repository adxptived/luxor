import { FolderGit2, FolderPlus, FolderTree, LayoutGrid, Plus, SquareTerminal } from "lucide-react";

import { t } from "@/lib/i18n";
import { hintFor } from "@/lib/hotkeys";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";
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
      className="lx-empty-state flex h-full w-full items-center justify-center overflow-auto px-4 py-6 text-center"
      data-testid="empty-dock"
    >
      <div className="lx-card w-full max-w-2xl p-5" style={{ borderRadius: "var(--lx-radius-xl)" }}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-edge bg-raised text-muted">
          <LayoutGrid size={24} />
        </div>
        <div className="mt-3 text-base font-semibold text-strong">{t("Nothing open")}</div>
        <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-muted">
          {t("Every tab in this workspace is closed. Reopen the essentials or choose any panel from the menu.")}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <EmptyAction icon={SquareTerminal} label={t("New terminal")} hint={hintFor("terminal.new", useAppStore.getState().config) || "Ctrl+`"} primary onClick={() => addTerminal()} />
          <EmptyAction icon={FolderTree} label={t("Files")} hint={t("Browse project")} onClick={() => openPanel("files")} />
          {hasFolder ? (
            <EmptyAction icon={FolderGit2} label={t("Git")} hint={t("Changes & history")} onClick={() => openPanel("git")} />
          ) : (
            <EmptyAction icon={FolderPlus} label={t("Open folder…")} hint={t("Attach project")} onClick={() => void addProject()} />
          )}
                  </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-muted hover:border-muted hover:bg-raised hover:text-strong"
            onClick={allPanels}
            title={t("Open any panel")}
          >
            <Plus size={14} /> {t("More panels…")}
          </button>
          <span className="max-w-full truncate rounded-full border border-edge px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
            {t("Tip: right-click tabs, sidebar and status bar for customization.")}
          </span>
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
      className={`lx-hover-lift group flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
        props.primary
          ? "border-edge bg-raised text-strong hover:bg-surface"
          : "border-edge bg-surface/50 text-strong hover:border-muted hover:bg-raised"
      }`}
      style={{ borderRadius: "var(--lx-radius-lg)" }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted group-hover:bg-surface">
        <props.icon size={15} className="shrink-0" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{props.label}</span>
        <span className="block truncate text-[11px] text-muted">{props.hint}</span>
      </span>
    </button>
  );
}
