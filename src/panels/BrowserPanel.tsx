/** Built-in web browser.
 *
 *  In the Tauri desktop app the page is rendered by a **real native child
 *  webview** (see `src-tauri/.../commands/browser.rs`) that is overlaid on the
 *  panel's viewport. Because that webview loads pages as top-level documents —
 *  exactly like a normal browser tab — `X-Frame-Options` / CSP
 *  `frame-ancestors` never apply, so Google, YouTube, GitHub, Reddit & co. all
 *  load inline instead of dead-ending on "refused to connect". No iframe, no
 *  framing rules, no per-site blocklist.
 *
 *  When running outside Tauri (plain `vite dev` in a normal browser, where no
 *  native webview exists) we fall back to the legacy sandboxed `<iframe>` path,
 *  which keeps the dev preview usable. The pure URL/history helpers below are
 *  shared by both paths and unit-tested directly.
 */

import {
  AppWindow,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  House,
  Loader2,
  PanelTop,
  RotateCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  clearBrowserSession,
  loadBrowserMode,
  loadBrowserSession,
  saveBrowserMode,
  saveBrowserSession,
  type BrowserMode,
} from "@/lib/browserPrefs";

import * as ipc from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";

/** Normalize user input into a loadable URL (adds https://, search fallback). */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  // Developer servers are overwhelmingly plain HTTP, not HTTPS. Without this,
  // entering `localhost:5173` from the Dev Tools/browser workflow becomes a
  // DuckDuckGo search or an HTTPS request that local Vite/Tauri servers reject.
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#].*)?$/i.test(raw)) {
    return `http://${raw}`;
  }
  // Bare host:port (e.g. `my-device.local:8080`) is also a likely local/dev URL.
  if (!raw.includes(" ") && /^[a-z0-9.-]+:\d+(?:[/?#].*)?$/i.test(raw)) return `http://${raw}`;
  // Looks like a domain (has a dot, no spaces) → assume https.
  if (!raw.includes(" ") && raw.includes(".")) return `https://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

/** Rewrite URLs that block framing to their embeddable equivalents (iframe
 *  fallback only — the native webview plays youtube.com/watch directly). */
export function toEmbeddable(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (u.pathname === "/watch" && v) return `https://www.youtube.com/embed/${v}`;
      if (u.pathname.startsWith("/shorts/"))
        return `https://www.youtube.com/embed/${u.pathname.split("/")[2] ?? ""}`;
    }
    if (host === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    return url;
  } catch {
    return url;
  }
}

/** Sites known to refuse iframe embedding (iframe fallback only). */
const KNOWN_BLOCKED = [
  "duckduckgo.com",
  "google.com",
  "bing.com",
  "yandex.ru",
  "yandex.com",
  "ecosia.org",
  "startpage.com",
  "youtube.com",
  "m.youtube.com",
  "accounts.google.com",
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "stackoverflow.com",
  "npmjs.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "linkedin.com",
  "tiktok.com",
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "amazon.com",
  "netflix.com",
  "twitch.tv",
];

/** True when a URL almost certainly refuses to load inside an iframe. */
export function isLikelyBlocked(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if ((host === "youtube.com" || host === "m.youtube.com") && u.pathname.startsWith("/embed/"))
      return false;
    return KNOWN_BLOCKED.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return false;
  }
}

/** Where a navigation should render (iframe fallback). */
export type NavTarget = "embed" | "window";

export interface Navigation {
  url: string;
  target: NavTarget;
}

/** Decide how to open `input` for the given browser `mode` (iframe fallback). */
export function resolveNavigation(
  input: string,
  mode: BrowserMode,
  force = false,
): Navigation | null {
  const normalized = normalizeUrl(input);
  if (!normalized) return null;
  const url = toEmbeddable(normalized);
  if (force) return { url, target: "embed" };
  if (mode === "window") return { url, target: "window" };
  return { url, target: isLikelyBlocked(url) ? "window" : "embed" };
}

/** Favicon URL for the site behind `url` (privacy-friendly DuckDuckGo service).
 *  Returns null for non-web URLs (e.g. about:blank, file://) so the caller can
 *  fall back to a generic globe icon. */
export function faviconUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
  } catch {
    return null;
  }
}

/** Linear browsing history with a cursor (like a real browser's back/forward). */
export interface History {
  entries: string[];
  index: number;
}

export const EMPTY_HISTORY: History = { entries: [], index: -1 };

export function pushHistory(h: History, url: string): History {
  if (h.index >= 0 && h.entries[h.index] === url) return h;
  const entries = h.entries.slice(0, h.index + 1);
  entries.push(url);
  return { entries, index: entries.length - 1 };
}

export function canGoBack(h: History): boolean {
  return h.index > 0;
}

export function canGoForward(h: History): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

export function stepHistory(h: History, delta: number): History {
  const next = h.index + delta;
  if (next < 0 || next >= h.entries.length) return h;
  return { ...h, index: next };
}

const QUICK_LINKS: { label: string; url: string }[] = [
  { label: "YouTube", url: "https://www.youtube.com" },
  { label: "DuckDuckGo", url: "https://duckduckgo.com" },
  { label: "Wikipedia", url: "https://www.wikipedia.org" },
  { label: "GitHub", url: "https://github.com" },
  { label: "skills.sh", url: "https://skills.sh" },
];

const EMBED_LOAD_TIMEOUT_MS = 4000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Is `el` actually on-screen (not display:none, sized, and not inside an
 *  inactive/aria-hidden project dock)? Drives whether the native overlay shows. */
function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false; // display:none somewhere above
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest('[aria-hidden="true"]')) return false; // inactive project dock
  return true;
}

const iconBtn =
  "rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30 disabled:hover:bg-transparent";

/** Address-bar leading icon: spinner while loading, the live site favicon once
 *  a page is loaded, or a generic globe as a fallback. */
function SiteIcon({ url, loading }: { url: string | null; loading: boolean }) {
  const [failed, setFailed] = useState(false);
  const fav = url ? faviconUrl(url) : null;
  // Reset the error flag whenever the page changes so a new favicon is tried.
  useEffect(() => setFailed(false), [fav]);
  if (loading) return <Loader2 size={14} className="ml-0.5 shrink-0 animate-spin text-accent" />;
  if (fav && !failed)
    return (
      <img
        src={fav}
        alt=""
        width={15}
        height={15}
        className="ml-0.5 shrink-0 rounded-sm"
        onError={() => setFailed(true)}
        draggable={false}
      />
    );
  return <Globe size={14} className="ml-0.5 shrink-0 text-accent" />;
}

/* -------------------------------------------------------------------------- */
/*  Native browser (Tauri): real child webview overlaid on the panel          */
/* -------------------------------------------------------------------------- */

function NativeBrowser() {
  const toast = useAppStore((s) => s.toast);
  // Any full-screen overlay hides the native webview (it always paints above
  // the host DOM, so it would otherwise cover modals/menus).
  const overlayOpen = useAppStore(
    (s) => Boolean(s.paletteOpen) || Boolean(s.settingsOpen),
  );
  const menuOrDialog = useUiStore((s) => Boolean(s.menu) || Boolean(s.dialog));
  const suppress = overlayOpen || menuOrDialog;

  // Restore the last session so re-mounting the panel (tab drag, layout
  // restore, project switch) does not lose the loaded page.
  const restored = useRef(loadBrowserSession()).current;
  const [input, setInput] = useState(restored?.url ?? "");
  const [currentUrl, setCurrentUrl] = useState<string | null>(restored?.url ?? null);
  const [loading, setLoading] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const desiredUrlRef = useRef<string | null>(restored?.url ?? null); // page we want loaded
  const shownRef = useRef(false); // is the native webview currently shown
  const lastBoundsRef = useRef(""); // last pushed "x,y,w,h" (skip no-op IPC)
  const suppressRef = useRef(suppress);
  const inputFocusedRef = useRef(false);
  // App (WebView2/WKWebView) zoom factor. The native child webview is placed in
  // the window's *logical* pixels, but getBoundingClientRect() reports CSS
  // pixels of the zoomed host page (1 CSS px = `zoom` logical px). Without
  // scaling by this factor the overlay sits offset / wrong-sized whenever the
  // app is zoomed — that is the "косо вписано" misalignment.
  const zoom = useAppStore((s) => s.config?.ui.zoom ?? 1);
  const zoomRef = useRef(zoom || 1);

  useEffect(() => {
    suppressRef.current = suppress;
  }, [suppress]);

  useEffect(() => {
    zoomRef.current = zoom || 1;
  }, [zoom]);

  // Navigate the embedded browser (address bar / quick link / home button).
  const go = (target?: string) => {
    const url = normalizeUrl(target ?? input);
    if (!url) return;
    desiredUrlRef.current = url;
    setInput(url);
    setCurrentUrl(url);
    setLoading(true);
    saveBrowserSession({ url, entries: [url], index: 0 });
    // If the webview is already up, navigate it now; otherwise the rAF loop
    // creates it at the right bounds with this URL on the next frame.
    if (shownRef.current) {
      ipc
        .browserEmbedNavigate(url)
        .catch((e) => toast(`${t("Navigation failed")}: ${errorMessage(e)}`, "error"));
    }
  };

  const goHome = () => {
    desiredUrlRef.current = null;
    shownRef.current = false;
    lastBoundsRef.current = "";
    setCurrentUrl(null);
    setInput("");
    setLoading(false);
    clearBrowserSession();
    // Hide immediately instead of waiting for the next bounds tick; this keeps
    // the Browser panel visually honest when the user presses Home.
    void ipc.browserEmbedHide().catch(() => {});
  };

  // Keep the native webview glued to the viewport rectangle without a
  // permanent 60fps rAF loop. Bounds are pushed on actual geometry changes
  // (ResizeObserver / window resize / scroll) plus a light 4Hz safety tick for
  // dock animations that do not always fire resize events. When the panel is
  // hidden/inactive or a modal/menu is open, the child webview is hidden so the
  // OS webview stops painting behind the app chrome.
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let observed: HTMLElement | null = null;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;

    const observeCurrent = () => {
      const el = viewportRef.current;
      if (el === observed) return;
      if (observed) ro?.unobserve(observed);
      observed = el;
      if (observed) ro?.observe(observed);
    };

    const hide = () => {
      if (!shownRef.current) return;
      shownRef.current = false;
      lastBoundsRef.current = "";
      ipc.browserEmbedHide().catch(() => {});
    };

    const update = () => {
      raf = 0;
      if (disposed) return;
      observeCurrent();
      const el = viewportRef.current;
      const wantUrl = desiredUrlRef.current;
      const visible = !!el && !!wantUrl && !suppressRef.current && isElementVisible(el);

      if (!visible || !el || !wantUrl) {
        hide();
        return;
      }

      const r = el.getBoundingClientRect();
      // Child webviews are positioned in the window's logical pixels relative to
      // the content area. getBoundingClientRect() returns CSS pixels of the
      // (possibly zoomed) host page, so scale by the active zoom factor to map
      // CSS px → logical px. At zoom 1 this is a no-op; at other zooms it keeps
      // the native webview pixel-aligned instead of skewed/offset.
      // Use floor/ceil on edges instead of rounded width/height: this
      // deliberately overdraws by <=1px and prevents white seams/shifted bottoms
      // on fractional DPI, zoom and dock animation frames.
      const z = zoomRef.current || 1;
      const x = Math.floor(r.left * z);
      const y = Math.floor(r.top * z);
      const w = Math.max(1, Math.ceil(r.right * z) - x);
      const h = Math.max(1, Math.ceil(r.bottom * z) - y);
      const key = `${x},${y},${w},${h}`;
      if (!shownRef.current) {
        shownRef.current = true;
        lastBoundsRef.current = key;
        ipc.browserEmbedShow(x, y, w, h, wantUrl).catch(() => {
          shownRef.current = false;
          lastBoundsRef.current = "";
        });
      } else if (key !== lastBoundsRef.current) {
        lastBoundsRef.current = key;
        ipc.browserEmbedSetBounds(x, y, w, h).catch(() => {});
      }
    };

    function schedule() {
      if (disposed || raf) return;
      raf = requestAnimationFrame(update);
    }

    const interval = window.setInterval(schedule, 250);
    window.addEventListener("resize", schedule);
    // Passive + capture: we only reposition the native overlay, never
    // preventDefault — passive keeps scrolling smooth.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("visibilitychange", schedule);
      ro?.disconnect();
      ipc.browserEmbedClose().catch(() => {});
    };
  }, []);

  // Mirror real navigation (link clicks, redirects, history.back) into the UI.
  useEffect(() => {
    let unlisten: ipc.Unlisten = () => {};
    let disposed = false;
    ipc
      .onBrowserNav((nav) => {
        desiredUrlRef.current = nav.url;
        setCurrentUrl(nav.url);
        setLoading(nav.loading);
        if (!inputFocusedRef.current) setInput(nav.url);
        // Keep the persisted session in sync with real navigation (link
        // clicks, redirects) so a re-mounted panel restores the actual page.
        if (!nav.loading && nav.url) saveBrowserSession({ url: nav.url, entries: [nav.url], index: 0 });
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  // Ctrl/Cmd+L jumps to and selects the address bar, like a real browser.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-surface text-sm"
      data-testid="browser-panel"
      onKeyDown={onPanelKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge px-2 py-1.5">
        <button
          className={iconBtn}
          title={t("Back")}
          disabled={!currentUrl}
          onClick={() => ipc.browserEmbedBack().catch(() => {})}
          data-testid="browser-back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className={iconBtn}
          title={t("Forward")}
          disabled={!currentUrl}
          onClick={() => ipc.browserEmbedForward().catch(() => {})}
          data-testid="browser-forward"
        >
          <ChevronRight size={16} />
        </button>
        <button
          className={iconBtn}
          title={t("Reload")}
          disabled={!currentUrl}
          onClick={() => ipc.browserEmbedReload().catch(() => {})}
        >
          <RotateCw size={14} />
        </button>
        <button
          className={iconBtn}
          title={t("Home")}
          disabled={!currentUrl}
          onClick={goHome}
          data-testid="browser-home"
         aria-label={t("Home")}>
          <House size={14} />
        </button>
        <SiteIcon url={currentUrl} loading={loading} />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-accent"
          placeholder={t("Search or enter address")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.currentTarget.blur();
              go();
            }
          }}
          onFocus={(e) => {
            inputFocusedRef.current = true;
            e.target.select();
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
          }}
          spellCheck={false}
        />
        <button className={iconBtn} title={t("Load")} onClick={() => go()}>
          <ArrowRight size={14} />
        </button>
        <button
          className={iconBtn}
          title={t("Open the current page in a separate app window")}
          disabled={!currentUrl}
          onClick={() =>
            currentUrl &&
            ipc
              .browserOpenWindow(currentUrl)
              .catch((e) => toast(`${t("Failed to open window")}: ${errorMessage(e)}`, "error"))
          }
        >
          <AppWindow size={14} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading && (
          // Thin indeterminate top progress bar — the native webview paints over
          // the panel, so this is the one load cue the host UI can still show.
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
            <div className="lx-browser-progress h-full w-1/3 bg-accent" />
          </div>
        )}
        {currentUrl ? (
          // Transparent placeholder the native webview is positioned over. A
          // subtle background keeps it from flashing white before the first
          // paint of the overlaid webview.
          <div ref={viewportRef} className="absolute inset-0 overflow-hidden bg-surface" data-testid="browser-viewport">
            {suppress && (
              <div className="flex h-full w-full items-center justify-center bg-surface text-xs text-muted">
                {t("Paused while a dialog is open")}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
            <Globe size={32} className="text-accent/60" />
            <div className="text-center">
              {t("Enter a URL or search above.")}
              <br />
              <span className="text-xs">
                {t("Pages load inline like a normal browser")} <ExternalLink size={11} className="inline" />.
              </span>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_LINKS.map((l) => (
                <button
                  key={l.url}
                  className="rounded border border-edge px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                  onClick={() => go(l.url)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Iframe browser (non-Tauri dev fallback)                                   */
/* -------------------------------------------------------------------------- */

function IframeBrowser() {
  const toast = useAppStore((s) => s.toast);
  // Restore the last session so re-mounting the panel (tab drag, layout
  // restore, project switch) does not lose the loaded page or history.
  // URLs that can't embed are restored into the "windowed" placeholder state
  // instead of the iframe, so a re-mount never auto-opens popup windows.
  const restored = useRef(loadBrowserSession()).current;
  const initialMode = useRef(loadBrowserMode()).current;
  const restoredEmbeddable =
    restored?.url != null && resolveNavigation(restored.url, initialMode)?.target === "embed";
  const [input, setInput] = useState(restored?.url ?? "");
  const [url, setUrl] = useState<string | null>(restoredEmbeddable ? (restored?.url ?? null) : null);
  const [epoch, setEpoch] = useState(0);
  const [windowed, setWindowed] = useState<string | null>(
    restored?.url && !restoredEmbeddable ? restored.url : null,
  );
  const [mode, setMode] = useState<BrowserMode>(initialMode);
  const [history, setHistory] = useState<History>(
    restored && restored.entries.length > 0 ? { entries: restored.entries, index: restored.index } : EMPTY_HISTORY,
  );
  const [loading, setLoading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+L jumps to and selects the address bar, like a real browser.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const switchMode = (next: BrowserMode) => {
    setMode(next);
    saveBrowserMode(next);
  };

  const openWindow = (target: string) => {
    setWindowed(target);
    setLoading(false);
    ipc
      .browserOpenWindow(target)
      .catch((e) => toast(`${t("Failed to open window")}: ${errorMessage(e)}`, "error"));
  };

  const go = (target?: string, force = false) => {
    const nav = resolveNavigation(target ?? input, mode, force);
    if (!nav) return;
    setInput(nav.url);
    setHistory((h) => {
      const next = pushHistory(h, nav.url);
      saveBrowserSession({ url: nav.url, entries: next.entries, index: next.index });
      return next;
    });
    if (nav.target === "window") {
      setUrl(nav.url);
      openWindow(nav.url);
      return;
    }
    setWindowed(null);
    setLoading(true);
    setUrl(nav.url);
    setEpoch((e) => e + 1);
  };

  const navStep = (delta: number) => {
    const next = stepHistory(history, delta);
    if (next === history) return;
    const dest = next.entries[next.index];
    setHistory(next);
    saveBrowserSession({ url: dest, entries: next.entries, index: next.index });
    setInput(dest);
    setWindowed(null);
    setLoading(true);
    setUrl(dest);
    setEpoch((e) => e + 1);
  };

  const goHome = () => {
    setUrl(null);
    setInput("");
    setWindowed(null);
    setLoading(false);
    clearBrowserSession();
  };

  useEffect(() => {
    if (!url || windowed) return;
    const target = url;
    const timer = window.setTimeout(() => openWindow(target), EMBED_LOAD_TIMEOUT_MS);
    const frame = frameRef.current;
    const onLoad = () => {
      try {
        const doc = frame?.contentDocument ?? null;
        if (doc && (doc.body?.childElementCount ?? 0) === 0) {
          openWindow(target);
          return;
        }
      } catch {
        // SecurityError: a genuine cross-origin page is in the frame. Success.
      }
      window.clearTimeout(timer);
      setLoading(false);
    };
    frame?.addEventListener("load", onLoad);
    return () => {
      window.clearTimeout(timer);
      frame?.removeEventListener("load", onLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, epoch, windowed]);

  return (
    <div
      className="flex h-full flex-col bg-surface text-sm"
      data-testid="browser-panel"
      onKeyDown={onPanelKeyDown}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-edge px-2 py-1.5">
        <button
          className={iconBtn}
          title={t("Back")}
          disabled={!canGoBack(history)}
          onClick={() => navStep(-1)}
          data-testid="browser-back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className={iconBtn}
          title={t("Forward")}
          disabled={!canGoForward(history)}
          onClick={() => navStep(1)}
          data-testid="browser-forward"
        >
          <ChevronRight size={16} />
        </button>
        <button
          className={iconBtn}
          title={t("Home")}
          disabled={!url}
          onClick={goHome}
          data-testid="browser-home"
         aria-label={t("Home")}>
          <House size={14} />
        </button>
        <SiteIcon url={url} loading={loading} />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-accent"
          placeholder={t("Search or enter address")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) go();
          }}
          onFocus={(e) => e.target.select()}
        />
        <button className={iconBtn} title={t("Load")} onClick={() => go()}>
          <ArrowRight size={14} />
        </button>
        <button
          className={iconBtn}
          title={t("Reload")}
          disabled={!url}
          onClick={() => {
            if (windowed) {
              openWindow(windowed);
            } else {
              setLoading(true);
              setEpoch((e) => e + 1);
            }
          }}
        >
          <RotateCw size={14} />
        </button>
        <button
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
            mode === "window"
              ? "border-muted bg-raised text-strong"
              : "border-edge text-muted hover:border-accent hover:text-accent"
          }`}
          title={
            mode === "window"
              ? t("Default: every site opens in a native app window (full compatibility). Click to load inside the panel instead.")
              : t("Click to always open sites in a native app window — fixes sites that refuse to embed.")
          }
          data-testid="browser-mode-toggle"
          onClick={() => switchMode(mode === "window" ? "embedded" : "window")}
        >
          {mode === "window" ? <AppWindow size={12} /> : <PanelTop size={12} />}
          {mode === "window" ? t("App window mode") : t("Embedded mode")}
        </button>
        <button
          className="flex items-center gap-1 rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-30"
          title={t("Open the current URL in a separate app window — works with every site (YouTube, etc.)")}
          disabled={!url}
          onClick={() => url && openWindow(url)}
        >
          <AppWindow size={12} /> {t("Open window")}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {windowed ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-muted"
            data-testid="browser-windowed"
          >
            <AppWindow size={32} className="text-accent/60" />
            <div>
              <div className="mb-1 font-medium text-strong">{t("Opened in a browser window")}</div>
              <span className="text-xs">
                {hostOf(windowed)} {t("refuses to be embedded (X-Frame-Options), so it opened in a real browser window — it works like a normal browser there.")}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded border border-accent px-3 py-1 text-xs text-accent hover:bg-accent/10"
                onClick={() => openWindow(windowed)}
              >
                {t("Reopen window")}
              </button>
              <button
                className="rounded border border-edge px-3 py-1 text-xs hover:text-strong"
                onClick={() => go(windowed, true)}
              >
                {t("Try to embed anyway")}
              </button>
            </div>
          </div>
        ) : url ? (
          <iframe
            key={`${url}#${epoch}`}
            ref={frameRef}
            src={url}
            title={t("Browser")}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            referrerPolicy="no-referrer"
          />
        ) : null}
        {url && !windowed && (
          <button
            className="absolute bottom-2 right-2 rounded border border-edge bg-bar/90 px-2 py-1 text-2xs text-muted shadow hover:border-accent hover:text-accent"
            title={t("Some sites refuse to render inside the embedded browser")}
            onClick={() => openWindow(url)}
          >
            {t("Blank page? Open as app window")}
          </button>
        )}
        {!url && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
            <Globe size={32} className="text-accent/60" />
            <div className="text-center">
              {t("Enter a URL or search above.")}
              <br />
              <span className="text-xs">
                {t("Sites that refuse embedding open automatically in a real native browser window")}{" "}
                <ExternalLink size={11} className="inline" />.
              </span>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_LINKS.map((l) => (
                <button
                  key={l.url}
                  className="rounded border border-edge px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                  onClick={() => go(l.url)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dispatch to the native child-webview browser in the desktop app, or the
 *  iframe fallback in a plain dev browser. */
export function BrowserPanel() {
  return isTauri ? <NativeBrowser /> : <IframeBrowser />;
}
