import { AlignCenter, AlignLeft, AlignRight, ArrowRightToLine, Eye, EyeOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { memo, type MouseEvent } from "react";

import { useDockStore, type PanelKind } from "@/layout/dockStore";
import {
  DEFAULT_NAV_HIDDEN,
  localizedNavButton,
  navButtonDef,
  visibleNavButtons,
  type NavButtonDef,
} from "@/lib/navButtons";
import { t, useT } from "@/lib/i18n";
import { effectiveHotkeys } from "@/lib/hotkeys";
import { handleNavDrop, moveNavToZone, useNavDragStore } from "@/lib/navDrag";
import { getNavAction, getNavActionNew } from "@/lib/navActions";
import { setDragGhost } from "@/lib/dragGhost";
import { useAppStore } from "@/state/appStore";
import { openContextMenu } from "@/state/uiStore";

const PANEL_BY_NAV_ID: Partial<Record<string, Exclude<PanelKind, "terminal" | "diff" | "editor" | "image" | "db" | "pdf">>> = {
  git: "git",
  files: "files",
  launcher: "launcher",
  tasks: "tasks",
  skills: "skills",
  agents: "agents",
  activity: "activity",
  search: "search",
  snippets: "snippets",
  http: "http",
  docker: "docker",
  devtools: "devtools",
  github: "github",
  web: "web",
};

/** Dedicated left action rail for nav buttons moved out of the horizontal top bar. */
function NavRailImpl() {
  // Subscribe to language changes: `memo` would otherwise keep this subtree
  // frozen on the old language, since none of its props change on a switch.
  useT();
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const dragId = useNavDragStore((s) => s.dragId);
  const setDragId = useNavDragStore((s) => s.setDragId);

  // Track which panel is currently active to show the nav indicator.
  // Uses the dockview API's activePanel to determine the current panel kind.
  // NOTE: must be called unconditionally (before any early return) so the
  // hook order stays stable across renders (rules-of-hooks).
  const activePanelId = useDockStore((s) => {
    const api = s.apis[s.activeKey];
    if (!api?.activePanel) return null;
    // Panel IDs follow the pattern "panel-{kind}" or "terminal-{n}"
    const id = api.activePanel.id;
    if (id.startsWith("panel-")) return id.replace("panel-", "");
    return null;
  });

  if (!config) return null;
  const navSidebar = config.ui.nav_sidebar ?? [];
  const navHidden = config.ui.nav_hidden ?? [];
  const sidebarSet = new Set(navSidebar);
  const allVisible = visibleNavButtons(config.ui.nav_order ?? [], navHidden)
    .filter((b) => b.id !== "web" || config.ui.browser_enabled)
    .map(localizedNavButton);
  const buttons = allVisible.filter((b) => sidebarSet.has(b.id));
  if (buttons.length === 0 && !dragId) return null;

  // Hotkey lookup for tooltips (mirrors TopBar's navHotkeys mapping).
  const hks = effectiveHotkeys(config);
  const navHotkeys: Record<string, string | undefined> = {
    terminal: hks["terminal.new"],
    git: hks["git.open"],
    files: hks["files.open"],
    search: hks["search.open"],
    palette: hks["palette"],
    settings: hks["settings.open"],
  };

  const iconPosition = config.ui.left_sidebar_icon_position ?? "top";
  const justify = iconPosition === "middle" ? "justify-center" : iconPosition === "bottom" ? "justify-end" : "justify-start";

  const patchUi = (patch: Partial<typeof config.ui>) => {
    void saveConfig({ ...config, ui: { ...config.ui, ...patch } });
  };
  const showInSidebar = (id: string) =>
    patchUi({
      nav_hidden: navHidden.filter((h) => h !== id),
      nav_sidebar: [...navSidebar.filter((x) => x !== id), id],
      nav_chrome: (config.ui.nav_chrome ?? []).filter((x) => x !== id),
    });
  const reset = () => patchUi({ nav_order: [], nav_hidden: [...DEFAULT_NAV_HIDDEN], nav_sidebar: [], nav_chrome: [] });

  const hiddenButtons = navHidden
    .map((id) => navButtonDef(id))
    .filter((d): d is NavButtonDef => d !== undefined)
    .map(localizedNavButton);

  const menu = (e: MouseEvent, def?: NavButtonDef) => {
    openContextMenu(e, [
      ...(def
        ? [
            { label: t("Top bar: align left"), icon: AlignLeft, onClick: () => moveNavToZone(def.id, "topbar-left") },
            { label: t("Top bar: align center"), icon: AlignCenter, onClick: () => moveNavToZone(def.id, "topbar-center") },
            { label: t("Top bar: align right"), icon: AlignRight, onClick: () => moveNavToZone(def.id, "topbar-right") },
            { label: t("Move to window corner"), icon: ArrowRightToLine, onClick: () => moveNavToZone(def.id, "chrome") },
            {
              label: t('Hide "{0}" button').replace("{0}", def.label),
              icon: EyeOff,
              disabled: allVisible.length <= 1,
              onClick: () => moveNavToZone(def.id, "hidden"),
            },
            { separator: true as const },
          ]
        : []),
      ...hiddenButtons.map((h) => ({
        label: t('Show "{0}" in sidebar').replace("{0}", h.label),
        icon: Eye,
        onClick: () => showInSidebar(h.id),
      })),
      ...(hiddenButtons.length > 0 ? [{ separator: true as const }] : []),
      { label: t("Reset buttons to default"), icon: RotateCcw, onClick: reset },
      { label: t("Customize in Settings…"), icon: SlidersHorizontal, onClick: () => setSettingsOpen(true, "interface") },
    ]);
  };

  return (
    <div
      className={`lx-nav-rail flex w-11 shrink-0 flex-col border-r border-edge bg-[var(--lx-glass-bg)] ${dragId && buttons.length === 0 ? "ring-1 ring-accent/60" : ""}`} style={{ backdropFilter: "blur(var(--lx-glass-blur))", WebkitBackdropFilter: "blur(var(--lx-glass-blur))" }}
      data-testid="nav-rail"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) menu(e);
      }}
      onDragOver={(e) => dragId && e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (dragId) handleNavDrop(dragId, null, "sidebar"); setDragId(null); }}
    >
      <div
        className={`flex h-full flex-col items-center gap-1 p-1.5 ${justify}`}
        role="toolbar"
        aria-label={t("Sidebar navigation")}
        aria-orientation="vertical"
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          const container = e.currentTarget;
          const focusables = Array.from(
            container.querySelectorAll<HTMLElement>('button:not([disabled])'),
          ).filter((el) => el.offsetParent !== null);
          const idx = focusables.indexOf(document.activeElement as HTMLElement);
          if (idx < 0) return;
          e.preventDefault();
          const next = e.key === "ArrowDown" ? (idx + 1) % focusables.length : (idx - 1 + focusables.length) % focusables.length;
          focusables[next]?.focus();
        }}
      >
        {buttons.map((def) => {
          const isActive = activePanelId !== null && PANEL_BY_NAV_ID[def.id] === activePanelId;
          // Surface the keyboard shortcut in the tooltip (matches TopBar):
          // rail buttons are icon-only, so this is the only discovery point.
          const hotkey = navHotkeys[def.id];
          const title = hotkey ? `${def.title} (${hotkey})` : def.title;
          return (
          <button
            key={def.id}
            draggable
            data-nav-id={def.id}
            title={title}
            aria-label={title}
            className={`lx-square-btn relative flex h-8 w-8 items-center justify-center text-muted hover:text-strong ${isActive ? "is-active" : ""}`}
            onClick={(e) => { if (e.detail > 1) return; getNavAction(def.id)(); }}
            onDoubleClick={() => getNavActionNew(def.id)()}
            onContextMenu={(e) => menu(e, def)}
            onDragStart={(e) => {
              setDragId(def.id);
              setDragGhost(e, def.label);
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) handleNavDrop(dragId, def.id, "sidebar"); setDragId(null); }}
          >
            <def.icon size={16} />
          </button>
          );
        })}
      </div>
    </div>
  );
}

// Memoized: App re-renders on unrelated store changes (config saves, language
// version bumps), and this component takes no props that change with them.
// It reads translations through `useT()` so the memo cannot freeze it on a
// stale language.
export const NavRail = memo(NavRailImpl);
