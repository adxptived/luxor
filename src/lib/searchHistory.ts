/**
 * Recent project-search queries (persisted in localStorage).
 *
 * Follows the same defensive pattern as statusBarPrefs/activityLog: storage
 * may be unavailable or corrupted, so every access is guarded and falls back
 * to an empty history.
 */

const KEY = "luxor.searchHistory.v1";
const MAX_ENTRIES = 20;

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Prepend `query` (deduplicated, most-recent-first) and persist. Returns the new list. */
export function pushSearchHistory(history: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return history;
  const next = [q, ...history.filter((h) => h !== q)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full/unavailable — history simply won't persist this session.
  }
  return next;
}

export function clearSearchHistory(): string[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return [];
}
