/**
 * "Recently used" tracking for the command palette.
 *
 * Stores the ids of the last commands the user actually ran (localStorage,
 * newest first, deduplicated). The palette shows them on top when the query
 * is empty, so frequent actions are one Ctrl+Shift+P + Enter away.
 */

const STORAGE_KEY = "luxor.paletteRecents";
export const RECENTS_LIMIT = 8;

type ReadStorage = Pick<Storage, "getItem">;
type ReadWriteStorage = Pick<Storage, "getItem" | "setItem">;

export function loadRecents(storage: ReadStorage = localStorage): string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string").slice(0, RECENTS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Record a run command id (newest first, deduplicated, capped). Returns the new list. */
export function recordRecent(id: string, storage: ReadWriteStorage = localStorage): string[] {
  const next = [id, ...loadRecents(storage).filter((x) => x !== id)].slice(0, RECENTS_LIMIT);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable — recents are best effort */
  }
  return next;
}

/**
 * Order commands for an empty query: recents first (most recent on top),
 * everything else in its original order. Ids without a matching command
 * (e.g. a removed layout preset) are ignored.
 */
export function applyRecents<T extends { id: string }>(commands: T[], recents: string[]): T[] {
  if (recents.length === 0) return commands;
  const byId = new Map(commands.map((c) => [c.id, c]));
  const top: T[] = [];
  for (const id of recents) {
    const cmd = byId.get(id);
    if (cmd) {
      top.push(cmd);
      byId.delete(cmd.id);
    }
  }
  if (top.length === 0) return commands;
  return [...top, ...commands.filter((c) => byId.has(c.id))];
}
