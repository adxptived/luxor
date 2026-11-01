/**
 * Registry of live terminal panels, so other parts of the app can type into a
 * terminal ("Run selection in terminal", "Run file") or focus one (terminal
 * switcher) without reaching into dockview internals.
 *
 * Keys are `<dockKey>:<panelId>`: layout presets reuse panel ids across
 * projects, so the panel id alone is not unique.
 */

export interface TerminalHandle {
  /**
   * Type `text` into the shell and press Enter. Text that arrives before the
   * shell has printed its prompt is held back until it has.
   */
  run: (text: string) => void;
  focus: () => void;
}

const terminals = new Map<string, TerminalHandle>();
/** Commands for terminals that are being created and have not registered yet. */
const pending = new Map<string, string[]>();

const keyOf = (dockKey: string, panelId: string) => `${dockKey}:${panelId}`;

export function registerTerminal(dockKey: string, panelId: string, handle: TerminalHandle): () => void {
  const key = keyOf(dockKey, panelId);
  terminals.set(key, handle);
  const queued = pending.get(key);
  if (queued) {
    pending.delete(key);
    for (const text of queued) handle.run(text);
  }
  return () => {
    if (terminals.get(key) === handle) terminals.delete(key);
  };
}

export function terminalHandle(dockKey: string, panelId: string): TerminalHandle | undefined {
  return terminals.get(keyOf(dockKey, panelId));
}

/** Run `text` in a terminal now, or as soon as that panel registers. */
export function runInTerminalPanel(dockKey: string, panelId: string, text: string): void {
  const handle = terminals.get(keyOf(dockKey, panelId));
  if (handle) {
    handle.run(text);
    return;
  }
  const key = keyOf(dockKey, panelId);
  pending.set(key, [...(pending.get(key) ?? []), text]);
}

/**
 * Bytes to send for "run this": one line as typed, several lines as a
 * bracketed paste when the shell asked for it (so they run as one block
 * instead of each line racing the previous one), then Enter.
 */
export function runPayload(text: string, bracketedPaste: boolean): string {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!body.includes("\n")) return `${body}\r`;
  if (bracketedPaste) return `\x1b[200~${body.replace(/\n/g, "\r")}\x1b[201~\r`;
  return `${body.replace(/\n/g, "\r")}\r`;
}

/** Test helper. */
export function resetTerminalBus(): void {
  terminals.clear();
  pending.clear();
}
