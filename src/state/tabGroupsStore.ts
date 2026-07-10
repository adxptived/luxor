/**
 * Browser-style tab groups state. Membership (project id → group id) and group
 * metadata (name / color / collapsed) are persisted to localStorage — kept off
 * the Rust config on purpose so groups are a pure frontend concern and never
 * require a config-schema migration. Pure helpers live in lib/tabGroups.
 */

import { create } from "zustand";

import { newGroupId, nextGroupColor, pruneGroups, type TabGroup } from "@/lib/tabGroups";
import { registerMigration } from "@/lib/stateMigration";

// Phase 23: Register state migration for tab groups.
registerMigration("luxor.tabGroups.v1", 2, {
  0: (data) => {
    // v0 (unversioned) → v1: ensure groups array and assignments object exist.
    const d = data as { groups?: unknown[]; assignments?: Record<string, string> };
    return { groups: Array.isArray(d.groups) ? d.groups : [], assignments: d.assignments ?? {} };
  },
  1: (data) => data, // v1 → v2: no-op (placeholder for future schema changes).
});

const STORE_KEY = "luxor.tabGroups.v1";

interface Persisted {
  groups: TabGroup[];
  /** project id → group id */
  assignments: Record<string, string>;
}

function load(): Persisted {
  const fallback: Persisted = { groups: [], assignments: {} };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      groups: Array.isArray(p.groups) ? (p.groups as TabGroup[]) : [],
      assignments: p.assignments && typeof p.assignments === "object" ? (p.assignments as Record<string, string>) : {},
    };
  } catch {
    return fallback;
  }
}

function save(s: Persisted): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ groups: s.groups, assignments: s.assignments }));
  } catch {
    /* private mode — best effort */
  }
}

interface TabGroupsState extends Persisted {
  /** Create a group seeded with one tab; returns the new group id. */
  newGroupFromTab: (projectId: string, name: string) => string;
  renameGroup: (id: string, name: string) => void;
  recolorGroup: (id: string, color: string) => void;
  toggleCollapse: (id: string) => void;
  /** Delete the group and unassign all its members (tabs stay open). */
  deleteGroup: (id: string) => void;
  assignTab: (projectId: string, groupId: string) => void;
  removeTab: (projectId: string) => void;
  /** Drop closed tabs / empty groups. Call when the project list changes. */
  sync: (liveIds: string[]) => void;
}

export const useTabGroups = create<TabGroupsState>((set, get) => {
  const commit = (next: Persisted) => {
    save(next);
    set(next);
  };

  return {
    ...load(),

    newGroupFromTab: (projectId, name) => {
      const { groups, assignments } = get();
      const id = newGroupId();
      const group: TabGroup = { id, name, color: nextGroupColor(groups), collapsed: false };
      commit({ groups: [...groups, group], assignments: { ...assignments, [projectId]: id } });
      return id;
    },

    renameGroup: (id, name) => {
      const { groups, assignments } = get();
      commit({ groups: groups.map((g) => (g.id === id ? { ...g, name } : g)), assignments });
    },

    recolorGroup: (id, color) => {
      const { groups, assignments } = get();
      commit({ groups: groups.map((g) => (g.id === id ? { ...g, color } : g)), assignments });
    },

    toggleCollapse: (id) => {
      const { groups, assignments } = get();
      commit({ groups: groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)), assignments });
    },

    deleteGroup: (id) => {
      const { groups, assignments } = get();
      const nextAssign: Record<string, string> = {};
      for (const [pid, gid] of Object.entries(assignments)) {
        if (gid !== id) nextAssign[pid] = gid;
      }
      commit({ groups: groups.filter((g) => g.id !== id), assignments: nextAssign });
    },

    assignTab: (projectId, groupId) => {
      const { groups, assignments } = get();
      commit({ groups, assignments: { ...assignments, [projectId]: groupId } });
    },

    removeTab: (projectId) => {
      const { groups, assignments } = get();
      if (!(projectId in assignments)) return;
      const nextAssign = { ...assignments };
      delete nextAssign[projectId];
      // A group with no members left is removed too.
      const used = new Set(Object.values(nextAssign));
      commit({ groups: groups.filter((g) => used.has(g.id)), assignments: nextAssign });
    },

    sync: (liveIds) => {
      const { groups, assignments } = get();
      const r = pruneGroups(liveIds, assignments, groups);
      if (r.changed) commit({ groups: r.groups, assignments: r.assignments });
    },
  };
});
