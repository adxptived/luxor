import { create } from "zustand";

import type { TerminalActivity } from "@/lib/terminalActivity";

interface TerminalStatusStore {
  byPanel: Record<string, TerminalActivity>;
  /** Project (dock key) each terminal panel belongs to. */
  dockOf: Record<string, string>;
  /** Projects with news from a terminal (command / agent finished) since they were last shown. */
  attention: Record<string, boolean>;
  set: (panelId: string, activity: TerminalActivity, dockKey?: string) => void;
  clear: (panelId: string) => void;
  /** Mark a background project: something in its terminals wants a look. */
  flag: (dockKey: string) => void;
  /** The project is on screen again. */
  seen: (dockKey: string) => void;
}

export const useTerminalStatus = create<TerminalStatusStore>((set) => ({
  byPanel: {},
  dockOf: {},
  attention: {},
  set: (panelId, activity, dockKey) =>
    set((s) => {
      const sameActivity = s.byPanel[panelId] === activity;
      const sameDock = dockKey === undefined || s.dockOf[panelId] === dockKey;
      if (sameActivity && sameDock) return s;
      return {
        byPanel: sameActivity ? s.byPanel : { ...s.byPanel, [panelId]: activity },
        dockOf: sameDock ? s.dockOf : { ...s.dockOf, [panelId]: dockKey as string },
      };
    }),
  clear: (panelId) =>
    set((s) => {
      if (!(panelId in s.byPanel) && !(panelId in s.dockOf)) return s;
      const byPanel = { ...s.byPanel };
      const dockOf = { ...s.dockOf };
      delete byPanel[panelId];
      delete dockOf[panelId];
      return { byPanel, dockOf };
    }),
  flag: (dockKey) => set((s) => (s.attention[dockKey] ? s : { attention: { ...s.attention, [dockKey]: true } })),
  seen: (dockKey) =>
    set((s) => {
      if (!s.attention[dockKey]) return s;
      const attention = { ...s.attention };
      delete attention[dockKey];
      return { attention };
    }),
}));

/** What a project tab should show: news from its terminals, or work in progress. */
export function projectActivity(
  state: Pick<TerminalStatusStore, "byPanel" | "dockOf" | "attention">,
  dockKey: string,
): "attention" | "running" | null {
  if (state.attention[dockKey]) return "attention";
  for (const [panelId, activity] of Object.entries(state.byPanel)) {
    if (activity === "running" && state.dockOf[panelId] === dockKey) return "running";
  }
  return null;
}
