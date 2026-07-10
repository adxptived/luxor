import {
  Copy,
  Eye,
  EyeOff,
  FolderTree,
  Minus,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Square,
  SquarePlus,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

import { useDockStore, type PanelKind } from "@/layout/dockStore";
import { isTauri } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { setDragGhost } from "@/lib/dragGhost";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";
import type { AppConfig } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { openContextMenu } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useWindowSize } from "@/lib/useWindowSize";

const chromeBtn =
  "lx-square-btn lx-toolbar-item flex h-7 w-7 items-center justify-center text-muted hover:text-strong";

type OpenablePanel = Exclude<PanelKind, "terminal" | "diff" | "editor" | "image" | "db" | "pdf">;

function isOpenablePanel(kind: string): kind is OpenablePanel {
  return kind !== "terminal" && kind !== "diff" && kind !== "editor" && kind !== "image" && kind !== "db" && kind !== "pdf";
}

function activeCwd(): string | null {
  const { projects, activeId } = useProjectsStore.getState();
  return projects.find((p) => p.id === activeId)?.path || null;
}

/** Every quick-action button that can live in the window top bar. */
export const CHROME_ACTION_IDS = ["left", "right", "terminal", "new", "files", "settings"] as const;
export type ChromeActionId = (typeof CHROME_ACTION_IDS)[number];
/** Curated default: only the two layout toggles, which exist nowhere else, so
 *  the top bar never duplicates buttons already in the nav rail / tab strip. */
export const DEFAULT_CHROME_ACTIONS: ChromeActionId[] = ["left", "right"];
const CHROME_ACTION_LABEL: Record<ChromeActionId, string> = {
  left: "Left sidebar",
  right: "Right sidebar",
  terminal: "New terminal",
  new: "Open panel…",
  files: "Files",
  settings: "Settings",
};
function isChromeAction(id: string): id is ChromeActionId {
  return (CHROME_ACTION_IDS as readonly string[]).includes(id);
}

/** Small, configurable, drag-reorderable controls (Zed/VS Code style chrome).
 *  No outline around the group; right-click any button to hide/show/reset. */
export function ChromeQuickActions({ compact = false }: { compact?: boolean }) {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  // Stable-action selectors: a bare useDockStore() re-rendered the always-
  // visible window chrome on every dock state change (panel focus etc.).
  const addTerminal = useDockStore((s) => s.addTerminal);
  const openPanel = useDockStore((s) => s.openPanel);
  const [dragId, setDragId] = useState<ChromeActionId | null>(null);

  const patchUi = (patch: Partial<AppConfig["ui"]>) => {
    if (!config) return;
    void saveConfig({ ...config, ui: { ...config.ui, ...patch } });
  };

  const showPanelMenu = (e: MouseEvent) => {
    openContextMenu(e, [
      {
        label: t("New terminal"),
        icon: SquareTerminal,
        hint: "Ctrl+`",
        onClick: () => addTerminal({ cwd: activeCwd() }),
      },
      { separator: true },
      ...PLUS_MENU_PANELS.filter((p) => isOpenablePanel(p.kind)).map((p) => ({
        label: t(`panel.${p.kind}`, p.label),
        icon: p.icon as LucideIcon,
        onClick: () => openPanel(p.kind as OpenablePanel),
      })),
    ]);
  };

  // "The left sidebar": in side-tab mode it's the main vertical project/nav
  // rail (left_sidebar_open); in top-tab mode it's the optional side panel.
  const sideTabs = config?.tab_bar_position === "side";
  const leftSidebarOpen = config?.ui.left_sidebar_open ?? true;
  const sidePanelEnabled = config?.ui.side_panel_enabled ?? false;
  const leftSidebarCollapsed = config?.ui.left_sidebar_collapsed ?? false;
  const rightOpen = config?.ui.right_panel_enabled ?? false;
  const leftActive = sideTabs ? leftSidebarOpen && !leftSidebarCollapsed : sidePanelEnabled && !leftSidebarCollapsed;
  // Collapse means icon-only, not fully hidden. In side-tab mode the vertical
  // TopBar is the main left sidebar, so keep it open and toggle its compact rail.
  // If it was fully closed by an older config, first click restores it expanded.
  const toggleLeft = () =>
    sideTabs
      ? !leftSidebarOpen
        ? patchUi({ left_sidebar_open: true, left_sidebar_collapsed: false })
        : patchUi({ left_sidebar_collapsed: !leftSidebarCollapsed })
      : !sidePanelEnabled
        ? patchUi({ side_panel_enabled: true, left_sidebar_collapsed: false })
        : patchUi({ left_sidebar_collapsed: !leftSidebarCollapsed });

  type ActionDef = { icon: LucideIcon; title: string; active?: boolean; onClick: (e: MouseEvent) => void };
  const actions: Record<ChromeActionId, ActionDef> = {
    left: { icon: PanelLeft, title: leftActive ? t("Collapse left sidebar") : t("Expand left sidebar"), active: leftActive, onClick: toggleLeft },
    right: { icon: PanelRight, title: rightOpen ? t("Hide right sidebar") : t("Show right sidebar"), active: rightOpen, onClick: () => patchUi({ right_panel_enabled: !rightOpen }) },
    terminal: { icon: SquareTerminal, title: t("New terminal"), onClick: () => addTerminal({ cwd: activeCwd() }) },
    new: { icon: SquarePlus, title: t("Open panel…"), onClick: (e) => showPanelMenu(e) },
    files: { icon: FolderTree, title: t("Files"), onClick: () => openPanel("files") },
    settings: { icon: Settings, title: t("Settings"), onClick: () => setSettingsOpen(true, "interface") },
  };

  const configured = (config?.ui.chrome_actions ?? []).filter(isChromeAction);
  const order: ChromeActionId[] = configured.length ? configured : DEFAULT_CHROME_ACTIONS;
  const hidden = CHROME_ACTION_IDS.filter((id) => !order.includes(id));

  const setOrder = (next: ChromeActionId[]) => patchUi({ chrome_actions: next });
  const hideAction = (id: ChromeActionId) => setOrder(order.filter((x) => x !== id));
  const showAction = (id: ChromeActionId) => setOrder([...order, id]);
  const moveBefore = (drag: ChromeActionId, target: ChromeActionId) => {
    if (drag === target) return;
    const next = order.filter((x) => x !== drag);
    const i = next.indexOf(target);
    next.splice(i < 0 ? next.length : i, 0, drag);
    setOrder(next);
  };

  const menu = (e: MouseEvent, id?: ChromeActionId) => {
    openContextMenu(e, [
      ...(id ? [{ label: t("Hide this button"), icon: EyeOff, onClick: () => hideAction(id) }] : []),
      ...(id && hidden.length ? [{ separator: true as const }] : []),
      ...hidden.map((h) => ({
        label: t('Show "{0}" button').replace("{0}", t(CHROME_ACTION_LABEL[h])),
        icon: Eye,
        onClick: () => showAction(h),
      })),
      ...(hidden.length || id ? [{ separator: true as const }] : []),
      { label: t("Reset top-bar buttons"), icon: RotateCcw, onClick: () => setOrder([]) },
      { label: t("Customize in Settings…"), icon: SlidersHorizontal, onClick: () => setSettingsOpen(true, "interface") },
    ]);
  };

  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-testid="chrome-quick-actions"
      role="toolbar"
      aria-label={t("Quick actions")}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const container = e.currentTarget;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>('button:not([disabled])'),
        ).filter((el) => el.offsetParent !== null);
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        if (idx < 0) return;
        e.preventDefault();
        const next = e.key === "ArrowRight" ? (idx + 1) % focusables.length : (idx - 1 + focusables.length) % focusables.length;
        focusables[next]?.focus();
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          menu(e);
        }
      }}
    >
      {!compact && <div className="mr-1 hidden text-xs font-semibold tracking-wide text-muted/80 sm:block">Luxor</div>}
      {order.map((id) => {
        const a = actions[id];
        return (
          <button
            key={id}
            draggable
            data-chrome-id={id}
            className={`${chromeBtn} ${dragId && dragId !== id ? "ring-1 ring-muted/40" : ""}`}
            title={a.title}
            aria-label={a.title}
            aria-pressed={a.active}
            onClick={(e) => a.onClick(e)}
            onContextMenu={(e) => {
              e.preventDefault();
              menu(e, id);
            }}
            onDragStart={(e) => {
              setDragId(id);
              setDragGhost(e, t(CHROME_ACTION_LABEL[id]));
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={() => dragId && moveBefore(dragId, id)}
          >
            <a.icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

export function WindowControls() {
  const [maxed, setMaxed] = useState(false);
  // When "Keep running in the background" is on, the close button hides Luxor to
  // the tray instead of quitting — say so, so the X never feels like a trap.
  const closeToTray = useAppStore((s) => s.config?.ui.close_to_tray ?? true);

  useEffect(() => {
    if (!isTauri) return;
    let offResize: (() => void) | undefined;
    let offMove: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        void win.isMaximized().then(setMaxed).catch(() => {});
        void win.onResized(() => void win.isMaximized().then(setMaxed).catch(() => {})).then((u) => (offResize = u));
        void win.onMoved(() => void win.isMaximized().then(setMaxed).catch(() => {})).then((u) => (offMove = u));
      })
      .catch(() => {});
    return () => {
      offResize?.();
      offMove?.();
    };
  }, []);

  type CurrentWindow = {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    close: () => Promise<void>;
  };
  const withWindow = async (fn: (win: CurrentWindow) => Promise<unknown>) => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await fn(getCurrentWindow());
  };

  return (
    <div className="lx-caption-group" data-testid="window-controls" role="toolbar" aria-label={t("Window controls")} onKeyDown={(e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const container = e.currentTarget;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>('button:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);
      const idx = focusables.indexOf(document.activeElement as HTMLElement);
      if (idx < 0) return;
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (idx + 1) % focusables.length : (idx - 1 + focusables.length) % focusables.length;
      focusables[next]?.focus();
    }}>
      <button className="lx-caption-btn" title={t("Minimize")} aria-label={t("Minimize")} onClick={() => void withWindow((w) => w.minimize())}>
        <Minus size={15} />
      </button>
      <button
        className="lx-caption-btn"
        title={maxed ? t("Restore") : t("Maximize")}
        aria-label={maxed ? t("Restore") : t("Maximize")}
        onClick={() =>
          void withWindow(async (w) => {
            await w.toggleMaximize();
            setMaxed(await w.isMaximized().catch(() => false));
          })
        }
      >
        {maxed ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button
        className="lx-caption-btn lx-caption-close"
        title={closeToTray ? t("Close to tray") : t("Close")}
        aria-label={closeToTray ? t("Close to tray") : t("Close")}
        onClick={() => void withWindow((w) => w.close())}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Replacement for the native OS titlebar when the project tabs live in the left rail. */
import { ChromeNavButtons } from "./ChromeNavButtons";

export function WindowChrome() {
  const config = useAppStore((s) => s.config);
  // Shared window-size source (audit S2) — replaces the local resize tracker.
  const { compact } = useWindowSize();

  const onDblClick = () => {
    if (!isTauri) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().toggleMaximize(),
    );
  };

  return (
    <div className="lx-titlebar" data-testid="window-chrome">
      <ChromeQuickActions compact={compact} />
      <div
        className="lx-drag flex-1 self-stretch"
        data-tauri-drag-region
        onDoubleClick={onDblClick}
      />
      <ChromeNavButtons config={config} />
      <WindowControls />
    </div>
  );
}
