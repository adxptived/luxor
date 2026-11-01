/**
 * Lightweight registry that lets the rest of the app talk to live editor
 * panels without prop-drilling through dockview:
 *  - "Save all" iterates every open editor and saves the dirty ones.
 *  - Jumping to a search hit reveals a line in an already-open editor.
 *
 * Each EditorPanel registers a handle on mount and removes it on unmount.
 */

export interface EditorHandle {
  /** Persist the document (used by Save All). */
  save: () => Promise<void>;
  /** Move the caret to a 1-based line/column and scroll it into view. */
  reveal: (line: number, col?: number) => void;
  /** Whether the editor currently holds unsaved changes. */
  isDirty: () => boolean;
  /** Ask for a line number and jump to it (status bar "Ln, Col"). */
  goToLine?: () => void;
  /** Open the syntax language menu at a screen position (status bar). */
  pickLanguage?: (x: number, y: number) => void;
  /** Move keyboard focus into the editor. */
  focus?: () => void;
  /** The selected text, or the line under the cursor when nothing is selected. */
  selectionOrLine?: () => string;
  /** Run the file in the terminal (saving it first); false when it has no runner. */
  runFile?: () => boolean;
}

/** The live handle of an open editor panel, if any. */
export function editorHandle(id: string | null | undefined): EditorHandle | undefined {
  return id ? editors.get(id) : undefined;
}

const editors = new Map<string, EditorHandle>();

/** Register an editor handle for a panel id; returns an unregister fn. */
export function registerEditor(id: string, handle: EditorHandle): () => void {
  editors.set(id, handle);
  return () => {
    if (editors.get(id) === handle) editors.delete(id);
  };
}

/** Reveal a line in an already-open editor (no-op if it isn't registered). */
export function revealInEditor(id: string, line: number, col = 1): void {
  try {
    editors.get(id)?.reveal(line, col);
  } catch {
    /* a disposing editor may throw — ignore */
  }
}

/** How many open editors currently have unsaved changes. */
export function dirtyEditorCount(): number {
  let n = 0;
  for (const h of editors.values()) {
    try {
      if (h.isDirty()) n += 1;
    } catch {
      /* ignore */
    }
  }
  return n;
}

/** Save every dirty editor; resolves with the number actually saved. */
export async function saveAllEditors(): Promise<number> {
  let n = 0;
  for (const h of editors.values()) {
    try {
      if (h.isDirty()) {
        await h.save();
        n += 1;
      }
    } catch {
      /* keep saving the rest even if one fails */
    }
  }
  return n;
}

/** Number of registered editors (diagnostics/tests). */
export function editorCount(): number {
  return editors.size;
}

/** Test helper: drop all handles. */
export function resetEditorBus(): void {
  editors.clear();
}
