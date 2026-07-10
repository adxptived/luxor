import { useSyncExternalStore } from "react";

import { computeBreakpoints, type WindowBreakpoints } from "./windowAdaptive";

/**
 * Single source of truth for window-size adaptiveness (audit S2).
 *
 * Previously three independent trackers watched `window` size — a local
 * `useState` + resize listener in `WindowChrome`, a `window.innerWidth < 700`
 * tracker in `DockLayout`, and the cosmetic-only read in `WindowChrome`. This
 * external store coalesces them into **one** rAF-throttled resize listener that
 * every consumer shares via `useSyncExternalStore`, so the whole shell reacts
 * to the same breakpoints (compact / narrow / normal / wide) consistently.
 */

function measure(): WindowBreakpoints {
  if (typeof window === "undefined") return computeBreakpoints(1280, 800);
  return computeBreakpoints(window.innerWidth, window.innerHeight);
}

let snapshot: WindowBreakpoints = measure();
const listeners = new Set<() => void>();
let rafId = 0;
let attached = false;

function recompute() {
  rafId = 0;
  const next = measure();
  // Keep a stable reference unless a field actually changed, so
  // useSyncExternalStore doesn't re-render consumers on no-op resizes.
  if (
    next.width !== snapshot.width ||
    next.height !== snapshot.height ||
    next.size !== snapshot.size
  ) {
    snapshot = next;
    for (const l of listeners) l();
  }
}

function onResize() {
  if (rafId) return;
  rafId =
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(recompute)
      : (setTimeout(recompute, 16) as unknown as number);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!attached && typeof window !== "undefined") {
    window.addEventListener("resize", onResize);
    attached = true;
    // Refresh once on first subscribe in case the window changed before mount.
    snapshot = measure();
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && attached && typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
      attached = false;
      if (rafId && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }
  };
}

function getSnapshot(): WindowBreakpoints {
  return snapshot;
}

/** Subscribe to the shared window-size breakpoints. */
export function useWindowSize(): WindowBreakpoints {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
