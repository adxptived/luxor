import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { NavRail } from "@/components/NavRail";
import { OnboardingTour } from "@/components/OnboardingTour";
import { needsOnboarding, startOnboarding } from "@/lib/onboarding";
import { Overlays } from "@/components/Overlays";
import { RightPanel } from "@/components/RightPanel";
import { SidePanel } from "@/components/SidePanel";

// Heavy, on-demand overlays (Settings is ~80 KB of source on its own). They
// render nothing until opened, so keeping them out of the entry chunk shrinks
// what the webview must fetch/parse/AV-scan before first paint — their code is
// fetched lazily, off the startup critical path, right after the UI mounts.
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const ProjectSwitcher = lazy(() =>
  import("@/components/ProjectSwitcher").then((m) => ({ default: m.ProjectSwitcher })),
);
const SettingsModal = lazy(() =>
  import("@/components/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
import { StatusBar } from "@/components/StatusBar";
import { TopBar } from "@/components/TopBar";
import { WindowChrome } from "@/components/WindowChrome";
import { QuickActions } from "@/components/QuickActions";
import { DockLayout } from "@/layout/DockLayout";
import { cycleTab, useDockStore } from "@/layout/dockStore";
import * as ipc from "@/lib/ipc";
import { frontendLog } from "@/lib/ipc";
import { schedulePoll } from "@/lib/poll";
import { pushStructured } from "@/lib/logBuffer";
import { ensurePtyBus } from "@/lib/ptyBus";
import { effectiveHotkeys, hintFor, matchChord } from "@/lib/hotkeys";
import { DEFAULT_NAV_HIDDEN } from "@/lib/navButtons";
import { saveAllEditors } from "@/lib/editorBus";
import { ZOOM_STEP } from "@/lib/zoom";
import {
  getLanguage,
  getLanguageVersion,
  setLanguage,
  subscribeLanguage,
  t,
} from "@/lib/i18n";
import { detectLocale } from "@/lib/localeDetect";
import { useWindowSize } from "@/lib/useWindowSize";
import { markTTI } from "@/perf/perfMeasure";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";

/**
 * Tear down the inline `#splash` overlay (defined in index.html). It is a
 * full-window, `z-index:9999` cover, so if it is ever left in place the entire
 * app — including the file editor — is invisible and unclickable behind the
 * spinner. We set `pointer-events:none` first so a fading splash can never
 * intercept clicks on the live UI underneath, then fade + remove it.
 * Idempotent: safe to call from multiple effects.
 */
function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.style.pointerEvents = "none";
  splash.style.opacity = "0";
  setTimeout(() => splash.remove(), 200);
}

/**
 * One-shot latch for the STARTUP telemetry block. The mount effect that emits
 * it depends on store actions (`init`, `loadProjects`, `loadPresets`); if any
 * of those ever changes identity the effect re-runs and, without this guard,
 * the log gets duplicate STARTUP lines with nonsense timings measured from an
 * already-warm app (seen in exported diagnostics: two firstPaint entries one
 * millisecond apart). Module scope survives remounts within one page load and
 * naturally resets on a real reload, which is exactly the desired lifetime.
 */
let startupTelemetrySent = false;

function scheduleStartupIdle(work: () => void, timeout = 3_000): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (cancelled) return;
    cancelled = true;
    work();
  };
  if ("requestIdleCallback" in window) {
    idleId = window.requestIdleCallback(run, { timeout });
  } else {
    timerId = setTimeout(run, Math.min(timeout, 1_500));
  }
  return () => {
    cancelled = true;
    if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    if (timerId) clearTimeout(timerId);
  };
}

export default function App() {
  const init = useAppStore((s) => s.init);
  // Subscribe to the *specific* config fields the root actually renders/gates on,
  // not the whole `config` object. Previously `useAppStore((s) => s.config)`
  // re-rendered App (and its un-memoized TopBar/RightPanel/StatusBar/DockLayout
  // subtree) on every settings save — theme, zoom, any checkbox. These primitive
  // selectors only fire when the value they read changes; effects that need the
  // full object read it lazily via `useAppStore.getState().config`.
  const configReady = useAppStore((s) => s.config !== null);
  const configLanguage = useAppStore((s) => s.config?.ui.language);
  const tabBarSide = useAppStore((s) => s.config?.tab_bar_position === "side");
  const quickActionsSide = useAppStore(
    (s) => (s.config?.ui.quick_actions ?? "top") === "side",
  );
  const loadProjects = useProjectsStore((s) => s.load);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const loadPresets = useDockStore((s) => s.loadPresets);

  // Phase 14: detect locale once on mount for fallback when config has no language.
  const detectedLocaleRef = useRef(detectLocale());

  // Guaranteed splash teardown. Remove the overlay as soon as the config has
  // loaded and the real shell is rendered. CRITICAL: this must NOT be gated on
  // `ipc.isTauri` or on a *successful* config load — a failed `get_config`
  // leaves `config` null forever, and the old code (nested inside the Tauri-only
  // telemetry block) then kept the spinner up indefinitely with the working app
  // hidden behind it. The unconditional fallback below is the backstop.
  // Keep the splash up until BOTH the config and the project list have loaded.
  // The dock layout picks the active workspace from `activeId`, which only
  // exists after `loadProjects()` resolves; dismissing on `config` alone
  // revealed the Welcome screen for a frame before the real workspace snapped
  // in (the startup "jerk"). Waiting for both means the restored workspace is
  // already painted under the splash when it fades.
  useEffect(() => {
    if (configReady && projectsLoaded) {
      dismissSplash();
      // First-run tour: start it once the shell is visible. The tour component
      // is already mounted and subscribes to onboarding state, so it appears as
      // soon as this fires. No-op for returning users (needsOnboarding()===false).
      if (needsOnboarding()) startOnboarding();
    }
  }, [configReady, projectsLoaded]);

  // Backstop: never strand the user behind the spinner. Even if config never
  // loads (corrupt config file, IPC error, non-Tauri context), drop the splash
  // after the shell has had time to paint so the UI is always reachable.
  useEffect(() => {
    const fallback = window.setTimeout(dismissSplash, 6_000);
    return () => window.clearTimeout(fallback);
  }, []);

  useEffect(() => {
    void init();
    void loadProjects();
    // Phase 14: locale detection is handled via detectedLocaleRef at render
    // time (config?.ui.language ?? detectedLocaleRef.current), so no need to
    // call setLanguage here — it would be overridden on the next render anyway.
    const cancelPresetLoad = scheduleStartupIdle(() => void loadPresets(), 6_000);
    // Phase 7: mark TTI after the initial mount + idle.
    markTTI();
    // Subscribe to PTY events before any terminal spawns so the very first
    // shell banner/prompt can never race past the listener registration.
    const cancelPtyBus = ipc.isTauri
      ? scheduleStartupIdle(() => void ensurePtyBus().catch(() => {}), 2_500)
      : undefined;
    // Reveal the (hidden) native window once React has painted — fixes the
    // white flash at startup.
    requestAnimationFrame(() => {
      void ipc.windowReady().catch(() => {});
      // Startup telemetry → frontend.log: shows *where* a slow start spends
      // its time (webview/network vs JS parse vs React) in exported
      // diagnostics, instead of guessing from "it takes N seconds".
      if (ipc.isTauri && !startupTelemetrySent) {
        startupTelemetrySent = true;
        try {
          const nav = performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined;
          const ms = (v: number) => Math.round(v);
          // Granular phase split (see perfMark.ts / index.html marks). Isolates
          // where a slow start actually goes:
          //   bundleFetch = webview fetch+compile of the entry chunk
          //                 (disk / WebView2 / antivirus — NOT our code)
          //   bundleExec  = top-level execution of our JS bundle
          //   render      = bundleReady → first React paint
          const lx = window.__lx ?? {};
          const phase = (a?: number, b?: number) =>
            typeof a === "number" && typeof b === "number" ? ms(b - a) : undefined;
          const bundleFetch = phase(lx.bodyParsed, lx.moduleStart);
          const bundleExec = phase(lx.moduleStart, lx.moduleReady);
          const render = phase(lx.moduleReady, performance.now());
          const parts = [
            `firstPaint=${ms(performance.now())}ms`,
            nav ? `htmlLoaded=${ms(nav.domContentLoadedEventEnd)}ms` : "",
            nav ? `jsReady=${ms(nav.loadEventEnd || nav.domContentLoadedEventEnd)}ms` : "",
            bundleFetch !== undefined ? `bundleFetch=${bundleFetch}ms` : "",
            bundleExec !== undefined ? `bundleExec=${bundleExec}ms` : "",
            render !== undefined ? `render=${render}ms` : "",
          ].filter(Boolean);
          void frontendLog(`STARTUP ${parts.join(" ")}`);
          pushStructured("INFO", "startup", "first paint", {
            firstPaintMs: ms(performance.now()),
            htmlLoadedMs: nav ? ms(nav.domContentLoadedEventEnd) : null,
            jsReadyMs: nav ? ms(nav.loadEventEnd || nav.domContentLoadedEventEnd) : null,
            bundleFetchMs: bundleFetch ?? null,
            bundleExecMs: bundleExec ?? null,
            renderMs: render ?? null,
          });
          // A second mark once the config has loaded and the real shell is
          // interactive — this is the number that matches "time to usable".
          const appReadyAt = performance.now();
          const stop = useAppStore.subscribe((s) => {
            if (s.config) {
              stop();
              requestAnimationFrame(() => {
                const readyMs = ms(performance.now());
                void frontendLog(`STARTUP appReady=${readyMs}ms`);
                // Parity with the fast path below: the structured buffer must
                // also get the app-ready mark, otherwise diagnostics exported
                // from a normal (slow-path) start are missing it.
                pushStructured("INFO", "startup", "app ready", { appReadyMs: readyMs });
              });
            }
          });
          // Already loaded before we subscribed (fast path): log immediately.
          if (useAppStore.getState().config) {
            stop();
            void frontendLog(`STARTUP appReady=${ms(appReadyAt)}ms`);
            pushStructured("INFO", "startup", "app ready", { appReadyMs: ms(appReadyAt) });
          }
          // (Splash teardown moved out of this Tauri-only telemetry block —
          // see `dismissSplash` and the dedicated effects above. Gating it here
          // meant a failed config load or a non-Tauri context left the spinner
          // covering the whole app forever.)
        } catch {
          /* telemetry must never break startup */
        }
      }
    });
    return () => {
      cancelPresetLoad();
      cancelPtyBus?.();
    };
  }, [init, loadProjects, loadPresets]);

  // Always-on activity telemetry + Discord Rich Presence driver. It lives at the
  // app root — NOT inside the Analytics panel — so stats keep accruing and the
  // Discord status keeps updating no matter which panel is focused (previously
  // presence froze the moment you left the Analytics tab). The driver is an
  // internal singleton and a no-op outside Tauri / when tracking is disabled.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    // Dynamic import keeps analytics.ts (~700 lines) out of the entry chunk:
    // it isn't parsed until the idle callback fires, well after first paint.
    const cancel = scheduleStartupIdle(() => {
      void import("@/lib/analytics").then((m) => {
        if (disposed) return;
        stop = m.startTelemetryDriver();
      });
    }, 4_000);
    return () => {
      disposed = true;
      cancel();
      stop?.();
    };
  }, []);

  // `luxor <path>` from a second shell: the running instance opens the
  // project (Tauri only). Two paths deliver the request:
  //  1. `cli:open` event — emitted instantly by the single-instance plugin
  //     when a second GUI launch carries a path (audit 10.3, no poll delay);
  //  2. the request-queue poll — fallback for the standalone `luxor` CLI
  //     helper that writes to the queue file without launching the app.
  useEffect(() => {
    if (!ipc.isTauri) return;
    const openPath = async (path: string) => {
      const store = useProjectsStore.getState();
      const existing = store.projects.find((p) => p.path === path);
      if (existing) {
        store.setActive(existing.id);
      } else {
        const added = await store.addProjectPath(path);
        if (added) store.setActive(added.id);
      }
      useAppStore.getState().toast(`Opened ${path} from the command line`, "success");
    };
    let unlistenOpen: (() => void) | undefined;
    void ipc.listen<string>("cli:open", (path) => void openPath(path)).then((un) => {
      unlistenOpen = un;
    });
    let busy = false;
    const poll = () => {
      // `busy` prevents overlapping requests; the shared scheduler already
      // pauses while the window is hidden.
      if (busy) return;
      busy = true;
      void ipc
        .cliPollRequests()
        .then(async (paths) => {
          for (const path of paths) await openPath(path);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    let unschedule = () => {};
    const cancel = scheduleStartupIdle(() => {
      unschedule = schedulePoll(poll, 3000);
    }, 5_000);
    return () => {
      cancel();
      unschedule();
      unlistenOpen?.();
    };
  }, []);

  // Tray "Projects" submenu: keep it in sync with the project list, and
  // switch the active project when a tray entry is clicked.
  useEffect(() => {
    if (!ipc.isTauri) return;
    const push = () => {
      const list = useProjectsStore
        .getState()
        .projects.filter((p) => p.path !== "")
        .map((p) => ({ id: p.id, name: p.name }));
      void ipc.traySetProjects(list).catch(() => {});
    };
    push();
    const unsubProjects = useProjectsStore.subscribe((state, prev) => {
      if (state.projects !== prev.projects) push();
    });
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void ipc
      .listen<string>("luxor://open-project-request", (id) => {
        const store = useProjectsStore.getState();
        if (store.projects.some((p) => p.id === id)) store.setActive(id);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unsubProjects();
      unlisten?.();
    };
  }, []);

  // Tray popup "New terminal" action: open a terminal in the active dock.
  useEffect(() => {
    if (!ipc.isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void ipc
      .listen("luxor://tray-new-terminal", () => {
        useDockStore.getState().addTerminal();
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Tray popup "Settings" action: open the settings modal in the main window.
  useEffect(() => {
    if (!ipc.isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void ipc
      .listen("luxor://open-settings", () => {
        useAppStore.getState().setSettingsOpen(true);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Apply the configured UI language; remount the tree below on change so
  // plain t() calls re-evaluate everywhere.
  // Phase 14: fall back to the auto-detected locale when config doesn't
  // specify a language, instead of always defaulting to "en".
  const language = configLanguage ?? detectedLocaleRef.current;
  // Re-render when the (lazily-loaded) RU dictionary chunk arrives so plain
  // t() calls pick up translations without an explicit await here.
  useSyncExternalStore(subscribeLanguage, getLanguageVersion, getLanguageVersion);
  void setLanguage(language);

  // One update check on startup (when enabled and a repo is configured).
  useEffect(() => {
    const config = useAppStore.getState().config;
    const repo = config?.ui.update_repo ?? "";
    if (!config || !config.ui.update_check || !repo) return;
    const KEY = "luxor.updateCheckDone";
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
    void ipc
      .updateCheck(repo)
      .then((info) => {
        if (info.update_available) {
          useAppStore.getState().toast(`${t("update.available", "Luxor update available")}: ${info.latest}`, "info");
        }
      })
      .catch(() => {});
  }, [configReady]);

  // One-time migration: existing installs created before the curated default
  // had every nav button visible. If the user never touched the nav (both the
  // order and hidden lists are empty), collapse it to the four essentials —
  // matching what fresh installs now get. Gated by localStorage so it runs once
  // and never fights a user who later re-shows buttons.
  useEffect(() => {
    const config = useAppStore.getState().config;
    if (!config) return;
    const KEY = "luxor.navDefaultsV2";
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, "1");
    if (config.ui.nav_order.length === 0 && config.ui.nav_hidden.length === 0) {
      void useAppStore.getState().saveConfig({
        ...config,
        ui: { ...config.ui, nav_hidden: [...DEFAULT_NAV_HIDDEN] },
      });
    }
  }, [configReady]);

  // Global hotkeys (editable in Settings → Hotkeys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = effectiveHotkeys(useAppStore.getState().config);
      const app = useAppStore.getState();
      const dock = useDockStore.getState();
      const fire = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      // Swallow the webview's full-page reload shortcuts (F5 / Ctrl+R /
      // Ctrl+Shift+R): in a desktop app a hard reload throws away terminals,
      // layout and unsaved state. Nothing should reload the window.
      if (
        e.code === "F5" ||
        ((e.ctrlKey || e.metaKey) && (e.code === "KeyR" || e.code === "F5"))
      ) {
        e.preventDefault();
        return;
      }
      // Let focused overlays/editors own shortcuts they already handled. This
      // prevents global actions (for example Ctrl+P) from leaking through the
      // command palette, project switcher or hotkey recorder.
      if (e.defaultPrevented) return;
      // F1 opens the command palette (in addition to Ctrl+Shift+P).
      if (e.code === "F1") return fire(() => app.setPaletteOpen(!app.paletteOpen));
      if ((e.ctrlKey || e.metaKey) && e.code === "Tab") {
        e.preventDefault();
        if (!e.repeat) cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (matchChord(e, keys["palette"])) fire(() => app.setPaletteOpen(!app.paletteOpen));
      else if (matchChord(e, keys["projects.switch"])) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fire(() => app.setSwitcherOpen(!app.switcherOpen));
      }
      else if (matchChord(e, keys["terminal.new"])) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fire(() => dock.addTerminal());
      }
      else if (matchChord(e, keys["project.open"])) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fire(() => void useProjectsStore.getState().addProject());
      }
      else if (matchChord(e, keys["git.open"])) fire(() => dock.openPanel("git"));
      else if (matchChord(e, keys["files.open"])) fire(() => dock.openPanel("files"));
      else if (matchChord(e, keys["settings.open"])) fire(() => app.setSettingsOpen(true));
      else if (matchChord(e, keys["search.open"])) fire(() => dock.openPanel("search"));
      else if (matchChord(e, keys["file.saveAll"])) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fire(() =>
          void saveAllEditors().then((n) =>
            app.toast(
              n > 0 ? `${t("Saved files:")} ${n}` : t("No unsaved changes"),
              n > 0 ? "success" : "info",
            ),
          ),
        );
      }
      else if (matchChord(e, keys["zen.toggle"])) fire(() => app.toggleZen());
      else if (matchChord(e, keys["tab.next"])) fire(() => cycleTab(1));
      else if (matchChord(e, keys["tab.prev"])) fire(() => cycleTab(-1));
      else if (matchChord(e, keys["tab.reopen"])) {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fire(() => {
          void useProjectsStore
            .getState()
            .reopenClosedProjectTab()
            .then((reopened) => {
              if (!reopened) dock.reopenLastClosed();
            });
        });
      }
      else if (matchChord(e, keys["tab.close"])) {
        // Always swallow the chord so the webview can't close the whole window,
        // but only close the tab when we're NOT typing: in a terminal Ctrl+W is
        // readline "delete word" (xterm already handled it at the target), and
        // in plain inputs it can be the same. Code editors do close (VS Code).
        e.preventDefault();
        const el = e.target as HTMLElement | null;
        const inTerminal = Boolean(el?.closest?.(".xterm"));
        // CodeMirror's content is `contenteditable`, so it also matches the
        // input selector below; treat it as an editor (not a plain input) so
        // Ctrl+W still closes the tab like in VS Code.
        const inEditor = Boolean(el?.closest?.(".cm-editor"));
        const inInput = Boolean(el?.closest?.("input, textarea, [contenteditable=true]"));
        if (!inTerminal && !(inInput && !inEditor)) dock.closeActivePanel();
      }
      // App zoom (fixed bindings, matches browser conventions).
      else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "Equal" || e.code === "NumpadAdd"))
        fire(() => app.setZoom((app.config?.ui.zoom ?? 1) + ZOOM_STEP));
      else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "Minus" || e.code === "NumpadSubtract"))
        fire(() => app.setZoom((app.config?.ui.zoom ?? 1) - ZOOM_STEP));
      else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === "Digit0" || e.code === "Numpad0"))
        fire(() => app.setZoom(1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+wheel zoom (must be non-passive to preventDefault page zoom/scroll).
  // The non-passive listener is only attached WHILE Ctrl/Meta is held: a
  // permanent non-passive wheel listener on `window` forces the compositor to
  // wait for the JS handler on every single wheel event, which makes ALL
  // scrolling in the app janky (especially on Windows/WebView2). Gating it on
  // the modifier keeps normal scrolling fully on the compositor thread.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const app = useAppStore.getState();
      app.setZoom((app.config?.ui.zoom ?? 1) + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener("wheel", onWheel, { passive: false });
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      window.removeEventListener("wheel", onWheel);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) attach();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) detach();
    };
    // Ctrl can be released while the window is unfocused/hidden — keyup never
    // reaches us then, so reset on blur/visibility changes.
    const onReset = () => detach();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onReset);
    document.addEventListener("visibilitychange", onReset);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onReset);
      document.removeEventListener("visibilitychange", onReset);
      detach();
    };
  }, []);

  // Replace the browser context menu app-wide. Components add their own
  // richer menus; this is the fallback for everything else. Native menus stay
  // available inside editable fields.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], .cm-editor")) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      const app = useAppStore.getState();
      const dock = useDockStore.getState();
      // Hints reflect the user's current (possibly remapped) bindings, OS-aware.
      const cfg = app.config;
      useUiStore.getState().openMenu(e.clientX, e.clientY, [
        { label: t("New terminal"), hint: hintFor("terminal.new", cfg), onClick: () => dock.addTerminal() },
        { label: t("Split right (new terminal)"), onClick: () => dock.splitWithTerminal("right") },
        { label: t("Split down (new terminal)"), onClick: () => dock.splitWithTerminal("below") },
        { separator: true },
        { label: t("File explorer panel"), hint: hintFor("files.open", cfg), onClick: () => dock.openPanel("files") },
        {
          label: t("Open file / database…"),
          onClick: () => void ipc.pickFile().then((path) => path && dock.openFile(path)),
        },
        { label: t("Command palette"), hint: hintFor("palette", cfg), onClick: () => app.setPaletteOpen(true) },
        { separator: true },
        { label: t("Settings"), hint: hintFor("settings.open", cfg), onClick: () => app.setSettingsOpen(true) },
      ]);
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const zenMode = useAppStore((s) => s.zenMode);
  const sideTabs = tabBarSide;
  const sideQuickActions = quickActionsSide;
  // Single shared window-size source (audit S2): auto-collapse the optional
  // side/right panels and status bar on narrow/compact windows.
  const win = useWindowSize();

  return (
    <AppErrorBoundary>
    <div key={getLanguage()} className="flex h-screen w-screen flex-col overflow-hidden bg-surface text-strong">
      {!zenMode && sideTabs && <WindowChrome />}
      <div className={`flex min-h-0 flex-1 ${sideTabs ? "flex-row" : "flex-col"}`}>
        {!zenMode && <TopBar vertical={sideTabs} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          {sideQuickActions && (
            <div className="flex shrink-0 flex-col border-r border-edge bg-bar">
              <QuickActions vertical />
            </div>
          )}
          {!sideTabs && <NavRail />}
          {/* In side-tab mode the vertical TopBar already *is* the left sidebar,
              so the optional widget side panel would be a confusing second left
              panel — show it only in top-tab mode. */}
          {!sideTabs && !win.hideLeftSidebar && <SidePanel />}
          <div className="min-h-0 min-w-0 flex-1">
            <DockLayout />
          </div>
          {!zenMode && !win.hideRightPanel && <RightPanel />}
        </div>
      </div>
      {!zenMode && !win.hideStatusBar && <StatusBar />}
      <Suspense fallback={null}>
        <CommandPalette />
        <ProjectSwitcher />
        <SettingsModal />
      </Suspense>
      <Overlays />
      <OnboardingTour />
    </div>
    </AppErrorBoundary>
  );
}
