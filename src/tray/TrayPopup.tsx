/**
 * Tray popup window.
 *
 * FIX SUMMARY (v2):
 * - Close on click-outside: The window is transparent + always-on-top. Clicks
 *   outside are NOT delivered to document listeners — they land in other windows.
 *   The ONLY reliable mechanism is onFocusChanged(false) which Tauri fires when
 *   another window / app / the desktop receives input. We ALSO poll
 *   document.hasFocus() every 100 ms as a safety net for edge cases where
 *   Tauri's blur event fires late (common on Windows with transparent windows).
 * - Settings not reflecting: config is reloaded on every focus-gained event,
 *   which fires each time the popup is shown via win.setFocus(). Additionally
 *   we reload on visibilitychange so even edge cases are covered.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import {
  isTauri,
  projectList,
  configGet,
  configSet,
  trayPopupFit,
  trayPopupHideIfCursorOutside,
} from "@/lib/ipc";
import type { Project, TrayConfig } from "@/lib/types";
import { TrayMenu } from "./TrayMenu";

const DEFAULT_TRAY: TrayConfig = {
  show_projects: true,
  show_new_terminal: true,
  show_new_window: false,
  show_settings: true,
  show_close_to_tray: true,
};

const MENU_WIDTH = 260;

async function emitToMain(event: string, payload?: unknown): Promise<void> {
  if (!isTauri) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  // Try the canonical "main" label first, then any "main-N" window.
  let mainWin = await WebviewWindow.getByLabel("main");
  if (!mainWin) {
    for (let n = 2; n <= 8; n++) {
      mainWin = await WebviewWindow.getByLabel(`main-${n}`);
      if (mainWin) break;
    }
  }
  if (mainWin) {
    await mainWin.show();
    await mainWin.unminimize();
    await mainWin.setFocus();
  }
}

export function TrayPopup() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [closeToTray, setCloseToTray] = useState(false);
  const [allowSecondWindow, setAllowSecondWindow] = useState(false);
  const [tray, setTray] = useState<TrayConfig>(DEFAULT_TRAY);
  const [version, setVersion] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ignoreBlurUntilRef = useRef(Date.now() + 1200);
  // Re-keys the menu card each time the popup is shown so the entrance
  // animation replays (a hidden window keeps its DOM, so CSS animations
  // would otherwise only run on the very first open).
  const [openCount, setOpenCount] = useState(0);
  const hidingRef = useRef(false);

  // ── Hide the popup ────────────────────────────────────────────────────────
  // Plays a quick scale/fade exit animation before actually hiding the
  // window, so closing feels as deliberate as opening. Guarded so rapid
  // blur + click-outside + Esc can't stack multiple hide sequences.
  const hidePopup = useCallback(async () => {
    if (!isTauri || hidingRef.current) return;
    hidingRef.current = true;
    try {
      cardRef.current?.classList.add("lx-menu-out");
      await new Promise((r) => setTimeout(r, 110));
      await getCurrentWindow().hide();
    } catch { /* ignore */ } finally {
      cardRef.current?.classList.remove("lx-menu-out");
      hidingRef.current = false;
    }
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([configGet(), projectList()]);
      setCloseToTray(cfg.ui.close_to_tray);
      setAllowSecondWindow(cfg.ui.allow_second_window ?? false);
      setTray(cfg.ui.tray ?? DEFAULT_TRAY);
      setProjects(
        list
          .filter((p): p is Project => Boolean(p && typeof p.id === "string" && p.id.length > 0))
          .slice(0, 6),
      );
    } catch { /* ignore */ }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    void loadData();
    void (async () => {
      if (!isTauri) return;
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setVersion(await getVersion());
      } catch { /* ignore */ }
    })();
  }, [loadData]);

  // ── Focus tracking ────────────────────────────────────────────────────────
  // Reload on focus gain. Close on a real focus loss, but ignore the synthetic
  // blur/focus churn that can happen immediately after a tray popup is shown.
  useEffect(() => {
    if (!isTauri) return;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        ignoreBlurUntilRef.current = Date.now() + 900;
        if (blurTimer) clearTimeout(blurTimer);
        void loadData();
        setOpenCount((n) => n + 1); // replay the entrance animation
        return;
      }

      if (Date.now() < ignoreBlurUntilRef.current) return;
      blurTimer = setTimeout(() => {
        if (Date.now() >= ignoreBlurUntilRef.current && !document.hasFocus()) {
          void hidePopup();
        }
      }, 180);
    });
    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      void unlisten.then((u) => u());
    };
  }, [loadData, hidePopup]);

  // ── Close on click outside the menu card ───────────────────────────────────
  // Native tray menus stay open for clicks inside and close when clicking the
  // transparent area around them. For clicks in other windows/apps the focus
  // handler above is the cross-window fallback.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const card = cardRef.current;
      if (!card || !(e.target instanceof Node)) return;
      if (!card.contains(e.target)) void hidePopup();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [hidePopup]);

  // ── Native outside-click watchdog ─────────────────────────────────────────
  // DOM cannot see clicks that land in other native windows. Polling the global
  // cursor while the primary button is down lets Rust hide the popup when the
  // click happened outside the popup's native bounds.
  useEffect(() => {
    if (!isTauri) return;
    let pointerDown = false;
    let lastCheck = 0;
    const check = () => {
      const now = Date.now();
      if (now - lastCheck < 80) return;
      lastCheck = now;
      void trayPopupHideIfCursorOutside(2).catch(() => {});
    };
    const onPointerDown = () => {
      pointerDown = true;
      check();
    };
    const onPointerUp = () => {
      pointerDown = false;
    };
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      // Ignore the synthetic blur churn right after the popup is shown: at
      // that moment the cursor is still at the tray icon (outside the popup
      // bounds), so an ungated check would hide the menu before it appears.
      if (Date.now() < ignoreBlurUntilRef.current) return;
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(check, 80);
    };
    const interval = setInterval(() => {
      if (pointerDown) check();
    }, 120);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      clearInterval(interval);
      if (blurTimer) clearTimeout(blurTimer);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ── Reload on page visibility change ─────────────────────────────────────
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        ignoreBlurUntilRef.current = Date.now() + 900;
        void loadData();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadData]);

  // ── Close on Esc ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void hidePopup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidePopup]);

  // ── Resize window to fit menu ─────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!isTauri || !rootRef.current) return;
    const el = rootRef.current;
    let lastW = 0;
    let lastH = 0;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.ceil(rect.width);
      const h = Math.ceil(rect.height);
      // Skip no-op fits: resizing the native window re-triggers the observer,
      // and calling trayPopupFit again for the same size creates a feedback
      // loop ("ResizeObserver loop completed with undelivered notifications").
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        lastW = w;
        lastH = h;
        void trayPopupFit(w, h).catch(() => {});
      }
    };
    fit();
    // Defer observer callbacks to the next frame so the native resize the fit
    // triggers never re-enters the observer synchronously.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [projects, tray, closeToTray, version, allowSecondWindow]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const openApp = () => {
    void hidePopup();
    void showMainWindow();
  };

  const openSettings = () => {
    void hidePopup();
    void (async () => {
      await emitToMain("luxor://open-settings", {});
      await showMainWindow();
    })();
  };

  const handleProjectClick = (id: string) => {
    void hidePopup();
    void (async () => {
      await emitToMain("luxor://open-project-request", id);
      await showMainWindow();
    })();
  };

  const handleNewTerminal = () => {
    void hidePopup();
    void (async () => {
      await emitToMain("luxor://tray-new-terminal", {});
      await showMainWindow();
    })();
  };

  const handleNewWindow = () => {
    void hidePopup();
    if (isTauri) void invoke("window_open_new").catch(() => {});
  };

  const toggleCloseToTray = () => {
    void (async () => {
      try {
        const cfg = await configGet();
        cfg.ui.close_to_tray = !cfg.ui.close_to_tray;
        await configSet(cfg);
        setCloseToTray(cfg.ui.close_to_tray);
      } catch { /* ignore */ }
    })();
  };

  const handleQuit = () => {
    if (isTauri) void invoke("quit_app").catch(() => {});
  };

  return (
    <div ref={rootRef} className="tray-popup-root p-1.5" style={{ width: MENU_WIDTH + 12 }}>
      <div key={openCount} ref={cardRef} className="lx-menu-pop rounded-lg" style={{ width: MENU_WIDTH }}>
        <TrayMenu
          config={tray}
          projects={projects}
          closeToTray={closeToTray}
          version={version}
          allowSecondWindow={allowSecondWindow}
          onOpenApp={openApp}
          onOpenSettings={openSettings}
          onProject={handleProjectClick}
          onNewTerminal={handleNewTerminal}
          onNewWindow={handleNewWindow}
          onToggleCloseToTray={toggleCloseToTray}
          onQuit={handleQuit}
        />
      </div>
    </div>
  );
}
