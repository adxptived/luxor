/** Editable hotkeys: action registry, chord parsing/matching, config merge. */

import type { AppConfig } from "./types";

export interface HotkeyAction {
  id: string;
  label: string;
  default: string;
}

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  { id: "palette", label: "Command palette", default: "Ctrl+Shift+P" },
  { id: "projects.switch", label: "Switch project", default: "Ctrl+P" },
  { id: "project.open", label: "Open project folder", default: "Ctrl+O" },
  { id: "terminal.new", label: "New terminal", default: "Ctrl+`" },
  { id: "git.open", label: "Git explorer", default: "Ctrl+Shift+G" },
  { id: "files.open", label: "File explorer", default: "Ctrl+Shift+E" },
  { id: "settings.open", label: "Settings", default: "Ctrl+," },
  { id: "search.open", label: "Search in project", default: "Ctrl+Shift+F" },
  { id: "zen.toggle", label: "Toggle zen mode", default: "Ctrl+Shift+Z" },
  { id: "tab.next", label: "Next tab", default: "Ctrl+PageDown" },
  { id: "tab.prev", label: "Previous tab", default: "Ctrl+PageUp" },
  { id: "tab.close", label: "Close tab", default: "Ctrl+W" },
  { id: "tab.reopen", label: "Reopen closed tab", default: "Ctrl+Shift+T" },
  { id: "file.saveAll", label: "Save all files", default: "Ctrl+Alt+S" },
];

const CODE_KEYS: Record<string, string> = {
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Space: "Space",
};

/** Build a chord string ("Ctrl+Shift+P") from a keyboard event; null if only modifiers. */
export function chordFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const code = e.code;
  let key: string | null = null;
  if (code.startsWith("Key")) key = code.slice(3);
  else if (code.startsWith("Digit")) key = code.slice(5);
  else if (code.startsWith("F") && /^F\d{1,2}$/.test(code)) key = code;
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", "Escape", "Delete", "Home", "End", "PageUp", "PageDown", "Insert", "Backspace"].includes(code)) key = code;
  if (!key) return null;
  parts.push(key);
  return parts.length > 1 || /^F\d{1,2}$/.test(key) ? parts.join("+") : null;
}

// Tiny memo: the global keydown listener calls effectiveHotkeys() on *every*
// keystroke. The config is replaced immutably (saveConfig sets a new object),
// so a reference check safely reuses the last computed map instead of rebuilding
// it on each key event.
let cachedConfig: AppConfig | null | undefined;
let cachedMap: Record<string, string> | null = null;

/** Effective chord per action: user overrides from config, else defaults. */
export function effectiveHotkeys(config: AppConfig | null): Record<string, string> {
  if (cachedMap && config === cachedConfig) return cachedMap;
  const map: Record<string, string> = {};
  for (const a of HOTKEY_ACTIONS) map[a.id] = a.default;
  for (const hk of config?.hotkeys ?? []) {
    const chord = normalizeChord(hk.chord);
    if (hk.action in map && chord) map[hk.action] = chord;
  }
  cachedConfig = config;
  cachedMap = map;
  return map;
}

export function normalizeChord(chord: string): string {
  const parts = chord
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((part) => (part === "Meta" ? "Ctrl" : part)));
  const ordered = ["Ctrl", "Alt", "Shift"].filter((part) => mods.has(part));
  return [...ordered, key].join("+");
}

export function matchChord(e: KeyboardEvent, chord: string): boolean {
  return chordFromEvent(e) === normalizeChord(chord);
}

/** Map of chord -> action ids using it. Chords bound to 2+ actions are
 *  conflicts: only the first-processed action would win (audit 7.4). */
export function findHotkeyConflicts(config: AppConfig | null): Record<string, string[]> {
  const byChord: Record<string, string[]> = {};
  const effective = effectiveHotkeys(config);
  for (const [action, chord] of Object.entries(effective)) {
    if (!chord) continue;
    (byChord[chord] ??= []).push(action);
  }
  const conflicts: Record<string, string[]> = {};
  for (const [chord, actions] of Object.entries(byChord)) {
    if (actions.length > 1) conflicts[chord] = actions;
  }
  return conflicts;
}

/** True when assigning `chord` to `actionId` would collide with another action. */
export function chordConflictsWith(
  chord: string,
  actionId: string,
  config: AppConfig | null,
): string | null {
  const norm = normalizeChord(chord);
  if (!norm) return null;
  for (const [action, assigned] of Object.entries(effectiveHotkeys(config))) {
    if (action !== actionId && assigned === norm) return action;
  }
  return null;
}

// True on macOS. Computed once from the UA; matcher treats ⌘ as Ctrl
// (chordFromEvent maps metaKey→"Ctrl"), so only the *display* needs to differ.
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(
    // userAgentData.platform is the modern field; fall back to platform/UA.
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      "",
  );

// Pretty per-key symbols so hints read like the host OS. On macOS "Ctrl" in a
// stored chord means ⌘ (that is the modifier the matcher accepts there).
const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
const KEY_SYMBOLS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Escape: "Esc",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Backquote: "`",
};

/** Format a stored chord ("Ctrl+Shift+P") for display, OS-aware. */
export function formatChord(chord: string, isMac: boolean = IS_MAC): string {
  const parts = normalizeChord(chord).split("+").filter(Boolean);
  if (parts.length === 0) return "";
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const prettyKey = KEY_SYMBOLS[key] ?? key;
  if (isMac) {
    return [...mods.map((m) => MAC_SYMBOLS[m] ?? m), prettyKey].join("");
  }
  return [...mods, prettyKey].join("+");
}

/** Display hint for a remappable action id, reading current overrides from
 *  config. Returns "" for unknown ids so callers can omit the hint chip. */
export function hintFor(actionId: string, config: AppConfig | null, isMac: boolean = IS_MAC): string {
  const chord = effectiveHotkeys(config)[actionId];
  return chord ? formatChord(chord, isMac) : "";
}
