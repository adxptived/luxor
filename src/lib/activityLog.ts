/**
 * In-app activity log: a rolling record of what happened in this Luxor
 * session (commits, terminal events, file saves, errors, …).
 *
 * Events come from two sources: explicit `logActivity()` calls at interesting
 * places, and every toast (so anything worth telling the user is also
 * recorded). The last `MAX_EVENTS` entries persist to localStorage so the
 * log survives reloads.
 */

export type ActivityKind = "info" | "success" | "error" | "git" | "terminal" | "file" | "app";

export interface ActivityEvent {
  id: number;
  /** Unix milliseconds. */
  time: number;
  kind: ActivityKind;
  message: string;
}

const STORAGE_KEY = "luxor.activity-log";
export const MAX_EVENTS = 300;

let seq = 0;
let events: ActivityEvent[] = [];
const listeners = new Set<() => void>();

function isActivityKind(v: unknown): v is ActivityKind {
  return (
    typeof v === "string" &&
    ["info", "success", "error", "git", "terminal", "file", "app"].includes(v)
  );
}

/** Restore persisted events (newest last). Corrupt data is dropped. */
function load(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: ActivityEvent[] = [];
    for (const e of data) {
      if (
        typeof e === "object" &&
        e !== null &&
        typeof (e as ActivityEvent).time === "number" &&
        typeof (e as ActivityEvent).message === "string" &&
        isActivityKind((e as ActivityEvent).kind)
      ) {
        out.push({ ...(e as ActivityEvent), id: ++seq });
      }
    }
    return out.slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

let snapshot: ActivityEvent[] | null = null;

let loaded = false;
function ensureLoaded() {
  if (!loaded) {
    loaded = true;
    events = load();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Quota/serialization problems must never break the app.
  }
}

/** Record an event. Identical consecutive messages are collapsed. */
export function logActivity(kind: ActivityKind, message: string): void {
  ensureLoaded();
  const text = message.trim();
  if (!text) return;
  const last = events[events.length - 1];
  if (last && last.message === text && last.kind === kind && Date.now() - last.time < 2000) {
    return; // drop rapid duplicates (e.g. keyed progress toasts)
  }
  events = [...events.slice(-(MAX_EVENTS - 1)), { id: ++seq, time: Date.now(), kind, message: text }];
  snapshot = null;
  persist();
  listeners.forEach((l) => l());
}

/** Snapshot, newest first. Stable identity until the log changes. */
export function getActivity(): ActivityEvent[] {
  ensureLoaded();
  if (!snapshot) snapshot = [...events].reverse();
  return snapshot;
}

export function clearActivity(): void {
  events = [];
  snapshot = null;
  persist();
  listeners.forEach((l) => l());
}

/** Subscribe to changes (returns unsubscribe). For `useSyncExternalStore`. */
export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Newest-first events filtered by kind set and a case-insensitive query. */
export function filterActivity(
  list: ActivityEvent[],
  query: string,
  kinds: ReadonlySet<ActivityKind> | null,
): ActivityEvent[] {
  const q = query.trim().toLowerCase();
  return list.filter(
    (e) => (!kinds || kinds.has(e.kind)) && (!q || e.message.toLowerCase().includes(q)),
  );
}
