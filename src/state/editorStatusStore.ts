/**
 * Cursor / language / indentation of the open editors, for the app status bar
 * (VS Code shows these for the active editor in its window status bar instead
 * of a footer inside every editor).
 *
 * Editors publish their own entry; the dock records which editor panel was
 * active last per project, so the status bar keeps showing it while focus is in
 * a terminal next to it.
 */

import { create } from "zustand";

export interface EditorStatus {
  line: number;
  col: number;
  /** Selected characters / non-empty selection ranges. */
  selChars: number;
  selRanges: number;
  /** Editor language id (see `langLabel`). */
  lang: string;
  /** "Tab" or the number of spaces of one indent level; null until known. */
  indent: "tab" | number | null;
  eol: "LF" | "CRLF";
  readOnly: boolean;
}

interface EditorStatusStore {
  byPanel: Record<string, EditorStatus>;
  /** Last active editor panel per dock (project) key. */
  activeByDock: Record<string, string | null>;
  set: (panelId: string, patch: Partial<EditorStatus>) => void;
  clear: (panelId: string) => void;
  setActive: (dockKey: string, panelId: string | null) => void;
}

const EMPTY: EditorStatus = {
  line: 1,
  col: 1,
  selChars: 0,
  selRanges: 0,
  lang: "plaintext",
  indent: null,
  eol: "LF",
  readOnly: false,
};

export const useEditorStatus = create<EditorStatusStore>((set) => ({
  byPanel: {},
  activeByDock: {},
  set: (panelId, patch) =>
    set((s) => {
      const prev = s.byPanel[panelId] ?? EMPTY;
      let changed = !(panelId in s.byPanel);
      for (const k of Object.keys(patch) as Array<keyof EditorStatus>) {
        if (prev[k] !== patch[k]) changed = true;
      }
      if (!changed) return s;
      return { byPanel: { ...s.byPanel, [panelId]: { ...prev, ...patch } } };
    }),
  clear: (panelId) =>
    set((s) => {
      if (!(panelId in s.byPanel)) return s;
      const byPanel = { ...s.byPanel };
      delete byPanel[panelId];
      return { byPanel };
    }),
  setActive: (dockKey, panelId) =>
    set((s) => (s.activeByDock[dockKey] === panelId ? s : { activeByDock: { ...s.activeByDock, [dockKey]: panelId } })),
}));

/** Map CodeMirror's indent unit string ("\t", "  ", "    ") to the status form. */
export function indentFromUnit(unit: string): EditorStatus["indent"] {
  if (unit.includes("\t")) return "tab";
  return unit.length > 0 ? unit.length : null;
}
