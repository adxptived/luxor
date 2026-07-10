/**
 * Performance metrics collection and dashboard data.
 *
 * Collects runtime performance metrics (memory usage, frame times, event
 * loop lag, IPC latency) and provides aggregated data for the DevTools
 * performance dashboard.
 */

export interface PerfSample {
  ts: number;
  /** Used JS heap size in MB. */
  heapUsedMB: number;
  /** Total JS heap size in MB. */
  heapTotalMB: number;
  /** Frame time in ms (time between animation frames). */
  frameMs: number;
  /** Event loop lag in ms (timer drift). */
  eventLoopLagMs: number;
}

export interface PerfSummary {
  /** Average heap usage over the window. */
  avgHeapMB: number;
  /** Peak heap usage. */
  peakHeapMB: number;
  /** Average frame time. */
  avgFrameMs: number;
  /** Worst frame time (jank indicator). */
  worstFrameMs: number;
  /** Average event loop lag. */
  avgEventLoopLagMs: number;
  /** Number of samples collected. */
  sampleCount: number;
  /** Collection duration in seconds. */
  durationSecs: number;
}

const MAX_SAMPLES = 300; // ~5 min at 1s intervals
let samples: PerfSample[] = [];
let collecting = false;
let frameTimer: number | null = null;
let lastFrameTime = 0;
let lastTimerTime = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start collecting performance samples. */
export function startPerfCollection(): void {
  if (collecting) return;
  collecting = true;
  lastFrameTime = performance.now();
  lastTimerTime = performance.now();

  // Frame time measurement via requestAnimationFrame.
  const measureFrame = () => {
    if (!collecting) return;
    const now = performance.now();
    const frameMs = now - lastFrameTime;
    lastFrameTime = now;
    // Only record if we have a meaningful frame time.
    if (frameMs > 0 && frameMs < 1000) {
      // Store frame time for the next interval tick.
      pendingFrameMs = frameMs;
    }
    frameTimer = requestAnimationFrame(measureFrame);
  };
  frameTimer = requestAnimationFrame(measureFrame);

  // Collect a sample every second.
  intervalId = setInterval(() => {
    if (!collecting) return;
    const now = performance.now();
    const eventLoopLagMs = now - lastTimerTime - 1000; // expected 1000ms interval
    lastTimerTime = now;

    let heapUsedMB = 0;
    let heapTotalMB = 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    if (mem) {
      heapUsedMB = mem.usedJSHeapSize / 1024 / 1024;
      heapTotalMB = mem.totalJSHeapSize / 1024 / 1024;
    }

    samples.push({
      ts: Date.now(),
      heapUsedMB,
      heapTotalMB,
      frameMs: pendingFrameMs,
      eventLoopLagMs: Math.max(0, eventLoopLagMs),
    });
    if (samples.length > MAX_SAMPLES) samples.shift();
    pendingFrameMs = 0;
    emitPerf();
  }, 1000);
}

let pendingFrameMs = 0;

/** Stop collecting performance samples. */
export function stopPerfCollection(): void {
  collecting = false;
  if (frameTimer !== null) cancelAnimationFrame(frameTimer);
  if (intervalId !== null) clearInterval(intervalId);
  frameTimer = null;
  intervalId = null;
}

/** Get all collected samples. */
export function getPerfSamples(): PerfSample[] {
  return samples.slice();
}

/** Compute a summary from collected samples. */
export function getPerfSummary(): PerfSummary {
  if (samples.length === 0) {
    return {
      avgHeapMB: 0, peakHeapMB: 0, avgFrameMs: 0, worstFrameMs: 0,
      avgEventLoopLagMs: 0, sampleCount: 0, durationSecs: 0,
    };
  }
  const heaps = samples.map((s) => s.heapUsedMB);
  const frames = samples.map((s) => s.frameMs).filter((f) => f > 0);
  const lags = samples.map((s) => s.eventLoopLagMs);
  const duration = (samples[samples.length - 1].ts - samples[0].ts) / 1000;
  return {
    avgHeapMB: heaps.reduce((a, b) => a + b, 0) / heaps.length,
    peakHeapMB: Math.max(...heaps),
    avgFrameMs: frames.length > 0 ? frames.reduce((a, b) => a + b, 0) / frames.length : 0,
    worstFrameMs: frames.length > 0 ? Math.max(...frames) : 0,
    avgEventLoopLagMs: lags.reduce((a, b) => a + b, 0) / lags.length,
    sampleCount: samples.length,
    durationSecs: duration,
  };
}

/** Clear all collected samples. */
export function clearPerfSamples(): void {
  samples = [];
  emitPerf();
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

const perfListeners = new Set<() => void>();

function emitPerf(): void {
  for (const fn of perfListeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function subscribePerf(fn: () => void): () => void {
  perfListeners.add(fn);
  return () => perfListeners.delete(fn);
}

/** Whether collection is currently active. */
export function isCollecting(): boolean {
  return collecting;
}