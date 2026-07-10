import "./perfMark"; // MUST be first: marks when the entry bundle starts executing
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { frontendLog } from "@/lib/ipc";
import { pushStructured } from "@/lib/logBuffer";
import { useAppStore } from "@/state/appStore";
import "./styles.css";

// Global safety net: uncaught errors and promise rejections surface as toasts
// (throttled per message) instead of dying silently in a webview console
// nobody ever opens.
const seen = new Map<string, number>();
function isBenignGlobalError(message: string): boolean {
  // xterm can throw this while a terminal panel is hidden/being resized in
  // Chromium/WebView. The terminal resizes correctly on the next visible fit;
  // surfacing it as a user-facing toast just pollutes screenshots and UX.
  if (message.includes("Cannot read properties of undefined (reading 'dimensions')")) return true;
  // A well-known benign browser notice: the observer simply could not deliver
  // every notification within one frame (e.g. a fit/resize settling over two
  // frames). Nothing is broken — layout converges on the next frame. Both
  // Chrome and the WebView fire it under normal, correct code.
  return message.includes("ResizeObserver loop");
}

function reportGlobalError(message: string) {
  if (isBenignGlobalError(message)) return;
  const now = Date.now();
  const last = seen.get(message) ?? 0;
  if (now - last < 10_000) return;
  seen.set(message, now);
  try {
    useAppStore.getState().toast(message.slice(0, 300), "error");
  } catch {
    /* store not ready yet */
  }
  void frontendLog(`ERROR ${message}`);
  pushStructured("ERROR", "general", message.slice(0, 500));
}

window.addEventListener("error", (e) => {
  reportGlobalError(`Unexpected error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const r: unknown = e.reason;
  // Tauri command errors arrive as plain strings or objects — String() would
  // show the useless "[object Object]".
  const reason =
    r instanceof Error
      ? r.message
      : typeof r === "string"
        ? r
        : (() => {
            try {
              return JSON.stringify(r);
            } catch {
              return String(r);
            }
          })();
  reportGlobalError(`Unhandled rejection: ${reason}`);
});

// Marks the end of the entry bundle's top-level execution (before React mounts
// asynchronously). Gap moduleStart→moduleReady = our JS parse/eval cost.
if (typeof window !== "undefined" && window.__lx) {
  window.__lx.moduleReady = performance.now();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Freeze detector: a 1s heartbeat that arrives much later than scheduled means
// the main thread was blocked. Logged to frontend.log so freezes show up in
// exported diagnostics with timestamps. Started *after* the first idle window
// so it never competes with the initial mount/paint on the critical path.
function startFreezeDetector() {
  let lastBeat = performance.now();
  let lastFreezeReport = 0;
  let wasHidden = document.hidden;
  // A genuine main-thread block of more than a few seconds means the app is
  // effectively hung; gaps larger than this are almost always the process
  // being *suspended* (OS sleep, or the webview throttled while hidden) —
  // logging those as "freezes" produced scary, meaningless ~11s/~59s
  // entries. Ignore them, skip entirely while the window is hidden/back-
  // grounded, AND skip the first heartbeat after the window becomes visible
  // again (the gap that just elapsed is throttling, not a real freeze).
  const SUSPEND_GAP = 5_000;
  // 500 ms catches real jank but also tags ordinary GC pauses. Bumped to
  // 750 ms so the log only fills with actionable freezes — the kind a user
  // would actually notice as the UI sticking.
  const MIN_LAG = 750;
  setInterval(() => {
    const now = performance.now();
    const lag = now - lastBeat - 1000;
    lastBeat = now;
    if (document.hidden) {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      wasHidden = false;
      return;
    }
    if (lag > MIN_LAG && lag < SUSPEND_GAP && now - lastFreezeReport > 30_000) {
      lastFreezeReport = now;
      const lagMs = Math.round(lag);
      void frontendLog(`FREEZE ui thread blocked ~${lagMs}ms`);
      pushStructured("WARN", "perf", "UI thread freeze detected", { lagMs });
    }
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) wasHidden = true;
  });
}
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(startFreezeDetector, { timeout: 4_000 });
} else {
  setTimeout(startFreezeDetector, 2_000);
}
