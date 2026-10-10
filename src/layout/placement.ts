/**
 * Where a newly opened panel should land in a free-form dock.
 *
 * Without a rule dockview drops every new panel into the *active* group, so a
 * file opened from the explorer ends up among the terminal tabs (or the other
 * way round). The rule: files go to a group that already holds files, terminals
 * to a group that already holds terminals; if there is none, fall back to
 * dockview's default (the active group).
 *
 * Pure functions + a tiny per-dock memory, no dockview imports, so it is unit
 * testable.
 */

export type PlacementKind = "file" | "terminal";

/** Panels that behave like documents. */
const FILE_COMPONENTS = new Set(["editor", "image", "db", "pdf", "html", "diff"]);

/** Which placement class a dock component belongs to (tool panels have none). */
export function placementKindOf(component: string | undefined): PlacementKind | null {
  if (!component) return null;
  if (component === "terminal") return "terminal";
  return FILE_COMPONENTS.has(component) ? "file" : null;
}

export interface GroupInfo {
  id: string;
  /** Component id of every panel in the group. */
  components: Array<string | undefined>;
}

/**
 * Pick the group a new panel of kind `wanted` should join, or null to let
 * dockview decide. Preference: the active group (if it fits), then the group
 * that last held such a panel, then the first group that fits.
 */
export function pickGroup(
  groups: readonly GroupInfo[],
  activeGroupId: string | null,
  wanted: PlacementKind,
  remembered?: string,
): string | null {
  const fits = groups.filter((g) => g.components.some((c) => placementKindOf(c) === wanted));
  if (fits.length === 0) return null;
  if (activeGroupId && fits.some((g) => g.id === activeGroupId)) return activeGroupId;
  if (remembered && fits.some((g) => g.id === remembered)) return remembered;
  return fits[0].id;
}

// --- Memory of the last group that held each kind (per dock) -----------------

const lastGroup = new Map<string, Partial<Record<PlacementKind, string>>>();

/** Record that a panel with `component` was just activated in `groupId`. */
export function rememberGroup(dockKey: string, component: string | undefined, groupId: string): void {
  const kind = placementKindOf(component);
  if (!kind) return;
  lastGroup.set(dockKey, { ...lastGroup.get(dockKey), [kind]: groupId });
}

export function rememberedGroup(dockKey: string, kind: PlacementKind): string | undefined {
  return lastGroup.get(dockKey)?.[kind];
}

/** Test hook / dock teardown. */
export function forgetDock(dockKey: string): void {
  lastGroup.delete(dockKey);
}
