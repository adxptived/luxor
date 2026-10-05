/**
 * Terminal restore state.
 *
 * A PTY process cannot outlive the app, so "restoring" a terminal means giving
 * the user back what they were looking at: the scrollback (with colours, via
 * xterm's serialize addon), the unsent input line, and the working directory.
 * The shell itself is a fresh one that starts below a "restored" marker.
 *
 * State is stored per dock panel id in localStorage (`luxor.term.<panelId>`).
 * localStorage is synchronous, which is what lets a `pagehide` flush complete;
 * IndexedDB would be dropped mid-write when the window closes.
 */

export const TERMINAL_STATE_PREFIX = "luxor.term.";
/** Opt-out flag, `"0"` disables saving and restoring. Default: on. */
export const TERMINAL_RESTORE_KEY = "luxor.terminalRestore";

/** Serialized scrollback budget per terminal (chars). */
export const MAX_DATA_CHARS = 150_000;
/** Total budget across all terminals; oldest snapshots are evicted past it. */
export const MAX_TOTAL_CHARS = 1_500_000;
/** Snapshots younger than this are never pruned (layout may not be saved yet). */
const PRUNE_GRACE_MS = 60_000;

export interface TerminalSnapshot {
  v: 1;
  savedAt: number;
  /** Last working directory reported by the shell (OSC 7), if any. */
  cwd: string | null;
  /** Unsent input line at save time. */
  draft: string;
  /** Serialized (ANSI) scrollback. */
  data: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/**
 * Snapshot id for a terminal. Panel ids alone are not unique: a layout preset
 * keeps its panel ids, so applying one in two projects yields two terminals
 * with the same id. Scoping by dock key keeps their snapshots apart.
 */
export const terminalStateId = (dockKey: string, panelId: string): string => `${dockKey}:${panelId}`;

export const terminalStateKey = (stateId: string): string => `${TERMINAL_STATE_PREFIX}${stateId}`;

export function isRestoreEnabled(store: Pick<Storage, "getItem"> | null = defaultStore()): boolean {
  try {
    return store?.getItem(TERMINAL_RESTORE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Keep only characters that are safe to type back into a shell prompt. */
export function sanitizeDraft(draft: string): string {
  return draft.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "").slice(0, 2000);
}

/**
 * True when the text before the cursor looks like a prompt that disables echo
 * (sudo, ssh, gpg, git credentials). Keystrokes typed there must never be
 * persisted: they are a password, not a command.
 */
export function looksLikeSecretPrompt(lastLine: string): boolean {
  // Prompts that ask for a secret end with a colon: "Password:",
  // "[sudo] password for me:", "Enter passphrase for key '/x':", "Пароль:".
  // Requiring the colon keeps `echo password` from being treated as a prompt.
  return /(pass(word|phrase|code)|пароль|парол[ья]|\bpin\b|token|secret|credential|verification code)[^:]{0,60}:\s*$/i.test(
    lastLine.slice(-120),
  );
}

/** `file://host/C:/Users/me` or `file:///home/me` → a local path (OSC 7 payload). */
export function parseOsc7Cwd(data: string): string | null {
  if (!data.startsWith("file://")) return null;
  const rest = data.slice("file://".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  let path = rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  // Windows shells report `/C:/Users/me`.
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  return path || null;
}

export function loadTerminalState(
  stateId: string,
  store: Pick<Storage, "getItem"> | null = defaultStore(),
): TerminalSnapshot | null {
  try {
    const raw = store?.getItem(terminalStateKey(stateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TerminalSnapshot> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.data !== "string") return null;
    return {
      v: 1,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      cwd: typeof parsed.cwd === "string" && parsed.cwd ? parsed.cwd : null,
      draft: typeof parsed.draft === "string" ? sanitizeDraft(parsed.draft) : "",
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

function listSnapshotKeys(store: Store): Array<{ key: string; savedAt: number; size: number }> {
  const out: Array<{ key: string; savedAt: number; size: number }> = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(TERMINAL_STATE_PREFIX)) continue;
    const raw = store.getItem(key) ?? "";
    let savedAt = 0;
    try {
      savedAt = (JSON.parse(raw) as { savedAt?: number }).savedAt ?? 0;
    } catch {
      /* corrupt entry: treated as oldest, evicted first */
    }
    out.push({ key, savedAt, size: raw.length });
  }
  return out;
}

/** Evict oldest snapshots (never `keepKey`) until `needed` more chars fit. */
function makeRoom(store: Store, keepKey: string, needed: number): void {
  const entries = listSnapshotKeys(store)
    .filter((e) => e.key !== keepKey)
    .sort((a, b) => a.savedAt - b.savedAt);
  let total = entries.reduce((n, e) => n + e.size, 0) + needed;
  for (const e of entries) {
    if (total <= MAX_TOTAL_CHARS) break;
    store.removeItem(e.key);
    total -= e.size;
  }
}

/**
 * Persist a snapshot. Never throws: a full or unavailable storage degrades to
 * "nothing saved". On quota errors older snapshots are evicted once and, as a
 * last resort, only the draft/cwd are kept.
 */
export function saveTerminalState(
  stateId: string,
  snap: Omit<TerminalSnapshot, "v" | "savedAt"> & { savedAt?: number },
  store: Store | null = defaultStore(),
): boolean {
  if (!store) return false;
  const key = terminalStateKey(stateId);
  const full: TerminalSnapshot = { v: 1, savedAt: snap.savedAt ?? Date.now(), cwd: snap.cwd, draft: snap.draft, data: snap.data };
  const json = JSON.stringify(full);
  try {
    makeRoom(store, key, json.length);
    store.setItem(key, json);
    return true;
  } catch {
    try {
      for (const e of listSnapshotKeys(store).filter((x) => x.key !== key)) store.removeItem(e.key);
      store.setItem(key, json);
      return true;
    } catch {
      try {
        store.setItem(key, JSON.stringify({ ...full, data: "" }));
      } catch {
        /* storage is unusable — nothing to do */
      }
      return false;
    }
  }
}

export function deleteTerminalState(stateId: string, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(terminalStateKey(stateId));
  } catch {
    /* best effort */
  }
}

/** Remove every saved terminal snapshot (used when the feature is turned off). */
export function purgeTerminalStates(store: Store | null = defaultStore()): void {
  if (!store) return;
  try {
    for (const e of listSnapshotKeys(store)) store.removeItem(e.key);
  } catch {
    /* best effort */
  }
}

/** Snapshot ids (`dockKey:panelId`) of terminals referenced by any saved dock layout. */
export function layoutTerminalIds(store: Store | null = defaultStore()): Set<string> {
  const ids = new Set<string>();
  if (!store) return ids;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith("luxor.layout.")) continue;
      const dockKey = key.slice("luxor.layout.".length);
      const layout = JSON.parse(store.getItem(key) ?? "null") as {
        panels?: Record<string, { id?: string; contentComponent?: string }>;
      } | null;
      for (const [id, panel] of Object.entries(layout?.panels ?? {})) {
        if (panel?.contentComponent === "terminal") ids.add(terminalStateId(dockKey, panel.id ?? id));
      }
    }
  } catch {
    /* an unreadable layout must not cause snapshots to be pruned: callers skip pruning on throw */
    throw new Error("layout unreadable");
  }
  return ids;
}

/**
 * Drop snapshots whose terminal no longer exists in any saved layout (closed
 * tabs, closed projects). Recent snapshots are kept regardless. Returns how
 * many were removed.
 */
export function pruneTerminalStates(store: Store | null = defaultStore(), now: number = Date.now()): number {
  if (!store) return 0;
  let keep: Set<string>;
  try {
    keep = layoutTerminalIds(store);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const e of listSnapshotKeys(store)) {
    const id = e.key.slice(TERMINAL_STATE_PREFIX.length);
    if (keep.has(id) || now - e.savedAt < PRUNE_GRACE_MS) continue;
    try {
      store.removeItem(e.key);
      removed++;
    } catch {
      /* best effort */
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Flush on hide / unload
// ---------------------------------------------------------------------------

const flushers = new Set<() => void>();
let flushHooked = false;

/**
 * Register a callback that saves a terminal immediately. All callbacks run when
 * the window is hidden (tray, minimise, close) or unloaded, so the last second
 * of output and typing is not lost to the save debounce.
 */
export function registerTerminalFlush(fn: () => void): () => void {
  flushers.add(fn);
  if (!flushHooked && typeof window !== "undefined") {
    flushHooked = true;
    const flushAll = () => {
      for (const f of flushers) {
        try {
          f();
        } catch {
          /* never block shutdown */
        }
      }
    };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll();
    });
  }
  return () => {
    flushers.delete(fn);
  };
}
