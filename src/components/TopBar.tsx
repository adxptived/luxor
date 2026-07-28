import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  BookOpen,
  Bug,
  ChevronDown,
  ClipboardCopy,
  Cloud,
  Copy,
  Database,
  Eye,
  EyeOff,
  Flame,
  FlaskConical,
  Folder,
  FolderGit2,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Globe,
  Heart,
  History,
  LayoutGrid,
  Layers,
  MoreHorizontal,
  Music,
  Palette,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Rocket,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Smile,
  SquareTerminal,
  Star,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t, useLanguageVersion, useT } from "@/lib/i18n";
import { handleNavDrop, moveNavToZone, useNavDragStore, type NavZone } from "@/lib/navDrag";
import { getNavAction, getNavActionNew } from "@/lib/navActions";
import { setDragGhost } from "@/lib/dragGhost";
import { TAB_ICON_IDS, lucideIcon, parseTabIcon, type TabIconId } from "@/lib/tabIcon";
import { useDismiss } from "@/lib/dismiss";
import { useScrollEdges } from "@/lib/scrollEdges";
import { effectiveHotkeys } from "@/lib/hotkeys";
import { DEFAULT_NAV_HIDDEN, localizedNavButton, navButtonDef, visibleNavButtons, type NavButtonDef } from "@/lib/navButtons";
import type { LayoutPreset, RecentProject } from "@/lib/types";
import { buildTabLayout, GROUP_COLORS, type TabGroup } from "@/lib/tabGroups";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive, openContextMenu, useUiStore, type MenuItem } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useTabGroups } from "@/state/tabGroupsStore";
import { QuickActions } from "./QuickActions";
import { ChromeQuickActions, WindowControls } from "./WindowChrome";

/** Accent colors selectable per project tab. */
const TAB_COLORS: { label: string; value: string | null }[] = [
  { label: "No color", value: null },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Lime", value: "#a3e635" },
  { label: "Green", value: "#22c55e" },
  { label: "Teal", value: "#2dd4bf" },
  { label: "Sky", value: "#38bdf8" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#818cf8" },
  { label: "Violet", value: "#a78bfa" },
  { label: "Fuchsia", value: "#e879f9" },
  { label: "Pink", value: "#f472b6" },
  { label: "Slate", value: "#94a3b8" },
];

/** Curated SVG tab icons (stored as "lucide:<id>", see lib/tabIcon). */
const TAB_ICON_COMPONENTS: Record<TabIconId, LucideIcon> = {
  rocket: Rocket,
  star: Star,
  flame: Flame,
  zap: Zap,
  bug: Bug,
  heart: Heart,
  folder: Folder,
  terminal: SquareTerminal,
  globe: Globe,
  book: BookOpen,
  wrench: Wrench,
  flask: FlaskConical,
  shield: Shield,
  database: Database,
  cloud: Cloud,
  music: Music,
};

/** Render a stored tab icon (curated SVG or legacy emoji). */
function TabIcon({ stored }: { stored: string | null }) {
  const parsed = parseTabIcon(stored);
  if (!parsed) return null;
  if (parsed.kind === "lucide") {
    const Cmp = TAB_ICON_COMPONENTS[parsed.value as TabIconId];
    return Cmp ? <Cmp size={13} className="shrink-0 text-muted" /> : null;
  }
  return <span className="shrink-0 text-sm leading-none">{parsed.value}</span>;
}

/** Project tab bar + global actions. Renders horizontally (top) or vertically (side). */
/** Stable shared fallback for nav config arrays while the config loads —
 *  keeps useMemo dependency identities from changing on every render. */
const EMPTY_NAV_LIST: string[] = [];

/** Width the project tabs keep in the horizontal bar no matter how many nav
 *  buttons are visible. Sized so a full-width tab (name capped at `max-w-36`)
 *  plus the "+" button always fit — a strip narrower than one tab is useless. */
const MIN_TAB_STRIP_WIDTH = 240;

function TopBarImpl({ vertical }: { vertical: boolean }) {
  // Subscribe to language changes. This component is `memo`-wrapped and its
  // props do not change on a language switch, so without this it would keep
  // rendering the previous language's strings. `langVersion` additionally feeds
  // the memos below that bake translated labels into arrays — `t` is a stable
  // module function, so those caches are not invalidated by a switch on their own.
  useT();
  const langVersion = useLanguageVersion();
  // Per-field selectors instead of bare store subscriptions: TopBar is always
  // mounted and 1200+ lines — a bare useDockStore()/useProjectsStore() call
  // re-rendered it on EVERY dock state change (panel focus switches, panel API
  // registrations) even though it only reads `presets` and stable actions.
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useProjectsStore((s) => s.activeId);
  const setActive = useProjectsStore((s) => s.setActive);
  const addProject = useProjectsStore((s) => s.addProject);
  const addBlank = useProjectsStore((s) => s.addBlank);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const updateProject = useProjectsStore((s) => s.updateProject);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const toast = useAppStore((s) => s.toast);
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const presets = useDockStore((s) => s.presets);
  const savePreset = useDockStore((s) => s.savePreset);
  const applyPreset = useDockStore((s) => s.applyPreset);
  const deletePreset = useDockStore((s) => s.deletePreset);
  const [presetMenu, setPresetMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const navDragId = useNavDragStore((s) => s.dragId);
  const setNavDragId = useNavDragStore((s) => s.setDragId);
  const [navDragOverId, setNavDragOverId] = useState<string | null>(null);
  const [moreMenu, setMoreMenu] = useState(false);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const navStackRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLSpanElement>(null);
  const reorder = useProjectsStore((s) => s.reorder);
  const tabGroups = useTabGroups();
  const resizing = useRef(false);

  // Prune group membership for tabs that were closed (keeps localStorage tidy).
  useEffect(() => {
    tabGroups.sync(projects.map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);
  const addMenuRef = useRef<HTMLSpanElement>(null);
  const presetMenuRef = useRef<HTMLSpanElement>(null);

  useDismiss(addMenu, () => setAddMenu(false), addMenuRef);
  useDismiss(moreMenu, () => setMoreMenu(false), moreMenuRef);

  // Tab-strip overflow: drives the edge fades, and the "more tabs" dropdown.
  // The strip scrolls horizontally in the top bar and vertically in the
  // sidebar, so the axis follows the orientation.
  // (`tabLayout` is declared later in the component; re-measuring on project
  // count changes is sufficient here.)
  const tabEdges = useScrollEdges(tabStripRef, vertical ? "y" : "x", [vertical, projects.length]);


  // Keep browser-style keyboard navigation visible: when Ctrl+Tab changes the
  // active project, scroll that tab into view instead of leaving focus hidden in
  // an overflowed strip.
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || !activeId) return;
    strip
      .querySelector<HTMLElement>(`[data-project-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, vertical]);

  // Refresh the "Recent projects" list every time the add-menu opens.
  useEffect(() => {
    if (addMenu) ipc.recentList(8).then(setRecents, () => setRecents([]));
  }, [addMenu]);

  const reopenRecent = async (r: RecentProject) => {
    setAddMenu(false);
    try {
      const p = await useProjectsStore.getState().addProjectPath(r.path, r.name);
      if (p) setActive(p.id);
    } catch {
      /* surfaced by the store toast */
    }
  };
  useDismiss(presetMenu, () => setPresetMenu(false), presetMenuRef);

  const topbarSize = Math.min(64, Math.max(28, config?.ui.topbar_size ?? 36));
  const sidebarWidth = Math.min(420, Math.max(140, config?.ui.sidebar_width ?? 208));
  // Side-tab row height: 0 = compact content-driven default (unchanged look);
  // any positive value fixes each vertical tab at that height so more workspaces
  // fit. Only applied in side-tab mode (see renderTab), never in the top bar.
  const tabHeight = Math.min(64, Math.max(0, config?.ui.tab_height ?? 0));
  // Side-tab strip height: 0 = automatic (strip fills leftover sidebar height —
  // the original behavior). A positive value fixes the strip height; the
  // nav-button stack below reclaims the freed space. Set by dragging the divider
  // between them (see startTabStripResize). Side-tab mode only.
  const tabStripHeight = Math.min(4096, Math.max(0, config?.ui.tab_strip_height ?? 0));
  const quickActionsHere = (config?.ui.quick_actions ?? "top") === "top" && vertical;
  // The main vertical sidebar can be closed (animated to width 0); reopen from
  // the window top-bar's left-sidebar toggle. Only meaningful in side-tab mode.
  const leftOpen = config?.ui.left_sidebar_open ?? true;
  const leftCollapsed = vertical && (config?.ui.left_sidebar_collapsed ?? false);
  const collapsedSidebarWidth = 44;

  // Fall back to a shared frozen constant (not a fresh `[]`) so the useMemo
  // dependencies below keep a stable identity while the config is loading.
  const navOrder = config?.ui.nav_order ?? EMPTY_NAV_LIST;
  const navHidden = config?.ui.nav_hidden ?? EMPTY_NAV_LIST;
  const navSidebar = config?.ui.nav_sidebar ?? EMPTY_NAV_LIST;
  const navChrome = config?.ui.nav_chrome ?? EMPTY_NAV_LIST;
  const browserEnabled = Boolean(config?.ui.browser_enabled);
  // Avoid rebuilding nav button arrays and lookup sets on every tab/menu render.
  // These values only depend on nav config, browser visibility and orientation.
  const allVisibleNavButtons = useMemo(() => {
    // `localizedNavButton` reads the active language from i18n module state, so
    // this memo must be invalidated by hand when the language changes.
    void langVersion;
    return visibleNavButtons(navOrder, navHidden)
      .filter((b) => b.id !== "web" || browserEnabled)
      .map(localizedNavButton);
  }, [browserEnabled, navHidden, navOrder, langVersion]);
  const navButtons = useMemo(() => {
    if (vertical) return allVisibleNavButtons;
    const navSidebarSet = new Set(navSidebar);
    const navChromeSet = new Set(navChrome);
    return allVisibleNavButtons.filter((b) => !navSidebarSet.has(b.id) && !navChromeSet.has(b.id));
  }, [allVisibleNavButtons, navChrome, navSidebar, vertical]);
  // Split the horizontal top-bar buttons into left / center / right alignment
  // groups. Anything not explicitly listed as left or center is right-aligned
  // (the historical default). In the vertical sidebar there is no left/center/
  // right, so everything stays in one stacked list.
  const navTopbarLeft = config?.ui.nav_topbar_left ?? EMPTY_NAV_LIST;
  const navTopbarCenter = config?.ui.nav_topbar_center ?? EMPTY_NAV_LIST;
  const navGroups = useMemo(() => {
    if (vertical) return { left: [] as NavButtonDef[], center: [] as NavButtonDef[], right: navButtons };
    const leftSet = new Set(navTopbarLeft);
    const centerSet = new Set(navTopbarCenter);
    return {
      left: navButtons.filter((b) => leftSet.has(b.id)),
      center: navButtons.filter((b) => centerSet.has(b.id)),
      right: navButtons.filter((b) => !leftSet.has(b.id) && !centerSet.has(b.id)),
    };
  }, [navButtons, navTopbarLeft, navTopbarCenter, vertical]);
  // Nav-stack overflow (vertical sidebar only). The stack sizes to its content
  // and only scrolls once the tab strip above has shrunk to its minimum
  // height, so the edge fades appear exactly when buttons are actually cut off.
  const navEdges = useScrollEdges(navStackRef, "y", [vertical, navButtons.length, quickActionsHere, leftCollapsed]);

  // How many nav buttons the HORIZONTAL bar can show next to the project tabs.
  // The button cluster is `shrink-0`, so a dozen visible buttons used to shrink
  // the tab strip to a ~100px slit — the same squeeze the vertical sidebar had.
  // Everything past the capacity moves into a "⋯" menu.
  const [navCapacity, setNavCapacity] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (vertical) {
      setNavCapacity(Number.POSITIVE_INFINITY);
      return;
    }
    const cluster = navStackRef.current;
    const strip = tabStripRef.current;
    if (!cluster || !strip) return;
    const measure = () => {
      // The strip and the cluster share a fixed pool of width (the strip grows
      // into whatever the cluster leaves), so the budget does not depend on how
      // many buttons are rendered right now — measuring cannot feed back on
      // itself and oscillate.
      const navItems = Array.from(cluster.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.querySelector("[data-nav-id],[data-nav-more]") !== null,
      );
      if (navItems.length === 0) return;
      const gap = 2; // gap-0.5
      const itemWidth = navItems[0].offsetWidth + gap;
      const navWidth = navItems.reduce((sum, el) => sum + el.offsetWidth + gap, 0);
      const pool = strip.clientWidth + cluster.offsetWidth;
      const budget = pool - MIN_TAB_STRIP_WIDTH - (cluster.offsetWidth - navWidth);
      setNavCapacity(Math.max(0, Math.floor(budget / itemWidth)));
    };
    measure();
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(cluster);
    ro.observe(strip);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [vertical, navGroups.right.length]);
  // Split the horizontal cluster into what fits and what moves to the "⋯" menu.
  const barNav = vertical ? navButtons : navGroups.right;
  const navOverflowing = !vertical && barNav.length > navCapacity;
  const barNavShown = navOverflowing ? barNav.slice(0, Math.max(0, navCapacity - 1)) : barNav;
  const barNavHidden = navOverflowing ? barNav.slice(barNavShown.length) : [];
  const hiddenButtons = useMemo(() => {
    void langVersion; // see `allVisibleNavButtons`
    return navHidden
      .map((id) => navButtonDef(id))
      .filter((d): d is NavButtonDef => d !== undefined)
      .map(localizedNavButton);
  }, [navHidden, langVersion]);

  // ---- nav button actions ------------------------------------------------

  const runNavAction = (id: string) => getNavAction(id)();
  const runNavActionNew = (id: string) => getNavActionNew(id)();

  const saveNav = (patch: {
    nav_order?: string[];
    nav_hidden?: string[];
    nav_sidebar?: string[];
    nav_chrome?: string[];
    nav_topbar_left?: string[];
    nav_topbar_center?: string[];
  }) => {
    if (!config) return;
    void saveConfig({ ...config, ui: { ...config.ui, ...patch } });
  };

  const showNavButton = (id: string) =>
    saveNav({
      nav_hidden: navHidden.filter((h) => h !== id),
      nav_sidebar: navSidebar.filter((x) => x !== id),
      nav_chrome: navChrome.filter((x) => x !== id),
    });
  const resetNavButtons = () =>
    saveNav({
      nav_order: [],
      nav_hidden: [...DEFAULT_NAV_HIDDEN],
      nav_sidebar: [],
      nav_chrome: [],
      nav_topbar_left: [],
      nav_topbar_center: [],
    });

  const navContextMenu = (e: React.MouseEvent, def?: NavButtonDef) => {
    openContextMenu(e, [
      ...(def
        ? [
            ...(!vertical
              ? [
                  { label: t("Move to sidebar"), icon: ArrowLeftToLine, onClick: () => moveNavToZone(def.id, "sidebar") },
                  {
                    label: t("Top bar: align left"),
                    icon: AlignLeft,
                    disabled: navTopbarLeft.includes(def.id),
                    onClick: () => moveNavToZone(def.id, "topbar-left"),
                  },
                  {
                    label: t("Top bar: align center"),
                    icon: AlignCenter,
                    disabled: navTopbarCenter.includes(def.id),
                    onClick: () => moveNavToZone(def.id, "topbar-center"),
                  },
                  {
                    label: t("Top bar: align right"),
                    icon: AlignRight,
                    disabled: !navTopbarLeft.includes(def.id) && !navTopbarCenter.includes(def.id),
                    onClick: () => moveNavToZone(def.id, "topbar-right"),
                  },
                  { label: t("Move to window corner"), icon: ArrowRightToLine, onClick: () => moveNavToZone(def.id, "chrome") },
                ]
              : []),
            {
              label: t('Hide "{0}" button').replace("{0}", def.label),
              icon: EyeOff,
              disabled: allVisibleNavButtons.length <= 1,
              onClick: () => moveNavToZone(def.id, "hidden"),
            },
            { separator: true },
          ]
        : []),
      ...hiddenButtons.map((h) => ({
        label: t('Show "{0}" button').replace("{0}", h.label),
        icon: Eye,
        onClick: () => showNavButton(h.id),
      })),
      ...(hiddenButtons.length > 0 ? [{ separator: true }] : []),
      { label: t("Reset buttons to default"), icon: RotateCcw, onClick: resetNavButtons },
      {
        label: t("Customize in Settings…"),
        icon: SlidersHorizontal,
        onClick: () => setSettingsOpen(true, "interface"),
      },
    ]);
  };

  const onNavDrop = (targetId: string | null) => {
    if (navDragId) handleNavDrop(navDragId, targetId, "topbar");
    setNavDragId(null);
    setNavDragOverId(null);
  };
  // Drop into a specific top-bar alignment group (left / center / right).
  const onNavDropZone = (targetId: string | null, zone: NavZone) => {
    if (navDragId) handleNavDrop(navDragId, targetId, zone);
    setNavDragId(null);
    setNavDragOverId(null);
  };

  // Render a single nav button. `zone` is the alignment group the button is
  // rendered in, so dropping another button onto it inherits that alignment.
  const renderNavBtn = (def: NavButtonDef, zone: NavZone) => {
    const anchored = def.id === "presets";
    const hks = effectiveHotkeys(config);
    const navHotkeys: Record<string, string> = {
      terminal: hks["terminal.new"],
      git: hks["git.open"],
      files: hks["files.open"],
      search: hks["search.open"],
      palette: hks["palette"],
      settings: hks["settings.open"],
    };
    return (
      <span
        key={def.id}
        className={`relative ${vertical ? "w-full" : ""}`}
        ref={anchored ? presetMenuRef : undefined}
      >
        <NavBtn
          def={def}
          vertical={vertical}
          collapsed={leftCollapsed}
          dropTarget={navDragOverId === def.id && navDragId !== null && navDragId !== def.id}
          hotkey={navHotkeys[def.id]}
          onClick={() => runNavAction(def.id)}
          onDoubleClick={() => runNavActionNew(def.id)}
          onContextMenu={(e) => navContextMenu(e, def)}
          onDragStart={(e) => {
            setNavDragId(def.id);
            setDragGhost(e, def.label);
          }}
          onDragEnd={() => {
            setNavDragId(null);
            setNavDragOverId(null);
          }}
          onDragOver={(e) => {
            if (!navDragId) return;
            e.preventDefault();
            setNavDragOverId(def.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onNavDropZone(def.id, zone);
          }}
        />
        {def.id === "presets" && presetMenu && (
          <PresetMenu
            presets={presets}
            vertical={vertical}
            onApply={(p) => {
              applyPreset(p);
              setPresetMenu(false);
            }}
            onSave={(name) => {
              void savePreset(name);
              setPresetMenu(false);
            }}
            onDelete={(id) => void deletePreset(id)}
          />
        )}
      </span>
    );
  };

  // Drop-zone wrapper for an alignment group: dropping on empty space assigns
  // the group's alignment, keeping order. Shows a labelled placeholder while a
  // drag is in progress so empty groups are still discoverable drop targets.
  const renderAlignZone = (
    group: NavButtonDef[],
    zone: Extract<NavZone, "topbar-left" | "topbar-center">,
    label: string,
    overId: string,
    extraClass = "",
  ) => (
    <div
      className={`flex h-full items-center gap-0.5 ${extraClass} ${navDragOverId === overId ? "rounded-lg ring-1 ring-accent/50" : ""}`}
      data-testid={`nav-buttons-${zone}`}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) navContextMenu(e);
      }}
      onDragOver={(e) => {
        if (!navDragId) return;
        e.preventDefault();
        setNavDragOverId(overId);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setNavDragOverId(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (navDragId) onNavDropZone(null, zone);
      }}
    >
      {group.map((def) => renderNavBtn(def, zone))}
      {group.length === 0 && navDragId && (
        <span className="whitespace-nowrap rounded border border-dashed border-accent/50 px-2 py-0.5 text-3xs text-muted">
          {label}
        </span>
      )}
    </div>
  );

  // ---- project tabs ------------------------------------------------------

  const closeTab = async (id: string, skipConfirm = false) => {
    const project = projects.find((p) => p.id === id);
    if (project?.pinned) {
      toast(t("Tab is pinned — unpin it first to close"), "info");
      return;
    }
    if (!skipConfirm) {
      const ok = await confirmDestructive({
        title: `${t("Close tab")} “${project?.name ?? id}”?`,
        message: t("Folders on disk are not touched — only the tab is removed."),
        confirmLabel: t("Close tab"),
      });
      if (!ok) return;
    }
    void removeProject(id);
  };

  const renameTab = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    const name = await useUiStore.getState().prompt({ title: t("Tab name"), initial: project.name });
    if (name?.trim() && name.trim() !== project.name) {
      void updateProject({ ...project, name: name.trim() });
    }
  };

  const onDropTab = (targetId: string) => {
    setDragOverId(null);
    if (!dragId || dragId === targetId) return;
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    void reorder(ids);
    setDragId(null);
  };

  const customEmoji = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    const icon = await useUiStore.getState().prompt({
      title: t("Custom emoji"),
      message: t("Paste an emoji (e.g. 🚀). Leave empty to remove the icon."),
      initial: project.icon?.startsWith("lucide:") ? "" : (project.icon ?? ""),
      placeholder: "🚀",
    });
    if (icon === null) return;
    void updateProject({ ...project, icon: icon.trim() || null });
  };

  /** Tab icon picker: curated SVG icons first, custom emoji as fallback. */
  const iconMenu = (e: React.MouseEvent, id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    openContextMenu(e, [
      ...TAB_ICON_IDS.map((iconId) => ({
        label: iconId.charAt(0).toUpperCase() + iconId.slice(1),
        icon: TAB_ICON_COMPONENTS[iconId],
        onClick: () => void updateProject({ ...project, icon: lucideIcon(iconId) }),
      })),
      { separator: true as const },
      { label: t("Custom emoji…"), icon: Smile, onClick: () => void customEmoji(id) },
      { label: t("Remove icon"), icon: X, onClick: () => void updateProject({ ...project, icon: null }) },
    ]);
  };

  const colorMenu = (e: React.MouseEvent, id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    openContextMenu(e, [
      ...TAB_COLORS.map((c) => ({
        label: t(c.label),
        swatch: c.value ?? "transparent",
        onClick: () => void updateProject({ ...project, color: c.value }),
      })),
      { separator: true as const },
      {
        label: t("Custom color…"),
        icon: Palette,
        onClick: () => {
          void (async () => {
            const hex = await useUiStore.getState().prompt({
              title: t("Custom tab color"),
              message: t("Hex color, e.g. #ff6b9d"),
              initial: project.color ?? "#",
              placeholder: "#ff6b9d",
            });
            if (hex === null) return;
            const v = hex.trim();
            if (!v) return void updateProject({ ...project, color: null });
            if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
              useAppStore.getState().toast(t("Use a 6-digit hex color like #ff6b9d"), "error");
              return;
            }
            void updateProject({ ...project, color: v });
          })();
        },
      },
    ]);
  };

  // ---- tab groups (browser-style) ---------------------------------------

  const defaultGroupName = () => `${t("Group")} ${tabGroups.groups.length + 1}`;

  const createGroupFromTab = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    tabGroups.newGroupFromTab(id, defaultGroupName());
    toast(`${t("Tab group created")}: ${project.name}`, "success");
  };

  const groupColorMenu = (e: React.MouseEvent, groupId: string) => {
    openContextMenu(
      e,
      GROUP_COLORS.map((c) => ({
        label: t(c.name),
        swatch: c.hex,
        onClick: () => tabGroups.recolorGroup(groupId, c.hex),
      })),
    );
  };

  const renameGroup = async (groupId: string) => {
    const grp = tabGroups.groups.find((g) => g.id === groupId);
    const name = await useUiStore.getState().prompt({ title: t("Group name"), initial: grp?.name ?? "" });
    if (name?.trim()) tabGroups.renameGroup(groupId, name.trim());
  };

  const groupMenu = (e: React.MouseEvent, groupId: string) => {
    const grp = tabGroups.groups.find((g) => g.id === groupId);
    openContextMenu(e, [
      { label: t("Rename group…"), icon: Pencil, onClick: () => void renameGroup(groupId) },
      { label: t("Group color…"), icon: Palette, onClick: () => groupColorMenu(e, groupId) },
      {
        label: grp?.collapsed ? t("Expand group") : t("Collapse group"),
        icon: Layers,
        onClick: () => tabGroups.toggleCollapse(groupId),
      },
      { separator: true },
      { label: t("Ungroup tabs"), icon: FolderMinus, danger: true, onClick: () => tabGroups.deleteGroup(groupId) },
    ]);
  };

  const tabGroupMenuItems = (id: string): MenuItem[] => {
    const current = tabGroups.assignments[id];
    return [
      { label: t("New group from this tab"), icon: FolderPlus, onClick: () => createGroupFromTab(id) },
      ...tabGroups.groups
        .filter((g) => g.id !== current)
        .map((g) => ({
          label: `${t("Add to")} “${g.name}”`,
          swatch: g.color,
          onClick: () => tabGroups.assignTab(id, g.id),
        })),
      ...(current
        ? [{ label: t("Remove from group"), icon: FolderMinus, onClick: () => tabGroups.removeTab(id) }]
        : []),
    ];
  };

  const tabMenu = (e: React.MouseEvent, id: string) => {
    const project = projects.find((p) => p.id === id);
    const hks = effectiveHotkeys(config);
    openContextMenu(e, [
      { label: t("Rename tab…"), icon: Pencil, onClick: () => void renameTab(id) },
      {
        label: project?.pinned ? t("Unpin tab") : t("Pin tab (protect from closing)"),
        icon: project?.pinned ? PinOff : Pin,
        onClick: () => {
          if (project) void updateProject({ ...project, pinned: !project.pinned });
        },
      },
      { label: t("Tab icon…"), icon: Smile, onClick: () => iconMenu(e, id) },
      { label: t("Tab color…"), icon: Palette, onClick: () => colorMenu(e, id) },
      { separator: true },
      ...tabGroupMenuItems(id),
      { separator: true },
      {
        label: t("New terminal here"),
        icon: SquareTerminal,
        hint: hks["terminal.new"],
        onClick: () => {
          setActive(id);
          addTerminal({ cwd: project?.path ? project.path : null });
        },
      },
      ...(project?.path
        ? [
            {
              label: t("Reveal in file manager"),
              icon: FolderOpen,
              onClick: () => void ipc.launcherOpenFileManager(project.path).catch(() => {}),
            },
            {
              label: t("Copy project path"),
              icon: ClipboardCopy,
              onClick: () => void navigator.clipboard.writeText(project.path ?? ""),
            },
          ]
        : []),
      { separator: true },
      { label: t("Close tab"), icon: Trash2, danger: true, hint: hks["tab.close"], onClick: () => void closeTab(id) },
      {
        label: t("Close other tabs"),
        icon: Copy,
        disabled: projects.length <= 1,
        onClick: () => {
          for (const p of projects) {
            if (p.id !== id && !p.pinned) void removeProject(p.id);
          }
        },
      },
      {
        label: t("Close saved tabs"),
        icon: FolderMinus,
        disabled: projects.filter((p) => !p.pinned && p.id !== id).length === 0,
        onClick: () => {
          for (const p of projects) {
            if (p.id !== id && !p.pinned) void removeProject(p.id);
          }
        },
      },
    ]);
  };

  // Drag the sidebar edge to resize it (vertical mode only).
  const startResize = (e: React.PointerEvent) => {
    if (!vertical || !config) return;
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    let next = startW;
    const onMove = (ev: PointerEvent) => {
      // Round: clientX is fractional on high-DPI, and sidebar_width is a u16.
      next = Math.round(Math.min(420, Math.max(140, startW + ev.clientX - startX)));
      document.documentElement.style.setProperty("--lx-sidebar-w", `${next}px`);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizing.current = false;
      const cfg = useAppStore.getState().config;
      if (cfg && next !== cfg.ui.sidebar_width) {
        void saveConfig({ ...cfg, ui: { ...cfg.ui, sidebar_width: next } });
      }
    };
    // onMove only writes a CSS variable (no preventDefault) — passive is safe
    // and keeps the resize drag smooth.
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
  };

  // Drag the divider between the project-tab strip and the nav-button stack to
  // fix the strip height (vertical, expanded mode only). 0 = automatic; any
  // drag commits a concrete pixel height that persists across restarts. Mirrors
  // `startResize` for the sidebar width, but on the Y axis.
  const startTabStripResize = (e: React.PointerEvent) => {
    if (!vertical || leftCollapsed || !tabStripRef.current || !config) return;
    e.preventDefault();
    resizing.current = true;
    const startY = e.clientY;
    // Start from the strip's *current* rendered height (works whether the strip
    // is in automatic flex-1 mode or already fixed at a saved height).
    const startH = tabStripRef.current.getBoundingClientRect().height;
    let next = Math.round(startH);
    const onMove = (ev: PointerEvent) => {
      // Clamp to the existing min-height floor (7.5rem ≈ 120px) so a full nav
      // stack can never squeeze the tabs out, and never exceed the sidebar.
      next = Math.round(Math.max(120, startH + ev.clientY - startY));
      tabStripRef.current!.style.height = `${next}px`;
      tabStripRef.current!.style.flex = "0 0 auto";
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizing.current = false;
      const cfg = useAppStore.getState().config;
      if (cfg && next !== cfg.ui.tab_strip_height) {
        void saveConfig({ ...cfg, ui: { ...cfg.ui, tab_strip_height: next } });
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
  };

  // Pinned tabs float to the front, then browser-style groups cluster their
  // members contiguously (see lib/tabGroups). renderTab is shared by grouped
  // and ungrouped rendering so the tab markup stays in one place.
  const sortedProjects = [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const tabLayout = buildTabLayout(sortedProjects, tabGroups.assignments, tabGroups.groups);

  const renderTab = (p: (typeof projects)[number]) => (
    <div
      key={p.id}
      data-testid="project-tab"
      data-project-id={p.id}
      draggable
      onDragStart={(e) => {
        setDragId(p.id);
        setDragGhost(e, p.name);
      }}
      onDragEnd={() => {
        setDragId(null);
        setDragOverId(null);
      }}
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        setDragOverId(p.id);
      }}
      onDragLeave={() => setDragOverId((v) => (v === p.id ? null : v))}
      onDrop={() => onDropTab(p.id)}
      onClick={(e) => {
        if (e.shiftKey) {
          void closeTab(p.id, true);
          return;
        }
        setActive(p.id);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(p.id);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActive(p.id);
        }
      }}
      onContextMenu={(e) => tabMenu(e, p.id)}
      role="tab"
      aria-selected={activeId === p.id}
      tabIndex={activeId === p.id ? 0 : -1}
      title={`${p.path ? (p.path_exists ? p.path : `${p.path} — ${t("folder not found")}`) : t("Blank workspace")}${p.pinned ? `\n${t("Pinned — unpin to close")}` : `\n${t("⇧ Click to close")}`}\n${t("Ctrl+Tab / Ctrl+Shift+Tab to switch · Ctrl+Shift+T to reopen")}`}
      style={{
        ...(p.color ? { boxShadow: `inset 0 2px 0 0 ${p.color}` } : {}),
        borderRadius: "var(--lx-tab-radius)",
        // Side-tab mode only: a configured row height fixes each tab at that
        // height (overriding the content-driven `py-2`) so more workspaces fit
        // in the rail. Top-bar and collapsed modes keep their own sizing.
        ...(vertical && !leftCollapsed && tabHeight > 0
          ? { height: `${tabHeight}px`, paddingTop: 0, paddingBottom: 0 }
          : {}),
      }}
      className={`group relative flex cursor-pointer items-center ${leftCollapsed ? "justify-center gap-0 px-0" : "gap-1.5 px-3"} ${
        vertical ? (leftCollapsed ? "mx-1 my-0.5 h-8 rounded-lg py-0" : "my-0.5 border-b border-edge py-2") : "mx-0.5 my-1 h-[calc(100%-0.5rem)] border border-transparent"
      } ${activeId === p.id ? "bg-surface text-strong" : "text-muted hover:text-strong"} ${
        dragOverId === p.id && dragId && dragId !== p.id
          ? vertical
            ? "shadow-[inset_0_2px_0_0_var(--lx-muted)]"
            : "shadow-[inset_2px_0_0_0_var(--lx-muted)]"
          : ""
      }`}
    >
      {activeId === p.id && (
        <span
          aria-hidden
          className={`pointer-events-none absolute rounded-full bg-muted ${
            vertical ? "bottom-2 left-1 top-2 w-[2px]" : "bottom-1 left-2 right-2 h-[2px]"
          }`}
        />
      )}
      {p.icon ? (
        <TabIcon stored={p.icon} />
      ) : p.path === "" ? (
        <LayoutGrid size={13} className="shrink-0 opacity-60" />
      ) : !p.path_exists ? (
        <TriangleAlert size={13} className="shrink-0 text-warning" />
      ) : (
        <FolderGit2 size={13} className="shrink-0 opacity-60" />
      )}
      {!leftCollapsed && <span className="max-w-36 truncate">{p.name}</span>}
      {p.pinned && !leftCollapsed && <Pin size={10} className="shrink-0 rotate-45 opacity-60" />}
      {activeId === p.id && !p.pinned && !leftCollapsed && (
        <button
          className="rounded p-0.5 text-muted hover:bg-raised hover:text-danger"
          title={t("Close tab")}
          onClick={(e) => {
            e.stopPropagation();
            void closeTab(p.id);
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );

  const renderGroup = (group: TabGroup, members: (typeof projects)[number][]) => {
    // A collapsed group hides its tabs — except the active one, so the current
    // workspace never vanishes from the bar.
    const visible = group.collapsed ? members.filter((m) => m.id === activeId) : members;
    return (
      <div
        key={group.id}
        data-testid="tab-group"
        className={`flex shrink-0 ${vertical ? "flex-col" : "items-center"}`}
        style={vertical && !leftCollapsed ? { borderLeft: `2px solid ${group.color}` } : !vertical ? { borderBottom: `2px solid ${group.color}` } : undefined}
      >
        <button
          onClick={() => tabGroups.toggleCollapse(group.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            groupMenu(e, group.id);
          }}
          title={`${group.name} — ${t("click to collapse · right-click for options")}`}
          className={`flex shrink-0 items-center text-xs font-medium ${
            vertical ? (leftCollapsed ? "mx-1 my-0.5 h-8 justify-center rounded-lg px-0" : "gap-1 border-b border-edge px-2 py-1.5") : "h-full gap-1 border-r border-edge px-2"
          }`}
          style={{ color: group.color, borderRadius: "var(--lx-tab-radius)" }}
        >
<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-3xs leading-none" style={{ borderColor: group.color }}>
            {group.collapsed ? "+" : "−"}
          </span>
          {!leftCollapsed && <Layers size={11} className="shrink-0" />}
          {!leftCollapsed && <span className="max-w-28 truncate">{group.name}</span>}
          {group.collapsed && !leftCollapsed && (
            <span className="rounded px-1 text-3xs text-black" style={{ backgroundColor: group.color }}>
              {members.length}
            </span>
          )}
        </button>
        {visible.map(renderTab)}
      </div>
    );
  };

  return (
    <div
      className={`lx-anim-topbar relative flex shrink-0 bg-bar text-sm ${
        vertical
          ? `h-full flex-col overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${leftOpen ? "border-r border-edge" : ""}`
          : "w-full items-center border-b border-edge"
      }`}
      style={vertical ? { width: leftOpen ? (leftCollapsed ? collapsedSidebarWidth : "var(--lx-sidebar-w, " + sidebarWidth + "px)") : 0 } : { height: topbarSize }}
      data-testid="topbar"
      aria-hidden={vertical && !leftOpen}
      role={!vertical ? "tablist" : undefined}
      aria-label={!vertical ? t("Project tabs and navigation") : undefined}
      onKeyDown={!vertical ? (e) => {
        // Arrow-key navigation between toolbar buttons (roving focus)
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const container = e.currentTarget;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>('button:not([disabled]), [role="button"]:not([disabled]), [role="tab"]'),
        ).filter((el) => el.offsetParent !== null);
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        if (idx < 0) return;
        e.preventDefault();
        const next = e.key === "ArrowRight" ? (idx + 1) % focusables.length : (idx - 1 + focusables.length) % focusables.length;
        focusables[next]?.focus();
      } : undefined}
    >
      {vertical && leftCollapsed && (
        <button
          className="lx-square-btn mx-auto my-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-strong"
          title={t("Expand left sidebar")}
          aria-label={t("Expand left sidebar")}
          onClick={() => config && void saveConfig({ ...config, ui: { ...config.ui, left_sidebar_collapsed: false } })}
        >
          <PanelLeft size={15} />
        </button>
      )}

      {/* Top-bar nav buttons aligned to the LEFT, before the project tabs. */}
      {!vertical &&
        (navGroups.left.length > 0 || navDragId) &&
        renderAlignZone(navGroups.left, "topbar-left", t("Left"), "topbar-left-zone", "shrink-0 pl-1")}

      {/* Top-bar nav buttons CENTERED over the bar. Absolutely positioned so it
          never disturbs the tab strip's flex layout; only the inner chip is
          interactive (pointer-events), the full-width wrapper is click-through. */}
      {!vertical && (navGroups.center.length > 0 || navDragId) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-full items-center justify-center">
          <div className="pointer-events-auto">
            {renderAlignZone(
              navGroups.center,
              "topbar-center",
              t("Center"),
              "topbar-center-zone",
              `rounded-lg px-1 ${navGroups.center.length > 0 ? "bg-bar/90 shadow-sm" : ""}`,
            )}
          </div>
        </div>
      )}

      {/* Project tabs */}
      <div
        ref={tabStripRef}
        className={`flex min-w-0 ${
          vertical
            ? // A fixed tab_strip_height overrides flex-1 (the strip no longer
              // grows to fill; the nav stack below reclaims the freed space).
              // 0 keeps the original automatic flex-1 behavior.
              `${tabStripHeight > 0 ? "flex-none" : "flex-1"} lx-no-scrollbar min-h-[7.5rem] flex-col overflow-y-auto`
            : "flex-1 lx-no-scrollbar lx-tab-overflow items-center overflow-x-auto"
        }`}
        style={vertical && tabStripHeight > 0 ? { height: `${tabStripHeight}px`, flexBasis: "auto" } : undefined}
        data-testid="tab-strip"
        data-overflow-left={(!vertical && tabEdges.start) || undefined}
        data-overflow-right={(!vertical && tabEdges.end) || undefined}
      >
        {vertical && <ScrollFade edge="top" on={tabEdges.start} />}
        {tabLayout.map((item) =>
          item.kind === "tab" ? renderTab(item.project) : renderGroup(item.group, item.tabs),
        )}

        {/* Add tab */}
        <span className="relative" ref={addMenuRef}>
          <button
            data-testid="tab-add"
            onClick={(e) => {
              // Anchor the menu with fixed coordinates computed from the button
              // rect so it escapes the tab strip's `overflow` clipping and never
              // ends up hidden behind other UI. (vertical sidebar → open to the
              // right; horizontal bar → open downward.)
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const top = vertical
                ? Math.min(r.top, window.innerHeight - 340)
                : r.bottom + 4;
              const left = vertical ? r.right + 6 : Math.max(8, r.left);
              setAddMenuPos({ top: Math.max(8, top), left });
              setAddMenu((v) => !v);
            }}
            title={t("Add tab")}
            // Fixed size in the vertical sidebar: a `display: flex` button with
            // `width: auto` stretches to the full width of its block container,
            // which turned this into a sidebar-wide strip.
            className={`lx-square-btn flex items-center justify-center text-muted hover:text-strong ${vertical ? "mx-1 my-0.5 h-8 w-8" : "mx-1 h-7 w-7"}`}
          >
            <Plus size={15} />
          </button>
          {addMenu && (
            <div
              data-testid="tab-add-menu"
              style={{ position: "fixed", top: addMenuPos.top, left: addMenuPos.left, zIndex: "var(--lx-z-sticky)" }}
              className="lx-pop-in w-56 rounded-lg border border-edge bg-bar p-1 shadow-xl"
            >
              <AddItem
                icon={FolderPlus}
                label={t("Open folder…")}
                onClick={() => {
                  setAddMenu(false);
                  void addProject();
                }}
              />
              <AddItem
                icon={LayoutGrid}
                label={t("Blank workspace")}
                onClick={() => {
                  setAddMenu(false);
                  void addBlank();
                }}
              />
              {activeId && (
                <AddItem
                  icon={FolderPlus}
                  label={t("New group from active tab")}
                  onClick={() => {
                    setAddMenu(false);
                    createGroupFromTab(activeId);
                  }}
                />
              )}
              {recents.length > 0 && (
                <>
                  <div className="mt-1 flex items-center gap-1.5 border-t border-edge px-2 pb-0.5 pt-1.5 text-3xs font-semibold uppercase tracking-wide text-muted">
                    <History size={11} /> {t("Recent projects")}
                  </div>
                  {recents.map((r) => (
                    <div
                      key={r.path}
                      className="group flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-raised"
                    >
                      {r.path_exists ? (
                        <FolderGit2 size={13} className="shrink-0 text-muted" />
                      ) : (
                        <TriangleAlert size={13} className="shrink-0 text-warning" />
                      )}
                      <button
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!r.path_exists}
                        title={r.path_exists ? r.path : `${r.path} — ${t("folder not found")}`}
                        onClick={() => void reopenRecent(r)}
                      >
                        <span className="block truncate text-strong">{r.name}</span>
                        <span className="block truncate text-3xs text-muted">{r.path}</span>
                      </button>
                      <button
                        className="shrink-0 text-muted opacity-0 hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                        title={t("Remove from recents")}
                        onClick={() => {
                          void ipc.recentDelete(r.path).then(() =>
                            setRecents((list) => list.filter((x) => x.path !== r.path)),
                          );
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </span>
        {!vertical && <div className="h-full min-w-8 flex-1" data-tauri-drag-region />}
        {vertical && <ScrollFade edge="bottom" on={tabEdges.end} />}
      </div>

      {/* Draggable divider between the project-tab strip and the nav-button
          stack (vertical, expanded mode only). Dragging fixes the strip height
          via startTabStripResize; 0 = automatic. Hidden when collapsed since the
          strip and stack collapse into icon rows. */}
      {vertical && !leftCollapsed && (
        <div
          className="group relative z-10 flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-transparent hover:bg-muted/40"
          onPointerDown={startTabStripResize}
          title={t("Drag to resize tab area")}
          data-testid="tab-strip-resize"
        >
          <span className="h-px w-8 rounded bg-edge group-hover:bg-muted" />
        </div>
      )}

      {/* Quick actions + nav buttons.
          In the vertical sidebar this stack shares the height with the project
          tabs above it. It sizes to its content so every button fits whenever
          there is room; on short windows the tab strip bottoms out at its
          min-height and THIS stack is the one that shrinks and scrolls — so a
          full stack still can never squeeze the project tabs out of the
          sidebar. The horizontal bar keeps `shrink-0`: its overflow is handled
          by the capacity-based "⋯" menu instead of scrolling. */}
      <div
        ref={navStackRef}
        className={`flex ${
          vertical
            ? "lx-no-scrollbar min-h-0 shrink flex-col items-stretch gap-0.5 overflow-y-auto border-t border-edge p-1"
            : "shrink-0 items-center gap-0.5 pr-1"
        }`}
        data-testid="nav-buttons"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) navContextMenu(e);
        }}
        onDragOver={(e) => {
          if (!navDragId) return;
          e.preventDefault();
          setNavDragOverId("topbar-zone");
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setNavDragOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (navDragId) onNavDrop(null);
        }}
      >
        {vertical && <ScrollFade edge="top" on={navEdges.start} />}
        {/* "All tabs" list. Lives here rather than inside the strip: it used to
            be the strip's last child, so as soon as the tabs overflowed — the
            only time it appears — it was itself scrolled out of reach. */}
        {!vertical && (tabEdges.start || tabEdges.end) && (
          <span className="relative" ref={moreMenuRef}>
            <button
              data-testid="tab-more"
              className="lx-square-btn lx-more-tabs-btn flex h-7 w-7 items-center justify-center text-muted hover:text-strong"
              title={t("More tabs")}
              aria-label={t("More tabs")}
              onClick={() => setMoreMenu((v) => !v)}
            >
              <ChevronDown size={14} />
            </button>
            {moreMenu && (
              <div
                className="lx-pop-in absolute right-0 top-full z-[var(--lx-z-dropdown)] max-h-80 w-56 overflow-y-auto rounded-lg border border-edge bg-bar p-1 shadow-xl"
              >
                <div className="mb-1 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-muted">
                  {t("All tabs")}
                </div>
                {sortedProjects.map((p) => (
                  <button
                    key={p.id}
                    aria-current={activeId === p.id ? "page" : undefined}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-raised ${
                      activeId === p.id ? "bg-raised text-strong" : "text-muted"
                    }`}
                    onClick={() => {
                      setActive(p.id);
                      setMoreMenu(false);
                      // Scroll the tab into view in the strip
                      const strip = tabStripRef.current;
                      strip
                        ?.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(p.id)}"]`)
                        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
                    }}
                    onContextMenu={(e) => { e.preventDefault(); setMoreMenu(false); tabMenu(e, p.id); }}
                    title={p.path ?? t("Blank workspace")}
                  >
                    {p.icon ? (
                      <TabIcon stored={p.icon} />
                    ) : p.path === "" ? (
                      <LayoutGrid size={13} className="shrink-0 opacity-60" />
                    ) : (
                      <FolderGit2 size={13} className="shrink-0 opacity-60" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
                    {p.pinned && <Pin size={10} className="shrink-0 rotate-45 opacity-60" />}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
        {!vertical && <ChromeQuickActions compact />}
        {quickActionsHere && <QuickActions vertical={vertical} expanded={vertical && !leftCollapsed} />}
        {barNavShown.map((def) => renderNavBtn(def, "topbar"))}
        {barNavHidden.length > 0 && (
          <span className="relative">
            <button
              data-nav-more
              data-testid="nav-more"
              title={`${t("More buttons")} (${barNavHidden.length})`}
              aria-label={`${t("More buttons")} (${barNavHidden.length})`}
              aria-haspopup="menu"
              className="lx-square-btn lx-toolbar-item flex h-7 w-7 items-center justify-center text-muted hover:text-strong"
              onClick={(e) =>
                openContextMenu(
                  e,
                  barNavHidden.map((def) => ({
                    label: def.label,
                    icon: def.icon,
                    onClick: () => runNavAction(def.id),
                  })),
                )
              }
              onContextMenu={(e) => navContextMenu(e)}
              onDragOver={(e) => navDragId && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavDropZone(null, "topbar");
              }}
            >
              <MoreHorizontal size={15} />
            </button>
          </span>
        )}
        {!vertical && <WindowControls />}
        {vertical && <ScrollFade edge="bottom" on={navEdges.end} />}
      </div>

      {/* Sidebar resize handle (kept off the buttons so it never eats their clicks) */}
      {vertical && leftOpen && (
        <div
          className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-muted/40"
          onPointerDown={startResize}
          title={t("Drag to resize sidebar")}
          data-testid="sidebar-resize"
        />
      )}
    </div>
  );
}

/**
 * Gradient hint pinned to the top/bottom edge of a scrollable sidebar stack,
 * shown while there is content past that edge. Rendered as a sticky first/last
 * child of the scroll container itself — see `.lx-scroll-fade` for why it is
 * not a mask on the container.
 */
function ScrollFade({ edge, on }: { edge: "top" | "bottom"; on: boolean }) {
  return <span aria-hidden data-on={on || undefined} className={`lx-scroll-fade lx-scroll-fade-${edge}`} />;
}

function AddItem(props: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-strong hover:bg-raised"
    >
      <props.icon size={14} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

/** A nav button: icon-only in the horizontal bar, full-width icon+label in the sidebar. */
function NavBtn(props: {
  def: NavButtonDef;
  vertical: boolean;
  collapsed: boolean;
  dropTarget: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  hotkey?: string;
}) {
  const { def } = props;
  const title = props.hotkey ? `${def.title} (${props.hotkey})` : def.title;
  return (
    <button
      draggable
      data-nav-id={def.id}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      title={title}
      aria-label={title}
      className={`lx-square-btn lx-toolbar-item flex items-center text-muted hover:text-strong ${
        props.vertical ? (props.collapsed ? "mx-auto h-8 w-8 justify-center p-0" : "w-full min-w-0 gap-2 px-2.5 py-1.5 text-left") : "h-7 w-7 justify-center"
      } ${
        props.dropTarget
          ? props.vertical
            ? "shadow-[inset_0_2px_0_0_var(--lx-muted)]"
            : "shadow-[inset_2px_0_0_0_var(--lx-muted)]"
          : ""
      }`}
    >
      <def.icon size={16} className="shrink-0" />
      {props.vertical && !props.collapsed && <span className="min-w-0 flex-1 truncate text-xs">{def.label}</span>}
    </button>
  );
}

function PresetMenu(props: {
  presets: LayoutPreset[];
  vertical: boolean;
  onApply: (p: LayoutPreset) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div
      className={`lx-pop-in absolute z-[var(--lx-z-dropdown)] w-64 rounded-lg border border-edge bg-bar p-2 shadow-xl ${
        props.vertical ? "bottom-0 left-full ml-1" : "right-0 top-full mt-1"
      }`}
    >
      <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t("Layout presets")}
      </div>
      {props.presets.length === 0 && (
        <div className="px-1 py-1 text-xs text-muted">{t("No presets saved yet.")}</div>
      )}
      {props.presets.map((p) => (
        <div key={p.id} className="group flex items-center rounded px-1 py-1 hover:bg-raised">
          <button className="flex-1 truncate text-left" onClick={() => props.onApply(p)}>
            {p.name}
          </button>
          <button
            className="hidden text-danger group-hover:block"
            onClick={() => props.onDelete(p.id)}
            title={t("Delete preset")}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-1 border-t border-edge pt-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && props.onSave(name.trim())}
          placeholder={t("Save current as…")}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2 py-1 text-xs outline-none focus:border-muted"
        />
        <button
          disabled={!name.trim()}
          onClick={() => props.onSave(name.trim())}
          className="rounded bg-raised border border-edge px-2 py-1 text-xs text-strong disabled:opacity-40"
        >
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

/**
 * TopBar is mounted statically in App's root render. Memoizing it means an
 * unrelated root re-render (e.g. a settings save the root now selects on) no
 * longer re-renders the whole tab bar — it only re-renders when `vertical`
 * actually flips. Its own store subscriptions still drive internal updates.
 */
export const TopBar = memo(TopBarImpl);
