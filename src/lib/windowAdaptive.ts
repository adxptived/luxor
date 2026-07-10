/**
 * Window adaptiveness: responsive layout for small windows.
 *
 * Tracks the window size and provides breakpoint helpers so the UI can
 * adapt: hide side panels, collapse the nav rail, switch to compact mode,
 * and adjust the dock layout for narrow windows.
 */

export type WindowSize = "compact" | "narrow" | "normal" | "wide";

export interface WindowBreakpoints {
  size: WindowSize;
  width: number;
  height: number;
  /** Whether the window is too small for side panels. */
  compact: boolean;
  /** Whether the nav rail should be icon-only. */
  iconOnly: boolean;
  /** Whether to hide the status bar. */
  hideStatusBar: boolean;
  /** Whether to hide the right panel. */
  hideRightPanel: boolean;
  /** Whether to hide the left sidebar. */
  hideLeftSidebar: boolean;
}

const BREAKPOINTS = {
  compact: 700,
  narrow: 900,
  normal: 1200,
};

/** Compute breakpoints from a window width. */
export function computeBreakpoints(width: number, height: number): WindowBreakpoints {
  let size: WindowSize = "wide";
  if (width < BREAKPOINTS.compact) size = "compact";
  else if (width < BREAKPOINTS.narrow) size = "narrow";
  else if (width < BREAKPOINTS.normal) size = "normal";

  return {
    size,
    width,
    height,
    compact: width < BREAKPOINTS.compact,
    iconOnly: width < BREAKPOINTS.narrow,
    hideStatusBar: width < BREAKPOINTS.compact && height < 500,
    hideRightPanel: width < BREAKPOINTS.narrow,
    hideLeftSidebar: width < BREAKPOINTS.compact,
  };
}

// ---------------------------------------------------------------------------
// Compact mode
// ---------------------------------------------------------------------------

const COMPACT_KEY = "luxor.compactMode";

export type CompactMode = "auto" | "always" | "never";

export function getCompactMode(): CompactMode {
  try {
    return (localStorage.getItem(COMPACT_KEY) as CompactMode) ?? "auto";
  } catch {
    return "auto";
  }
}

export function setCompactMode(mode: CompactMode): void {
  try {
    localStorage.setItem(COMPACT_KEY, mode);
  } catch { /* best effort */ }
}

/** Determine if compact mode should be active given the user preference and window size. */
export function shouldUseCompactMode(width: number): boolean {
  const mode = getCompactMode();
  if (mode === "always") return true;
  if (mode === "never") return false;
  return width < BREAKPOINTS.compact;
}

// ---------------------------------------------------------------------------
// Multi-window support
// ---------------------------------------------------------------------------

export interface WindowInstance {
  id: string;
  label: string;
  /** Whether this is the main window. */
  isMain: boolean;
  /** Window bounds. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOWS_KEY = "luxor.windows";

/** Load known window instances from localStorage. */
export function loadWindows(): WindowInstance[] {
  try {
    const raw = localStorage.getItem(WINDOWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save window instances to localStorage. */
export function saveWindows(windows: WindowInstance[]): void {
  try {
    localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows));
  } catch { /* best effort */ }
}