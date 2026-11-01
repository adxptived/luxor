/**
 * "Files may have just changed" signal. There is no filesystem watcher, so the
 * explorer and the editors poll; terminal output that goes quiet (a command or
 * an AI agent finished writing) pokes them to look right away instead of on
 * their next tick. Debounced and rate-limited: a chatty process cannot turn it
 * into a busy loop.
 */

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastFired = 0;

/** Minimum gap between two pokes. */
const MIN_GAP_MS = 1500;

export function onFsPoke(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function fire(): void {
  timer = null;
  lastFired = Date.now();
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener mid-teardown must not stop the others */
    }
  }
}

/** Ask listeners to re-check the disk once things have been quiet for `quietMs`. */
export function pokeFs(quietMs = 600): void {
  if (timer) clearTimeout(timer);
  const wait = Math.max(quietMs, lastFired + MIN_GAP_MS - Date.now());
  timer = setTimeout(fire, wait);
}

/** Test helper. */
export function resetFsPoke(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  lastFired = 0;
  listeners.clear();
}
