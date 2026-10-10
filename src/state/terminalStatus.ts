import { create } from "zustand";

import type { TerminalActivity } from "@/lib/terminalActivity";

interface TerminalStatusStore {
  byPanel: Record<string, TerminalActivity>;
  set: (panelId: string, activity: TerminalActivity) => void;
  clear: (panelId: string) => void;
}

export const useTerminalStatus = create<TerminalStatusStore>((set) => ({
  byPanel: {},
  set: (panelId, activity) =>
    set((s) => (s.byPanel[panelId] === activity ? s : { byPanel: { ...s.byPanel, [panelId]: activity } })),
  clear: (panelId) =>
    set((s) => {
      if (!(panelId in s.byPanel)) return s;
      const next = { ...s.byPanel };
      delete next[panelId];
      return { byPanel: next };
    }),
}));
