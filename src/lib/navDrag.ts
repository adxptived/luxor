import { create } from "zustand";

import { moveNavButton } from "./navButtons";
import { useAppStore } from "@/state/appStore";
import type { AppConfig } from "./types";

/**
 * Where a nav button lives.
 *   - sidebar         → the vertical left action rail
 *   - topbar          → the horizontal top bar, right-aligned (the default)
 *   - topbar-left     → top bar, left of the project tabs
 *   - topbar-center   → top bar, horizontally centered
 *   - topbar-right    → top bar, right-aligned (explicit alias of "topbar")
 *   - chrome          → the window corner, beside the OS window controls
 *   - hidden          → not shown anywhere
 * Buttons that are in the top bar but listed in neither the left nor center
 * alignment arrays fall back to the right-aligned group, so "topbar" and
 * "topbar-right" are equivalent.
 */
export type NavZone =
  | "sidebar"
  | "topbar"
  | "topbar-left"
  | "topbar-center"
  | "topbar-right"
  | "chrome"
  | "hidden";

interface NavDragState {
  dragId: string | null;
  setDragId: (dragId: string | null) => void;
}

/** Shared nav-button drag state so topbar, sidebar and chrome can accept drops
 *  from each other. Local component state breaks cross-zone drops because the
 *  target zone cannot see the source zone's dragged id. */
export const useNavDragStore = create<NavDragState>((set) => ({
  dragId: null,
  setDragId: (dragId) => set({ dragId }),
}));

function saveNavConfig(buildNext: (config: AppConfig) => AppConfig) {
  const { config, saveConfig } = useAppStore.getState();
  if (!config) return;
  void saveConfig(buildNext(config));
}

export function moveNavToZone(id: string, zone: NavZone) {
  saveNavConfig((config) => {
    const without = (arr?: string[]) => (arr ?? []).filter((x) => x !== id);
    // A button can only live in one place: strip it from every zone array first.
    const hidden = without(config.ui.nav_hidden);
    const chrome = without(config.ui.nav_chrome);
    const sidebar = without(config.ui.nav_sidebar);
    const topbarLeft = without(config.ui.nav_topbar_left);
    const topbarCenter = without(config.ui.nav_topbar_center);

    if (zone === "hidden") hidden.push(id);
    else if (zone === "chrome") chrome.push(id);
    else if (zone === "sidebar") sidebar.push(id);
    else if (zone === "topbar-left") topbarLeft.push(id);
    else if (zone === "topbar-center") topbarCenter.push(id);
    // "topbar" / "topbar-right" → default right-aligned group: no array entry.

    return {
      ...config,
      ui: {
        ...config.ui,
        nav_hidden: hidden,
        nav_chrome: chrome,
        nav_sidebar: sidebar,
        nav_topbar_left: topbarLeft,
        nav_topbar_center: topbarCenter,
      },
    };
  });
}

export function nextNavDropConfig(
  ui: Pick<
    AppConfig["ui"],
    "nav_order" | "nav_hidden" | "nav_sidebar" | "nav_chrome" | "nav_topbar_left" | "nav_topbar_center"
  >,
  dragId: string,
  targetId: string | null,
  targetZone: NavZone,
) {
  let { nav_order, nav_hidden, nav_sidebar, nav_chrome, nav_topbar_left, nav_topbar_center } = ui;
  nav_order = nav_order ?? [];
  nav_hidden = (nav_hidden ?? []).filter((x) => x !== dragId);
  nav_chrome = (nav_chrome ?? []).filter((x) => x !== dragId);
  nav_sidebar = (nav_sidebar ?? []).filter((x) => x !== dragId);
  nav_topbar_left = (nav_topbar_left ?? []).filter((x) => x !== dragId);
  nav_topbar_center = (nav_topbar_center ?? []).filter((x) => x !== dragId);

  if (targetZone === "hidden") nav_hidden.push(dragId);
  else if (targetZone === "chrome") nav_chrome.push(dragId);
  else if (targetZone === "sidebar") nav_sidebar.push(dragId);
  else if (targetZone === "topbar-left") nav_topbar_left.push(dragId);
  else if (targetZone === "topbar-center") nav_topbar_center.push(dragId);
  // "topbar" / "topbar-right" → default right-aligned group: no array entry.

  if (targetId && targetId !== dragId) {
    nav_order = moveNavButton(nav_order, dragId, targetId);
  }

  return { nav_order, nav_hidden, nav_sidebar, nav_chrome, nav_topbar_left, nav_topbar_center };
}

export function handleNavDrop(dragId: string, targetId: string | null, targetZone: NavZone) {
  saveNavConfig((config) => ({
    ...config,
    ui: {
      ...config.ui,
      ...nextNavDropConfig(config.ui, dragId, targetId, targetZone),
    },
  }));
}
