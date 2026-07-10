/**
 * Performance measurement utilities for Tauri webview.
 *
 * Extends the existing perfMark.ts with structured TTI (Time to Interactive)
 * measurement, first chunk profiling, and long-task observation.
 *
 * Marks collected:
 * - bodyParsed (set inline in index.html before the entry module)
 * - moduleStart (set in perfMark.ts, first module execution)
 * - moduleReady (set in main.tsx, after top-level execution)
 * - reactMountStart / reactMountEnd (set by this module via App callback)
 * - tti (set when the main thread is idle after mount)
 *
 * All marks are stored in window.__lx and can be exported via exportPerfMarks().
 */

declare global {
  interface Window {
    __lx?: Record<string, number>;
    __lxPerf?: {
      longTasks: number[];
      observer?: PerformanceObserver;
    };
  }
}

/** Mark a performance timestamp. */
export function perfMark(name: string): void {
  if (typeof window === "undefined") return;
  window.__lx ??= {};
  window.__lx[name] = performance.now();
}

/** Measure the duration between two marks. Returns ms or null if either mark is missing. */
export function perfMeasure(from: string, to: string): number | null {
  if (typeof window === "undefined" || !window.__lx) return null;
  const start = window.__lx[from];
  const end = window.__lx[to];
  if (start == null || end == null) return null;
  return end - start;
}

/** Start observing long tasks (>50ms) on the main thread. */
export function startLongTaskObserver(): void {
  if (typeof window === "undefined" || !("PerformanceObserver" in window)) return;
  window.__lxPerf ??= { longTasks: [] };
  if (window.__lxPerf.observer) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__lxPerf!.longTasks.push(entry.duration);
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    window.__lxPerf.observer = observer;
  } catch {
    // longtask observer not supported in this webview — non-critical.
  }
}

/** Mark TTI: when requestIdleCallback fires after the React mount. */
export function markTTI(): void {
  if (typeof window === "undefined") return;
  const mark = () => {
    perfMark("tti");
    startLongTaskObserver();
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(mark, { timeout: 5000 });
  } else {
    setTimeout(mark, 2000);
  }
}

/** Export all collected performance data for diagnostics. */
export function exportPerfMarks(): Record<string, unknown> {
  const marks = window.__lx ?? {};
  const longTasks = window.__lxPerf?.longTasks ?? [];

  const measures: Record<string, number | null> = {};
  const pairs: [string, string][] = [
    ["bodyParsed", "moduleStart"],
    ["moduleStart", "moduleReady"],
    ["moduleReady", "reactMountStart"],
    ["reactMountStart", "reactMountEnd"],
    ["bodyParsed", "tti"],
  ];
  for (const [from, to] of pairs) {
    const dur = perfMeasure(from, to);
    if (dur != null) measures[`${from}_to_${to}`] = Math.round(dur);
  }

  return {
    marks: Object.fromEntries(
      Object.entries(marks).map(([k, v]) => [k, Math.round(v)]),
    ),
    measures,
    longTasks: longTasks.map((d) => Math.round(d)),
    longTaskCount: longTasks.length,
    longestLongTask: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
    navigation: performance.getEntriesByType("navigation")[0]
      ? {
          domContentLoaded: Math.round(
            (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
              .domContentLoadedEventEnd,
          ),
          load: Math.round(
            (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
              .loadEventEnd,
          ),
        }
      : null,
  };
}

/** Log a performance summary to the frontend log. */
export function logPerfSummary(): void {
  const data = exportPerfMarks();
  const measures = data.measures as Record<string, number>;
  const parts: string[] = [];
  for (const [name, ms] of Object.entries(measures)) {
    parts.push(`${name}=${ms}ms`);
  }
  if ((data.longTaskCount as number) > 0) {
    parts.push(`longTasks=${data.longTaskCount}`);
    parts.push(`longest=${data.longestLongTask}ms`);
  }
  void import("@/lib/ipc").then(({ frontendLog }) =>
    frontendLog(`PERF ${parts.join(" ")}`),
  );
}