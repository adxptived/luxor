import { t } from "@/lib/i18n";

/**
 * Registry of the status-bar segments. The user can toggle each segment via
 * the status-bar right-click menu (or Settings) and reorder them by drag &
 * drop. Order is persisted in `config.status_bar.segment_order`; the special
 * "spacer" segment separates the left- and right-aligned groups.
 */

import type { StatusBarConfig } from "./types";

export interface StatusSegmentDef {
  id: string;
  label: string;
}

export const SPACER_ID = "spacer";

/** Default left-to-right order. */
export const STATUS_SEGMENTS: StatusSegmentDef[] = [
  { id: "project", label: "Project name" },
  { id: "git", label: "Git branch" },
  { id: SPACER_ID, label: "Spacer" },
  { id: "agents", label: "AI agents" },
  { id: "cpu", label: "CPU usage" },
  { id: "ram", label: "RAM usage" },
  { id: "net", label: "Network throughput" },
  { id: "ping", label: "Ping" },
  { id: "tasks", label: "Open tasks" },
  { id: "timer", label: "Focus timer" },
  { id: "clock", label: "Clock" },
  { id: "zoom", label: "Zoom level" },
];

export const SEGMENT_IDS: string[] = STATUS_SEGMENTS.map((s) => s.id);

/** Map segment id -> its visibility flag in the status-bar config. */
export const SEGMENT_TOGGLES: Record<string, keyof StatusBarConfig> = {
  project: "show_project",
  git: "show_git",
  agents: "show_agents",
  cpu: "show_cpu",
  ram: "show_ram",
  net: "show_net",
  ping: "show_ping",
  tasks: "show_tasks",
  timer: "show_timer",
  clock: "show_clock",
  zoom: "show_zoom",
};

export function segmentLabel(id: string): string {
  const label = STATUS_SEGMENTS.find((s) => s.id === id)?.label ?? id;
  return t(label);
}

/** Effective order: saved (known ids, deduped) + missing ids in default order.
 *  Uses a Set for O(n) deduplication instead of the previous O(n²) Array.includes. */
export function resolveSegmentOrder(saved: string[]): string[] {
  const known = new Set(SEGMENT_IDS);
  const added = new Set<string>();
  const out: string[] = [];
  for (const id of saved) {
    if (known.has(id) && !added.has(id)) {
      out.push(id);
      added.add(id);
    }
  }
  for (const id of SEGMENT_IDS) {
    if (!added.has(id)) {
      out.push(id);
      added.add(id);
    }
  }
  return out;
}

/** New order with `dragId` moved to the position of `targetId`. */
export function moveSegment(saved: string[], dragId: string, targetId: string): string[] {
  const order = resolveSegmentOrder(saved);
  const from = order.indexOf(dragId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return order;
  order.splice(from, 1);
  order.splice(to, 0, dragId);
  return order;
}

/** Move an id one step left/right (for the Settings UI). */
export function nudgeSegment(saved: string[], id: string, delta: -1 | 1): string[] {
  const order = resolveSegmentOrder(saved);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return order;
}
