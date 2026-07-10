/**
 * Terminal session persistence and restore.
 *
 * Saves the scrollback buffer and metadata of terminal sessions so they
 * can be restored after a window reload or app restart. The actual PTY
 * process is not persisted — only the visible output and the command
 * history are saved, so the user sees what was on screen.
 */

export interface PersistedSession {
  id: string;
  /** Display label. */
  label: string;
  /** ISO timestamp of when the session was saved. */
  savedAt: string;
  /** The shell that was running. */
  shell: string;
  /** Working directory. */
  cwd: string;
  /** Captured scrollback text. */
  scrollback: string;
  /** Command history at save time. */
  history: string[];
}

const STORAGE_KEY = "luxor.terminalSessions";
const MAX_SESSIONS = 20;
const MAX_SCROLLBACK_CHARS = 50000;

/** Save a terminal session's state. */
export function saveSession(session: PersistedSession): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sessions: PersistedSession[] = raw ? JSON.parse(raw) : [];
    // Truncate scrollback to prevent localStorage overflow.
    const trimmed: PersistedSession = {
      ...session,
      scrollback: session.scrollback.slice(-MAX_SCROLLBACK_CHARS),
    };
    const filtered = sessions.filter((s) => s.id !== session.id);
    const next = [trimmed, ...filtered].slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* best effort */ }
}

/** Load all saved terminal sessions (newest first). */
export function loadSessions(): PersistedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Delete a saved session by id. */
export function deleteSession(id: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sessions: PersistedSession[] = raw ? JSON.parse(raw) : [];
    const next = sessions.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* best effort */ }
}

/** Clear all saved sessions. */
export function clearSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* best effort */ }
}