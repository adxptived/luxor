/**
 * Shared polling scheduler.
 *
 * The app had ~14 independent `setInterval`s (git status, system stats, ping,
 * agents, tasks, clock, …) each guarded by `if (document.hidden) return`. That
 * guard skips the *work* but the timers keep firing, waking the process ~14×
 * across several cadences — wasteful for a desktop app that lives in the tray
 * for hours.
 *
 * This module runs a single 1 s master timer that dispatches due jobs, and —
 * crucially — is fully torn down while the window is hidden and restarted (with
 * an immediate catch-up tick) when it becomes visible again. So in the tray:
 * zero timers; on return: data refreshes instantly instead of waiting out the
 * remainder of each job's period.
 */

type Job = {
  fn: () => void;
  period: number;
  /** Epoch ms when this job is next due. */
  next: number;
};

const jobs = new Set<Job>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  const now = Date.now();
  for (const j of jobs) {
    if (now >= j.next) {
      j.next = now + j.period;
      try {
        j.fn();
      } catch {
        /* a misbehaving poll must not kill the shared timer */
      }
    }
  }
}

function start(): void {
  timer ??= setInterval(tick, 1000);
}

function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Tray / minimized: stop waking the process entirely.
      stop();
    } else if (jobs.size > 0) {
      // Back in view: refresh immediately, then resume the cadence.
      tick();
      start();
    }
  });
}

/**
 * Register a polling job. `fn` runs immediately (if the window is visible),
 * then every `periodMs` while visible. Returns an unsubscribe function that
 * removes the job and stops the master timer once the last job is gone.
 *
 * Drop-in replacement for the `setInterval(fn, ms)` + `document.hidden` guard
 * + `clearInterval` cleanup pattern inside a `useEffect`.
 */
export function schedulePoll(fn: () => void, periodMs: number): () => void {
  const now = Date.now();
  const job: Job = { fn, period: periodMs, next: now + periodMs };
  jobs.add(job);
  // Leading call: match the old "poll(); setInterval(poll, …)" behavior so data
  // appears right away rather than after one full period.
  if (typeof document === "undefined" || !document.hidden) {
    try {
      fn();
    } catch {
      /* ignore */
    }
    start();
  }
  return () => {
    jobs.delete(job);
    if (jobs.size === 0) stop();
  };
}
