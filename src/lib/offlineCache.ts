/**
 * Offline-first caching for the Luxor desktop app.
 *
 * Since Luxor runs as a Tauri desktop app loading from disk, the frontend
 * is already local. This module provides an additional in-memory cache
 * for frequently accessed data (file contents, git status, project lists)
 * so repeated accesses don't hit the IPC layer unnecessarily.
 *
 * It also provides a simple service-worker-like cache for the browser/dev
 * mode, storing responses keyed by URL/path.
 */

interface CacheEntry<T> {
  data: T;
  ts: number;
  /** TTL in ms (0 = no expiry). */
  ttl: number;
}

const DEFAULT_TTL = 30_000; // 30 seconds
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry<unknown>>();
const accessOrder: string[] = []; // LRU tracking

/** Get a cached value if it exists and hasn't expired. */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.ttl > 0 && Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  // Update LRU order.
  const idx = accessOrder.indexOf(key);
  if (idx >= 0) accessOrder.splice(idx, 1);
  accessOrder.push(key);
  return entry.data as T;
}

/** Set a cache entry with an optional TTL. */
export function setCached<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  // Evict oldest entries if at capacity.
  while (accessOrder.length >= MAX_ENTRIES) {
    const oldest = accessOrder.shift();
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now(), ttl });
  const idx = accessOrder.indexOf(key);
  if (idx >= 0) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

/** Invalidate a specific cache entry. */
export function invalidate(key: string): void {
  cache.delete(key);
  const idx = accessOrder.indexOf(key);
  if (idx >= 0) accessOrder.splice(idx, 1);
}

/** Invalidate all entries matching a prefix. */
export function invalidatePrefix(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      const idx = accessOrder.indexOf(key);
      if (idx >= 0) accessOrder.splice(idx, 1);
    }
  }
}

/** Clear the entire cache. */
export function clearCache(): void {
  cache.clear();
  accessOrder.length = 0;
}

/** Get or compute: returns cached value if available, otherwise calls the
 *  factory, caches the result, and returns it. */
export async function getOrCompute<T>(
  key: string,
  factory: () => Promise<T>,
  ttl: number = DEFAULT_TTL,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;
  const data = await factory();
  setCached(key, data, ttl);
  return data;
}

/** Cache statistics for the DevTools panel. */
export function cacheStats(): { entries: number; capacity: number; hitRate: number } {
  let hits = 0;
  let total = 0;
  for (const key of accessOrder) {
    const entry = cache.get(key);
    if (entry) {
      total++;
      if (entry.ttl === 0 || Date.now() - entry.ts <= entry.ttl) hits++;
    }
  }
  return {
    entries: cache.size,
    capacity: MAX_ENTRIES,
    hitRate: total > 0 ? hits / total : 0,
  };
}