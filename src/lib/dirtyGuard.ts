/**
 * Unsaved-changes guard for dock panels.
 *
 * Panels with editable content (the CodeMirror editor) register a probe that
 * reports whether they hold unsaved changes; every tab-close path asks the
 * guard first and pops a confirm dialog instead of silently dropping edits.
 */

const guards = new Map<string, () => boolean>();

/** Register a dirty-probe for a panel id. Returns an unregister function. */
export function registerDirtyGuard(id: string, probe: () => boolean): () => void {
  guards.set(id, probe);
  return () => {
    // Only remove our own probe (a replacement may have been registered).
    if (guards.get(id) === probe) guards.delete(id);
  };
}

/** True when the panel reports unsaved changes. Unknown panels are clean. */
export function isPanelDirty(id: string): boolean {
  try {
    return guards.get(id)?.() ?? false;
  } catch {
    return false;
  }
}

/** Number of registered probes (diagnostics/tests). */
export function dirtyGuardCount(): number {
  return guards.size;
}

/** Test helper: drop all probes. */
export function resetDirtyGuards(): void {
  guards.clear();
}
