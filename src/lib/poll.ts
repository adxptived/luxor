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
  fn: () => void | Promise<void>;
  period: number;
  /** Epoch ms when this job is next due. */
  next: number;
  /** Prevent an async job from overlapping itself when a poll runs slowly. */
  running: boolean;
  removed: boolean;
};

const jobs = new Set<Job>();
let timer: ReturnType<typeof setInterval> | null = null;

function runJob(job: Job, now = Date.now()): void {
  if (job.removed || job.running || now < job.next) return;
  job.next = now + job.period;
  job.running = true;
  try {
    void Promise.resolve(job.fn())
      .catch(() => {
        /* a rejected poll must not produce an unhandled rejection */
      })
      .finally(() => {
        job.running = false;
      });
  } catch {
    job.running = false;
    /* a synchronous poll failure must not kill the shared timer */
  }
}

function tick(): void {
  const now = Date.now();
  for (const job of jobs) runJob(job, now);
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
export function schedulePoll(fn: () => void | Promise<void>, periodMs: number): () => void {
  const period = Number.isFinite(periodMs) ? Math.max(100, periodMs) : 1000;
  const now = Date.now();
  const job: Job = { fn, period, next: now, running: false, removed: false };
  jobs.add(job);
  // Leading call: match the old "poll(); setInterval(poll, …)" behavior so data
  // appears right away rather than after one full period.
  if (typeof document === "undefined" || !document.hidden) {
    runJob(job, now);
    start();
  }
  return () => {
    job.removed = true;
    jobs.delete(job);
    if (jobs.size === 0) stop();
  };
}
