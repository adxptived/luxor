/**
 * In-memory ring buffer of frontend log entries for the live Developer log
 * panel.
 *
 * Every line that goes to the persistent `frontend.log` (errors, UI freezes,
 * STARTUP telemetry) is mirrored here so the Settings → Developer panel can
 * show a live, copyable feed *this session* without a round-trip to disk — and
 * so the in-browser/dev build (which has no Rust log file) still has something
 * useful to display and share.
 *
 * The buffer is capped so a long-running session can never grow unbounded.
 *
 * v0.6.13: Added structured log levels (DEBUG/INFO/WARN/ERROR) and categories
 * (editor, terminal, startup, ipc, ui, agent, git, fs, config, perf) so the
 * Developer panel can filter by severity and source. The plain-text format is
 * preserved for backward compatibility with the Rust log file.
 */

const CAP = 600;

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogCategory =
  | "editor"
  | "terminal"
  | "startup"
  | "ipc"
  | "ui"
  | "agent"
  | "git"
  | "fs"
  | "config"
  | "perf"
  | "system"
  | "general";

export interface LogLine {
  /** Monotonic id, handy as a React key. */
  id: number;
  /** ISO timestamp captured when the line was recorded. */
  ts: string;
  /** The raw entry text (same string that is appended to frontend.log). */
  text: string;
  /** Log level (DEBUG/INFO/WARN/ERROR). Defaults to INFO for untagged lines. */
  level: LogLevel;
  /** Category (editor/terminal/startup/…). Defaults to "general". */
  category: LogCategory;
}

let seq = 0;
const lines: LogLine[] = [];
const listeners = new Set<() => void>();

/** Minimum level to record. Lines below this are silently dropped.
 *  In development (import.meta.env.DEV) defaults to "DEBUG" to capture
 *  everything. In production defaults to "INFO" to avoid log spam and
 *  leaking internal details. Override via setMinLogLevel() at runtime. */
// `DEV` is a boolean under Vite's client types but `string | undefined` under
// plain TS (scripts tsconfig) — a truthiness check is correct for both.
let minLevel: LogLevel = import.meta.env?.DEV ? "DEBUG" : "INFO";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a broken subscriber must never break logging */
    }
  }
}

/** Parse a level tag from a raw text line like "DEBUG [editor] message".
 *  Returns [level, rest] where rest is the text without the level prefix. */
function parseLevel(text: string): [LogLevel, string] {
  const m = text.match(/^(DEBUG|INFO|WARN|ERROR)\s+(.*)$/s);
  if (m) return [m[1] as LogLevel, m[2]];
  return ["INFO", text];
}

/** Parse a category tag from text like "[editor] message".
 *  Returns [category, rest]. */
function parseCategory(text: string): [LogCategory, string] {
  const m = text.match(/^\[(\w+)\]\s+(.*)$/s);
  if (m) {
    const cat = m[1] as LogCategory;
    const valid: LogCategory[] = [
      "editor", "terminal", "startup", "ipc", "ui", "agent",
      "git", "fs", "config", "perf", "system", "general",
    ];
    if (valid.includes(cat)) return [cat, m[2]];
  }
  return ["general", text];
}

/** Record one entry. Called by `frontendLog` for every persisted line.
 *  The text may optionally start with "LEVEL [category] message" —
 *  the level and category are parsed out for structured filtering. */
export function pushLog(text: string): void {
  let level: LogLevel;
  let rest: string;
  let category: LogCategory;

  [level, rest] = parseLevel(text);
  [category, rest] = parseCategory(rest);

  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  lines.push({
    id: ++seq,
    ts: new Date().toISOString(),
    text,
    level,
    category,
  });
  if (lines.length > CAP) lines.splice(0, lines.length - CAP);
  emit();
}

/** Structured log entry — push with explicit level and category.
 *  Formats as "LEVEL [category] message | JSON data" for the text field. */
export function pushStructured(
  level: LogLevel,
  category: LogCategory,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
  const text = `${level} [${category}] ${message}${dataStr}`;
  lines.push({
    id: ++seq,
    ts: new Date().toISOString(),
    text,
    level,
    category,
  });
  if (lines.length > CAP) lines.splice(0, lines.length - CAP);
  emit();
}

/** Current snapshot (newest last). Returns a copy — callers may not mutate. */
export function getLogs(): LogLine[] {
  return lines.slice();
}

/** Filtered snapshot by level and/or category. */
export function getLogsFiltered(
  minLvl: LogLevel = "DEBUG",
  cats?: LogCategory[],
): LogLine[] {
  const minOrd = LEVEL_ORDER[minLvl];
  return lines.filter(
    (l) =>
      LEVEL_ORDER[l.level] >= minOrd &&
      (!cats || cats.includes(l.category)),
  );
}

/** Join the session buffer into a plain-text blob (one `[ts] text` per line). */
export function logsAsText(): string {
  return lines.map((l) => `[${l.ts}] ${l.text}`).join("\n");
}

/** Wipe the in-memory buffer (does not touch the persisted file). */
export function clearLogs(): void {
  lines.length = 0;
  emit();
}

/** Subscribe to buffer changes; returns an unsubscribe fn. */
export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set the minimum log level to record. */
export function setMinLogLevel(level: LogLevel): void {
  minLevel = level;
}

/** Get the current minimum log level. */
export function getMinLogLevel(): LogLevel {
  return minLevel;
}

/**
 * Parse the newest `STARTUP …` line into key→value pairs, e.g.
 * `STARTUP firstPaint=120ms jsReady=300ms` → `{ firstPaint: "120ms", … }`.
 * Returns null when no startup line has been recorded yet.
 */
export function latestStartup(): Record<string, string> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].text.match(/^STARTUP\s+(.*)$/);
    if (!m) continue;
    const out: Record<string, string> = {};
    for (const tok of m[1].split(/\s+/)) {
      const eq = tok.indexOf("=");
      if (eq > 0) out[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
    return out;
  }
  return null;
}
