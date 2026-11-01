/**
 * "Hot exit" for the editor: the text of a file with unsaved edits is kept in
 * localStorage while you type, so quitting (or a crash) does not lose it. When
 * the file is opened again — the editor tabs come back with the project
 * layout — the edits are put back on top of the file, still unsaved.
 *
 * Stored per file path with the on-disk mtime the edits were based on, so a
 * file that changed on disk in the meantime is flagged instead of silently
 * mixed. Bounded: files over MAX_FILE_CHARS are not kept, the whole set stays
 * under MAX_TOTAL_CHARS (oldest dropped first) and entries expire after
 * MAX_AGE_MS. Saving or discarding the edits deletes the entry.
 */

export const UNSAVED_PREFIX = "luxor.unsaved.";
export const MAX_FILE_CHARS = 512 * 1024;
export const MAX_TOTAL_CHARS = 3 * 1024 * 1024;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface UnsavedBuffer {
  v: 1;
  content: string;
  /** mtime (ms) of the file the edits started from; null if unknown. */
  baseMtime: number | null;
  savedAt: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function store(s?: Store): Store | null {
  if (s) return s;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const keyOf = (path: string) => `${UNSAVED_PREFIX}${path}`;

function parse(raw: string | null): UnsavedBuffer | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<UnsavedBuffer>;
    if (v.v !== 1 || typeof v.content !== "string" || typeof v.savedAt !== "number") return null;
    return { v: 1, content: v.content, baseMtime: typeof v.baseMtime === "number" ? v.baseMtime : null, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

function entries(s: Store): Array<{ key: string; size: number; savedAt: number }> {
  const out: Array<{ key: string; size: number; savedAt: number }> = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key?.startsWith(UNSAVED_PREFIX)) continue;
    const raw = s.getItem(key);
    const buf = parse(raw);
    out.push({ key, size: raw?.length ?? 0, savedAt: buf?.savedAt ?? 0 });
  }
  return out;
}

/** Keep the unsaved text of `path`. Returns false when it was not kept (too big, storage full). */
export function saveUnsaved(path: string, content: string, baseMtime: number | null, now = Date.now(), s?: Store): boolean {
  const st = store(s);
  if (!st) return false;
  const key = keyOf(path);
  if (content.length > MAX_FILE_CHARS) {
    st.removeItem(key);
    return false;
  }
  const value = JSON.stringify({ v: 1, content, baseMtime, savedAt: now } satisfies UnsavedBuffer);
  // Make room: drop expired entries, then the oldest others, until it fits.
  const others = entries(st)
    .filter((e) => e.key !== key)
    .sort((a, b) => a.savedAt - b.savedAt);
  let total = others.reduce((n, e) => n + e.size, 0) + value.length;
  for (const e of others) {
    if (total <= MAX_TOTAL_CHARS && now - e.savedAt <= MAX_AGE_MS) continue;
    st.removeItem(e.key);
    total -= e.size;
  }
  try {
    st.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The kept unsaved text of `path`, if any (and not expired). */
export function loadUnsaved(path: string, now = Date.now(), s?: Store): UnsavedBuffer | null {
  const st = store(s);
  if (!st) return null;
  const buf = parse(st.getItem(keyOf(path)));
  if (!buf) return null;
  if (now - buf.savedAt > MAX_AGE_MS) {
    st.removeItem(keyOf(path));
    return null;
  }
  return buf;
}

export function clearUnsaved(path: string, s?: Store): void {
  try {
    store(s)?.removeItem(keyOf(path));
  } catch {
    /* storage unavailable */
  }
}
