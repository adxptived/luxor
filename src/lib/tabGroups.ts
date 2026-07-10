/**
 * Browser-style tab groups for the project tabs (Chrome/Edge style): named,
 * colored, collapsible clusters. Membership + group metadata live in a small
 * localStorage-backed store (see state/tabGroupsStore) keyed by project id —
 * deliberately frontend-only so we don't have to touch the Rust config schema.
 *
 * This module holds the *pure* pieces: the color palette and the layout
 * algorithm that clusters grouped tabs contiguously. Kept side-effect free so
 * it is unit-tested in isolation.
 */

export interface TabGroup {
  id: string;
  name: string;
  /** Hex color, e.g. "#5b9dff". */
  color: string;
  collapsed: boolean;
}

/** Curated palette — same spirit as the browser group colors. */
export const GROUP_COLORS: { id: string; name: string; hex: string }[] = [
  { id: "grey", name: "Grey", hex: "#8b95a7" },
  { id: "blue", name: "Blue", hex: "#5b9dff" },
  { id: "cyan", name: "Cyan", hex: "#3dd6d0" },
  { id: "green", name: "Green", hex: "#4ec77a" },
  { id: "yellow", name: "Yellow", hex: "#e6b94e" },
  { id: "orange", name: "Orange", hex: "#e8894e" },
  { id: "red", name: "Red", hex: "#f0656b" },
  { id: "pink", name: "Pink", hex: "#ff6b9d" },
  { id: "purple", name: "Purple", hex: "#a884ff" },
];

/** Pick the first palette color not already used, else cycle. */
export function nextGroupColor(existing: TabGroup[]): string {
  const used = new Set(existing.map((g) => g.color.toLowerCase()));
  const free = GROUP_COLORS.find((c) => !used.has(c.hex.toLowerCase()));
  return (free ?? GROUP_COLORS[existing.length % GROUP_COLORS.length]).hex;
}

let groupSeq = 0;
/** Collision-resistant id (time + counter + random). */
export function newGroupId(): string {
  groupSeq = (groupSeq + 1) % 1e6;
  return `grp_${Date.now().toString(36)}_${groupSeq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export type TabLayoutItem<T> =
  | { kind: "tab"; project: T }
  | { kind: "group"; group: TabGroup; tabs: T[] };

/**
 * Cluster grouped tabs contiguously at the position of each group's *first*
 * member, preserving the original order within and outside groups. Tabs whose
 * group id no longer exists (deleted group) are rendered as plain ungrouped
 * tabs. Pure: never mutates its inputs.
 */
export function buildTabLayout<T extends { id: string }>(
  ordered: T[],
  assignments: Record<string, string>,
  groups: TabGroup[],
): TabLayoutItem<T>[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: TabLayoutItem<T>[] = [];
  const emitted = new Set<string>();
  for (const project of ordered) {
    const gid = assignments[project.id];
    const group = gid ? byId.get(gid) : undefined;
    if (!group) {
      out.push({ kind: "tab", project });
      continue;
    }
    if (emitted.has(group.id)) continue;
    const tabs = ordered.filter((p) => assignments[p.id] === group.id);
    out.push({ kind: "group", group, tabs });
    emitted.add(group.id);
  }
  return out;
}

/** Number of groups that still have at least one member tab. */
export function activeGroupCount<T extends { id: string }>(
  ordered: T[],
  assignments: Record<string, string>,
  groups: TabGroup[],
): number {
  const valid = new Set(groups.map((g) => g.id));
  const seen = new Set<string>();
  for (const p of ordered) {
    const g = assignments[p.id];
    if (g && valid.has(g)) seen.add(g);
  }
  return seen.size;
}

/**
 * Prune groups that no longer have any member tab among `liveIds`, and drop
 * assignments pointing at missing projects. Returns new objects only when
 * something changed (so callers can skip needless persistence).
 */
export function pruneGroups(
  liveIds: string[],
  assignments: Record<string, string>,
  groups: TabGroup[],
): { assignments: Record<string, string>; groups: TabGroup[]; changed: boolean } {
  const live = new Set(liveIds);
  const nextAssign: Record<string, string> = {};
  for (const [pid, gid] of Object.entries(assignments)) {
    if (live.has(pid)) nextAssign[pid] = gid;
  }
  const usedGroups = new Set(Object.values(nextAssign));
  const nextGroups = groups.filter((g) => usedGroups.has(g.id));
  const changed =
    Object.keys(nextAssign).length !== Object.keys(assignments).length ||
    nextGroups.length !== groups.length;
  return { assignments: nextAssign, groups: nextGroups, changed };
}
