/**
 * Built-in layouts: "Everything", "Code" and "Terminals" (of the editor area —
 * the file tree is the Explorer side bar).
 *
 * A layout is a list of steps (which panel, split from which earlier step, in
 * which direction, taking what share of the window). It is pure data so the
 * shapes are unit-testable; `dockStore.applyBuiltinLayout` replays it against
 * dockview. Users' own layouts stay in the existing preset store.
 */

export type BuiltinLayoutId = "all" | "code" | "terminals";
export type SplitDirection = "left" | "right" | "above" | "below";

export interface LayoutStep {
  /** Local key other steps refer to via `ref` (not a dockview panel id). */
  key: string;
  /** Dockview component id ("files", "editor", "terminal", …). */
  component: string;
  /** Key of an earlier step this panel is split from; omitted for the root. */
  ref?: string;
  direction?: SplitDirection;
  /** Share (0..1) of the window along the split axis given to the new group. */
  size?: number;
  params?: Record<string, unknown>;
}

export interface BuiltinLayoutInfo {
  id: BuiltinLayoutId;
  label: string;
  description: string;
}

/** Labels are literals so the Russian dictionary coverage test can see them.
 *  The project's file tree is the Explorer side bar, so layouts arrange the
 *  editor area and the terminals only. */
export const BUILTIN_LAYOUTS: BuiltinLayoutInfo[] = [
  { id: "all", label: "Everything", description: "Editor on top, two terminals below" },
  { id: "code", label: "Code", description: "Editor with one terminal underneath" },
  { id: "terminals", label: "Terminals", description: "Three terminals, editor on the side" },
];

export interface BuildOptions {
  /** Project folder for terminals (null = blank workspace). */
  cwd: string | null;
  /** A file to show in the editor right away, or null to leave the editor out. */
  file: string | null;
}

export function buildLayout(id: BuiltinLayoutId, { cwd, file }: BuildOptions): LayoutStep[] {
  const term = (key: string, extra: Partial<LayoutStep> = {}): LayoutStep => ({
    key,
    component: "terminal",
    params: { cwd },
    ...extra,
  });
  const editor: LayoutStep | null = file ? { key: "editor", component: "editor", params: { path: file } } : null;

  switch (id) {
    case "all": {
      if (!editor) return [term("t1"), term("t2", { ref: "t1", direction: "right", size: 0.5 })];
      return [
        editor,
        term("t1", { ref: "editor", direction: "below", size: 0.36 }),
        term("t2", { ref: "t1", direction: "right", size: 0.5 }),
      ];
    }
    case "code": {
      if (!editor) return [term("t1")];
      return [editor, term("t1", { ref: "editor", direction: "below", size: 0.28 })];
    }
    case "terminals": {
      const steps: LayoutStep[] = [
        term("t1"),
        term("t2", { ref: "t1", direction: "below", size: 0.34 }),
        term("t3", { ref: "t2", direction: "right", size: 0.5 }),
      ];
      if (file) steps.push({ key: "editor", component: "editor", ref: "t1", direction: "right", size: 0.45, params: { path: file } });
      return steps;
    }
  }
}

/** Files worth showing first in a fresh layout, best first (lower-cased). */
const START_FILES = ["readme.md", "readme", "package.json", "cargo.toml", "pyproject.toml", "go.mod", "index.html", "main.py"];

/** Pick a file from a project's top-level listing to open in the editor. */
export function pickStartFile(entries: ReadonlyArray<{ name: string; path: string; is_dir: boolean }>): string | null {
  const files = entries.filter((e) => !e.is_dir);
  for (const wanted of START_FILES) {
    const hit = files.find((e) => e.name.toLowerCase() === wanted);
    if (hit) return hit.path;
  }
  return null;
}
