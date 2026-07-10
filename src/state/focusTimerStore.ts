/**
 * Global focus (Pomodoro) timer.
 *
 * The countdown used to live inside the right-panel widget, so hiding the
 * sidebar unmounted the component and *reset the timer*. It now lives in this
 * shared store: it keeps running regardless of which sidebar widgets are
 * mounted, survives a window reload (persisted to localStorage), and is shown
 * in the status bar so you can watch it even with every sidebar collapsed.
 *
 * State model: when `running`, the deadline is `endsAt` (epoch ms); when
 * paused, the remaining whole seconds are held in `pausedLeft`. `remaining()`
 * derives the live value from whichever is active.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";

import { useAppStore } from "./appStore";
import { t } from "@/lib/i18n";

const STORE_KEY = "luxor.focusTimer.v1";
const DEFAULT_MINS = 25;

interface Persisted {
  mins: number;
  running: boolean;
  endsAt: number | null;
  pausedLeft: number;
}

function load(): Persisted {
  const fallback: Persisted = {
    mins: DEFAULT_MINS,
    running: false,
    endsAt: null,
    pausedLeft: DEFAULT_MINS * 60,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const mins = Number.isFinite(p.mins) && (p.mins as number) > 0 ? (p.mins as number) : DEFAULT_MINS;
    return {
      mins,
      running: Boolean(p.running) && typeof p.endsAt === "number",
      endsAt: typeof p.endsAt === "number" ? p.endsAt : null,
      pausedLeft:
        Number.isFinite(p.pausedLeft) && (p.pausedLeft as number) >= 0
          ? (p.pausedLeft as number)
          : mins * 60,
    };
  } catch {
    return fallback;
  }
}

function persist(s: Persisted): void {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ mins: s.mins, running: s.running, endsAt: s.endsAt, pausedLeft: s.pausedLeft }),
    );
  } catch {
    /* private mode — best effort */
  }
}

/** Whole seconds left for a given state snapshot (clamped at 0). */
export function remainingOf(s: Pick<Persisted, "running" | "endsAt" | "pausedLeft">, now = Date.now()): number {
  if (s.running && s.endsAt != null) return Math.max(0, Math.round((s.endsAt - now) / 1000));
  return Math.max(0, s.pausedLeft);
}

export function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  return `${String(m).padStart(2, "0")}:${ss}`;
}

interface FocusTimerState extends Persisted {
  setLength: (mins: number) => void;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  /** Called every second by the global watcher to fire the "finished" event. */
  tick: () => void;
}

export const useFocusTimer = create<FocusTimerState>((set, get) => {
  const init = load();
  // If the app was closed while the timer was running and the deadline has
  // already passed, reset to stopped state so we don't show a stale "running"
  // timer or silently miss the completion notification on first tick.
  if (init.running && init.endsAt != null && init.endsAt <= Date.now()) {
    init.running = false;
    init.endsAt = null;
    init.pausedLeft = 0;
    // Persist the corrected state immediately.
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ mins: init.mins, running: false, endsAt: null, pausedLeft: 0 }),
      );
    } catch { /* private mode — best effort */ }
  }
  return {
    ...init,
    setLength: (mins) => {
      const v = Math.min(180, Math.max(1, Math.round(mins)));
      const next = { mins: v, running: false, endsAt: null, pausedLeft: v * 60 };
      set(next);
      persist(next);
    },
    start: () => {
      const s = get();
      const left = remainingOf(s) > 0 ? remainingOf(s) : s.mins * 60;
      const next = { ...s, running: true, endsAt: Date.now() + left * 1000, pausedLeft: left };
      set(next);
      persist(next);
    },
    pause: () => {
      const s = get();
      const next = { ...s, running: false, endsAt: null, pausedLeft: remainingOf(s) };
      set(next);
      persist(next);
    },
    toggle: () => (get().running ? get().pause() : get().start()),
    reset: () => {
      const s = get();
      const next = { ...s, running: false, endsAt: null, pausedLeft: s.mins * 60 };
      set(next);
      persist(next);
    },
    tick: () => {
      const s = get();
      if (!s.running || s.endsAt == null) return;
      if (remainingOf(s) > 0) return;
      const next = { ...s, running: false, endsAt: null, pausedLeft: 0 };
      set(next);
      persist(next);
      try {
        useAppStore.getState().toast(t("Focus timer finished."), "success");
      } catch {
        /* ignore */
      }
    },
  };
});

// A single global watcher drives completion independently of any mounted view,
// so the timer fires even when every sidebar is closed.
if (typeof window !== "undefined") {
  const w = window as unknown as { __luxorFocusTimer?: number };
  if (!w.__luxorFocusTimer) {
    w.__luxorFocusTimer = window.setInterval(() => useFocusTimer.getState().tick(), 1000);
  }
}

/** Live remaining seconds, re-rendering ~twice a second while running. */
export function useFocusRemaining(): number {
  const running = useFocusTimer((s) => s.running);
  const endsAt = useFocusTimer((s) => s.endsAt);
  const pausedLeft = useFocusTimer((s) => s.pausedLeft);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => bump((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [running]);
  return remainingOf({ running, endsAt, pausedLeft });
}
