/**
 * Workbench side bar (VS Code's "primary side bar"): the project's file tree
 * and project search, docked to the left of the editor area.
 *
 * It lives outside dockview on purpose — it is always in the same place, cannot
 * be dragged into an editor group by accident and is shared by every project
 * tab (it follows the active project). Ctrl+B hides it, Ctrl+Shift+E /
 * Ctrl+Shift+F show the matching view and move focus into it, and the right
 * edge drags to resize (double-click resets the width).
 */

import { Files, PanelLeftClose, Search } from "lucide-react";
import { lazy, memo, Suspense, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { hintFor } from "@/lib/hotkeys";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/state/appStore";
import { useProjectsStore } from "@/state/projectsStore";
import {
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
  useWorkbenchStore,
  type SidebarView,
} from "@/state/workbenchStore";

// Code-split like the dock panels: the tree pulls in virtua and a fair amount
// of source; search is only needed once the user switches to it.
const FilesPanel = lazy(() => import("@/panels/FilesPanel").then((m) => ({ default: m.FilesPanel })));
const SearchPanel = lazy(() => import("@/panels/SearchPanel").then((m) => ({ default: m.SearchPanel })));

function SidebarFallback() {
  return (
    <div className="lx-panel-skeleton h-full w-full">
      <div className="lx-panel-skeleton-line" style={{ width: "55%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "80%" }} />
      <div className="lx-panel-skeleton-line" style={{ width: "65%" }} />
    </div>
  );
}

function ExplorerSidebarImpl() {
  const t = useT();
  const open = useWorkbenchStore((s) => s.sidebarOpen);
  const view = useWorkbenchStore((s) => s.sidebarView);
  const width = useWorkbenchStore((s) => s.sidebarWidth);
  const focusSeq = useWorkbenchStore((s) => s.focusSeq);
  const config = useAppStore((s) => s.config);
  // Only for a project with a folder: the Welcome screen and blank workspaces
  // have no files to show (their Files tab offers to attach a folder).
  const hasFolder = useProjectsStore((s) => s.projects.some((p) => p.id === s.activeId && p.path !== ""));
  const asideRef = useRef<HTMLElement>(null);

  // Focus requests for the search view (the tree handles its own).
  useEffect(() => {
    if (focusSeq === 0 || view !== "search") return;
    const id = requestAnimationFrame(() =>
      asideRef.current?.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, [focusSeq, view]);

  if (!open || !hasFolder) return null;

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const aside = asideRef.current;
    if (!aside) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = aside.getBoundingClientRect().width;
    let latest = startW;
    document.body.classList.add("lx-col-resizing");
    const onMove = (ev: PointerEvent) => {
      latest = clampSidebarWidth(startW + ev.clientX - startX);
      // Direct style write while dragging: no React render per pointer move.
      aside.style.width = `${latest}px`;
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("lx-col-resizing");
      useWorkbenchStore.getState().setSidebarWidth(latest);
      aside.style.width = "";
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const tab = (id: SidebarView, label: string, Icon: typeof Files, action: string) => {
    const hint = hintFor(action, config);
    const title = hint ? `${label} (${hint})` : label;
    const active = view === id;
    return (
      <button
        key={id}
        role="tab"
        aria-selected={active}
        data-testid={`sidebar-tab-${id}`}
        title={title}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
          active ? "bg-raised font-medium text-strong" : "text-muted hover:bg-raised/60 hover:text-strong"
        }`}
        onClick={() => useWorkbenchStore.getState().showSidebar(id)}
      >
        <Icon size={13} className={active ? "text-accent" : undefined} />
        {label}
      </button>
    );
  };

  const toggleHint = hintFor("sidebar.toggle", config);

  return (
    <aside
      ref={asideRef}
      className="lx-workbench-sidebar lx-anim-side-panel relative flex shrink-0 flex-col border-r border-edge bg-bar"
      // The dock always keeps the larger share of narrow windows.
      style={{ width: `min(${width}px, max(${180}px, 42vw))` }}
      data-testid="workbench-sidebar"
      aria-label={t("Side bar")}
    >
      <div className="flex h-[42px] shrink-0 items-center gap-0.5 px-1.5" role="tablist" aria-label={t("Side bar views")}>
        {tab("explorer", t("Explorer"), Files, "files.open")}
        {tab("search", t("Search"), Search, "search.open")}
        <span className="flex-1" />
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-strong"
          title={toggleHint ? `${t("Hide side bar")} (${toggleHint})` : t("Hide side bar")}
          aria-label={t("Hide side bar")}
          data-testid="sidebar-hide"
          onClick={() => useWorkbenchStore.getState().setSidebarOpen(false)}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        <Suspense fallback={<SidebarFallback />}>
          {view === "explorer" ? <FilesPanel variant="sidebar" /> : <SearchPanel compact />}
        </Suspense>
      </div>
      <div
        className="lx-sidebar-resize absolute -right-[3px] top-0 z-[var(--lx-z-local)] h-full w-1.5 cursor-col-resize"
        onPointerDown={startResize}
        onDoubleClick={() => useWorkbenchStore.getState().setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
        title={t("Drag to resize · double-click to reset")}
        data-testid="sidebar-resize-handle"
      />
    </aside>
  );
}

/** No props: re-renders only from its own store subscriptions. */
export const ExplorerSidebar = memo(ExplorerSidebarImpl);
