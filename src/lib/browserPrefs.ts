/**
 * Built-in browser preferences (persisted in localStorage).
 *
 * Many sites refuse to render inside an iframe (X-Frame-Options /
 * frame-ancestors), so the panel supports two modes:
 *   - "embedded": load in the in-panel iframe, fall back on failure
 *   - "window":   always open in the dedicated native app window
 */

export type BrowserMode = "embedded" | "window";

const KEY = "luxor.browserMode";

export function loadBrowserMode(): BrowserMode {
  // Default is "window": most major sites (Google, YouTube, GitHub, …) refuse
  // to render inside an iframe, which made the embedded mode look broken.
  try {
    const v = localStorage.getItem(KEY);
    return v === "embedded" ? "embedded" : "window";
  } catch {
    return "window";
  }
}

export function saveBrowserMode(mode: BrowserMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage unavailable (private mode etc.) — mode just won't persist.
  }
}

/**
 * Browser session (last URL + history) persisted across panel re-mounts.
 *
 * The browser panel lives inside dockview: dragging the tab, toggling the
 * panel, switching projects or restoring a layout re-creates the React
 * component, and before this existed all in-flight state (the loaded page,
 * back/forward history, address bar) silently reset to the start page — the
 * "browser randomly loses my page" bug. Persisting the session makes a
 * re-mounted panel pick up exactly where it left off, like a real browser.
 */
export interface BrowserSession {
  url: string | null;
  entries: string[];
  index: number;
}

const SESSION_KEY = "luxor.browserSession";
/** Cap stored history so localStorage never grows unbounded. */
const MAX_SESSION_ENTRIES = 50;

export function loadBrowserSession(): BrowserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const s = v as Partial<BrowserSession>;
    const entries = Array.isArray(s.entries) ? s.entries.filter((e) => typeof e === "string") : [];
    const index = typeof s.index === "number" && s.index >= -1 && s.index < entries.length ? s.index : entries.length - 1;
    const url = typeof s.url === "string" && s.url ? s.url : null;
    return { url, entries, index };
  } catch {
    return null;
  }
}

export function saveBrowserSession(session: BrowserSession): void {
  try {
    const drop = Math.max(0, session.entries.length - MAX_SESSION_ENTRIES);
    const entries = session.entries.slice(drop);
    const index = Math.min(Math.max(-1, session.index - drop), entries.length - 1);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ url: session.url, entries, index }));
  } catch {
    // best effort
  }
}

export function clearBrowserSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // best effort
  }
}
