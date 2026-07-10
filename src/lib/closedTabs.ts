/** Recently-closed-tab tracking (Ctrl+Shift+T to reopen, browser/VS Code style).
 *
 *  Pure helpers only — the dock-side dispatch lives in `dockStore`. Kept here so
 *  the stack semantics are unit-testable without a dockview/DOM. */

export interface ReopenInfo {
  /** dockview component kind: "editor" | "terminal" | "git" | "diff" | … */
  component?: string;
  /** Panel params needed to recreate it (e.g. `{ path }` for an editor). */
  params?: Record<string, unknown>;
  title?: string;
}

/** How many recently-closed tabs we remember per project. */
export const MAX_CLOSED_TABS = 20;

/** A tab is worth remembering unless it's the throwaway Welcome launcher or
 *  has no component we could rebuild it from. */
export function isReopenable(component?: string): boolean {
  return Boolean(component) && component !== "welcome";
}

/** Stable-ish identity so reopening then re-closing the same file doesn't pile
 *  up duplicates at the top of the stack. */
export function reopenKey(info: ReopenInfo): string {
  const path = info.params?.path;
  return `${info.component ?? ""}:${typeof path === "string" ? path : ""}`;
}

/** Push a freshly closed tab onto the (most-recent-first) stack, dropping any
 *  earlier duplicate and capping the length. Returns a new array. */
export function pushClosedTab(stack: ReopenInfo[], info: ReopenInfo): ReopenInfo[] {
  if (!isReopenable(info.component)) return stack;
  const key = reopenKey(info);
  const deduped = stack.filter((s) => reopenKey(s) !== key || key.endsWith(":"));
  return [info, ...deduped].slice(0, MAX_CLOSED_TABS);
}
