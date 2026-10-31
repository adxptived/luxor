/**
 * Workbench rules for a free-form dock, as pure functions (no dockview import,
 * so they are unit-testable).
 *
 * The dock stays free-form — any panel can go anywhere — but it behaves like an
 * IDE workbench: groups that hold only terminals form the "terminal panel"
 * (Ctrl+` shows / focuses / hides it, new terminals land there, and it is
 * created at the bottom when missing), and files open in a group that holds
 * documents instead of between the terminal tabs.
 */

import { placementKindOf } from "./placement";

export type GroupRole = "terminal" | "file" | "tool" | "empty";

export interface GroupSnapshot {
  id: string;
  /** Component id of every panel in the group. */
  components: Array<string | undefined>;
  /** False when the group was hidden (terminal panel toggled off). */
  visible: boolean;
  /** Only grid groups take part; floating / popout groups are ignored. */
  grid: boolean;
}

/** Panels that do not make a group "busy": a lone Welcome tab may be replaced. */
const PLACEHOLDER_COMPONENTS = new Set(["welcome"]);

export function groupRole(components: ReadonlyArray<string | undefined>): GroupRole {
  if (components.length === 0) return "empty";
  if (components.every((c) => c === "terminal")) return "terminal";
  if (components.some((c) => placementKindOf(c) === "file")) return "file";
  return "tool";
}

export const terminalGroupsOf = (groups: readonly GroupSnapshot[]) =>
  groups.filter((g) => g.grid && groupRole(g.components) === "terminal");

/** True when the dock only shows placeholder panels (or nothing at all). */
export function onlyPlaceholders(groups: readonly GroupSnapshot[]): boolean {
  return groups.every((g) => g.components.every((c) => c !== undefined && PLACEHOLDER_COMPONENTS.has(c)));
}

export type TerminalToggle =
  | { kind: "create" }
  | { kind: "show"; groupIds: string[]; focus: string }
  | { kind: "focus"; groupId: string }
  | { kind: "hide"; groupIds: string[]; focus: string };

export type TerminalToggleMode = "toggle" | "show" | "visibility";

/**
 * Ctrl+` (VS Code semantics): no terminal yet → create one at the bottom;
 * terminal panel hidden → show and focus it; visible but focus elsewhere →
 * focus it; visible and focused → hide it and return focus to the editor area.
 * `mode: "show"` never hides; `mode: "visibility"` (Ctrl+J) hides a visible
 * panel even when focus is elsewhere. Hiding is skipped when the terminals are
 * all the dock has (there would be nothing left on screen).
 */
export function decideTerminalToggle(
  groups: readonly GroupSnapshot[],
  activeGroupId: string | null,
  lastTerminalGroupId?: string,
  lastOtherGroupId?: string,
  mode: TerminalToggleMode = "toggle",
): TerminalToggle {
  const terminals = terminalGroupsOf(groups);
  if (terminals.length === 0) return { kind: "create" };
  const preferred = (list: GroupSnapshot[]) =>
    list.find((g) => g.id === lastTerminalGroupId)?.id ?? list.find((g) => g.id === activeGroupId)?.id ?? list[0].id;

  const visible = terminals.filter((g) => g.visible);
  if (visible.length === 0) {
    return { kind: "show", groupIds: terminals.map((g) => g.id), focus: preferred(terminals) };
  }
  const focused = visible.some((g) => g.id === activeGroupId);
  if (mode === "show" || (mode === "toggle" && !focused)) {
    return { kind: "focus", groupId: focused && activeGroupId ? activeGroupId : preferred(visible) };
  }
  const ids = new Set(terminals.map((g) => g.id));
  const others = groups.filter((g) => g.grid && g.visible && !ids.has(g.id));
  if (others.length === 0) {
    return { kind: "focus", groupId: focused && activeGroupId ? activeGroupId : preferred(visible) };
  }
  const focus =
    others.find((g) => g.id === activeGroupId)?.id ??
    others.find((g) => g.id === lastOtherGroupId)?.id ??
    others[0].id;
  return { kind: "hide", groupIds: terminals.map((g) => g.id), focus };
}

export type Placement =
  | { kind: "within"; groupId: string; reveal: boolean }
  | { kind: "edge"; direction: "below" | "above" }
  | { kind: "split"; groupId: string; direction: "above" | "below" }
  | { kind: "default" };

/**
 * Where a new terminal goes: an existing terminal group (re-shown if it was
 * hidden), else a new group along the bottom edge — unless the dock is empty or
 * only shows the Welcome placeholder, where the terminal simply fills it.
 */
export function terminalPlacement(
  groups: readonly GroupSnapshot[],
  activeGroupId: string | null,
  remembered?: string,
): Placement {
  const terminals = terminalGroupsOf(groups);
  if (terminals.length > 0) {
    const pick =
      terminals.find((g) => g.id === activeGroupId) ??
      terminals.find((g) => g.id === remembered && g.visible) ??
      terminals.find((g) => g.visible) ??
      terminals.find((g) => g.id === remembered) ??
      terminals[0];
    return { kind: "within", groupId: pick.id, reveal: !pick.visible };
  }
  if (groups.length === 0 || onlyPlaceholders(groups)) return { kind: "default" };
  return { kind: "edge", direction: "below" };
}

/**
 * Where a file opens: a visible group that already holds documents (the active
 * one first, then the one that held a file last). Without one, a file opened
 * while a terminal group is focused gets its own group above that terminal
 * group, so documents and terminals never end up as tabs of the same strip.
 */
export function filePlacement(
  groups: readonly GroupSnapshot[],
  activeGroupId: string | null,
  remembered?: string,
): Placement {
  const files = groups.filter((g) => g.grid && g.visible && groupRole(g.components) === "file");
  if (files.length > 0) {
    const pick =
      files.find((g) => g.id === activeGroupId) ?? files.find((g) => g.id === remembered) ?? files[0];
    return { kind: "within", groupId: pick.id, reveal: false };
  }
  const active = groups.find((g) => g.id === activeGroupId);
  if (active && active.grid && groupRole(active.components) === "terminal") {
    return { kind: "split", groupId: active.id, direction: "above" };
  }
  const anyTerminal = terminalGroupsOf(groups).find((g) => g.visible);
  if (!active && anyTerminal) return { kind: "split", groupId: anyTerminal.id, direction: "above" };
  return { kind: "default" };
}

/**
 * Which preview tab (if any) a new preview should replace: a clean preview tab
 * in the target group. Pure so the replace rule is testable.
 */
export function previewToReplace(
  panels: ReadonlyArray<{ id: string; preview: boolean; dirty: boolean }>,
): string | null {
  return panels.find((p) => p.preview && !p.dirty)?.id ?? null;
}
