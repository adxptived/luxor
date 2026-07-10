/**
 * Terminal command-history capture.
 *
 * The PTY gives us no structured "command executed" event, so we reconstruct
 * the typed line from the user's keystrokes (xterm `onData`): printable
 * characters accumulate, backspace deletes, Enter commits. Control sequences
 * (arrows, etc.) reset the line because we cannot track cursor movement —
 * better to miss a command than to record a mangled one.
 */

const STORAGE_KEY = "luxor.cmdHistory";
export const HISTORY_LIMIT = 100;

export interface LineState {
  /** Characters typed since the last Enter. */
  buffer: string;
  /** True when an untrackable control sequence poisoned the line. */
  poisoned: boolean;
}

export const emptyLine = (): LineState => ({ buffer: "", poisoned: false });

/**
 * Feed one `onData` chunk into the line state.
 * Returns the new state and any committed (Enter-terminated) commands.
 */
export function feedInput(state: LineState, data: string): { state: LineState; committed: string[] } {
  let { buffer, poisoned } = state;
  const committed: string[] = [];
  let appendStart = -1;

  const flushPrintable = (end: number) => {
    if (appendStart !== -1) {
      buffer += data.slice(appendStart, end);
      appendStart = -1;
    }
  };

  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === "\r" || ch === "\n") {
      flushPrintable(i);
      const cmd = buffer.trim();
      if (cmd && !poisoned) committed.push(cmd);
      buffer = "";
      poisoned = false;
      // Swallow a \n directly following \r.
      if (ch === "\r" && data[i + 1] === "\n") i++;
    } else if (ch === "\x7f" || ch === "\b") {
      flushPrintable(i);
      buffer = buffer.slice(0, -1);
    } else if (ch === "\x1b") {
      flushPrintable(i);
      // Escape sequence (arrows, home/end, alt-keys…): skip it and poison
      // the line — the shell may now be showing a history entry we can't see.
      poisoned = true;
      buffer = "";
      i = skipEscapeSequence(data, i);
      continue;
    } else if (ch === "\x03" || ch === "\x15") {
      flushPrintable(i);
      // Ctrl+C / Ctrl+U: line discarded.
      buffer = "";
      poisoned = false;
    } else if (ch >= " " || ch === "\t") {
      // Printable bursts (large paste) are appended as a slice, not char by char.
      // Per-keystroke input still takes the same path with a 1-char slice.
      if (appendStart === -1) appendStart = i;
    } else {
      flushPrintable(i);
      // Other control chars (Ctrl+A, Ctrl+R, …) move the cursor or invoke
      // shell features we cannot track.
      poisoned = true;
    }
    i++;
  }
  flushPrintable(data.length);
  return { state: { buffer, poisoned }, committed };
}

function skipEscapeSequence(data: string, start: number): number {
  let i = start + 1;
  if (data[i] === "[" || data[i] === "O") {
    i++;
    while (i < data.length && !/[a-zA-Z~]/.test(data[i])) i++;
    return i + 1;
  }
  return i + 1; // ESC + one char (alt-key)
}

// ---------------------------------------------------------------------------
// Persistent history (localStorage, shared across terminals)
// ---------------------------------------------------------------------------

export function loadHistory(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Append commands (newest first, deduplicated, capped at HISTORY_LIMIT). */
export function appendHistory(
  commands: string[],
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string[] {
  const current = loadHistory(storage);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const cmd of commands) {
    if (!seen.has(cmd)) {
      seen.add(cmd);
      next.push(cmd);
    }
  }
  for (const cmd of current) {
    if (next.length >= HISTORY_LIMIT) break;
    if (!seen.has(cmd)) {
      seen.add(cmd);
      next.push(cmd);
    }
  }

  const capped = next.slice(0, HISTORY_LIMIT);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    /* storage full/unavailable — history is best effort */
  }
  return capped;
}

export function clearHistory(storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, "[]");
  } catch {
    /* ignore */
  }
}
