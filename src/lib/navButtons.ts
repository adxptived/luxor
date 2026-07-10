/**
 * Registry of the configurable nav buttons (Terminal / Git / Files / …)
 * shown in the top bar or sidebar. Order and visibility are user-editable
 * (drag & drop, right-click, Settings) and persisted in
 * `config.ui.nav_order` / `config.ui.nav_hidden`.
 */

import {
  BarChart3,
  Bot,
  Command,
  ScrollText,
  Compass,
  FolderGit2,
  FolderOpen,
  GraduationCap,
  Package,
  Rocket,
  Settings,
  SquareKanban,
  TerminalSquare,
  type LucideIcon,
  Search as SearchIcon,
  Scissors,
  Globe,
  Container,
  Wrench,
  Code2,
  HardDrive,
} from "lucide-react";

import { t } from "./i18n";

export interface NavButtonDef {
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
}

/** Default button order. Unknown ids in a saved config are ignored. */
export const NAV_BUTTONS: NavButtonDef[] = [
  { id: "terminal", label: "Terminal", title: "New terminal (Ctrl+`)", icon: TerminalSquare },
  { id: "ide", label: "Open in IDE", title: "Open project in your IDE", icon: Code2 },
  { id: "filemanager", label: "File manager", title: "Open project in the OS file manager", icon: HardDrive },
  { id: "git", label: "Git", title: "Git explorer (Ctrl+Shift+G)", icon: FolderGit2 },
  { id: "files", label: "Files", title: "File explorer (Ctrl+Shift+E)", icon: FolderOpen },
  { id: "launcher", label: "Launcher", title: "Project launcher panel", icon: Rocket },
  { id: "tasks", label: "Tasks", title: "Kanban task board", icon: SquareKanban },
  { id: "skills", label: "Skills", title: "Agent skills: manager & market", icon: GraduationCap },
  { id: "presets", label: "Presets", title: "Layout presets", icon: Package },
  { id: "agents", label: "Agents", title: "Running AI agents (Claude Code, Codex, …)", icon: Bot },
  { id: "activity", label: "Activity", title: "Activity log: what happened this session", icon: ScrollText },
  { id: "analytics", label: "Analytics", title: "Activity analytics, dashboards & Discord RPC", icon: BarChart3 },
  { id: "search", label: "Search", title: "Search in project (Ctrl+Shift+F)", icon: SearchIcon },
  { id: "snippets", label: "Snippets", title: "Snippets, notes & bookmarks", icon: Scissors },
  { id: "http", label: "HTTP", title: "REST client scratch pad", icon: Globe },
  { id: "docker", label: "Docker", title: "Docker containers & images", icon: Container },
  { id: "devtools", label: "Dev Tools", title: "Env, logs, disk, deps, processes, crashes", icon: Wrench },
  { id: "github", label: "GitHub", title: "GitHub issues, pull requests & CI", icon: FolderGit2 },
  // Only shown when `ui.browser_enabled` is on (Settings → Interface).
  { id: "web", label: "Browser", title: "Built-in web browser", icon: Compass },
  { id: "palette", label: "Palette", title: "Command palette (Ctrl+Shift+P)", icon: Command },
  { id: "settings", label: "Settings", title: "Settings (Ctrl+,)", icon: Settings },
];

export const NAV_IDS: string[] = NAV_BUTTONS.map((b) => b.id);

/**
 * Buttons shown in the sidebar/top-bar on a fresh install. We deliberately
 * keep this minimal — a wall of 19 icons overwhelms new users — and let people
 * reveal the rest from the nav right-click menu or Settings → Interface.
 */
export const DEFAULT_VISIBLE_NAV: string[] = ["terminal", "git", "files", "settings"];

/** Every button that is hidden by default (the inverse of the visible set). */
export const DEFAULT_NAV_HIDDEN: string[] = NAV_IDS.filter(
  (id) => !DEFAULT_VISIBLE_NAV.includes(id),
);

/** A copy of the def with label/title translated to the active UI language. */
export function localizedNavButton(def: NavButtonDef): NavButtonDef {
  return { ...def, label: t(`nav.${def.id}`, def.label), title: t(`nav.${def.id}.title`, def.title) };
}

export function navButtonDef(id: string): NavButtonDef | undefined {
  return NAV_BUTTONS.find((b) => b.id === id);
}

/**
 * Full effective order (including hidden buttons): the saved order first
 * (known ids only, deduped), then any ids missing from it in default order.
 */
export function resolveNavOrder(saved: string[]): string[] {
  const known = new Set(NAV_IDS);
  const out: string[] = [];
  for (const id of saved) {
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  for (const id of NAV_IDS) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Visible buttons in effective order. */
export function visibleNavButtons(saved: string[], hidden: string[]): NavButtonDef[] {
  const hiddenSet = new Set(hidden);
  return resolveNavOrder(saved)
    .filter((id) => !hiddenSet.has(id))
    .map((id) => navButtonDef(id))
    .filter((d): d is NavButtonDef => d !== undefined);
}

/** New full order with `dragId` moved to the position of `targetId`. */
export function moveNavButton(saved: string[], dragId: string, targetId: string): string[] {
  const order = resolveNavOrder(saved);
  const from = order.indexOf(dragId);
  if (from < 0 || order.indexOf(targetId) < 0 || dragId === targetId) return order;
  order.splice(from, 1);
  // Re-resolve the target index AFTER removal: when dragging forward the
  // removal shifts the target one slot left, and inserting at the stale index
  // would land the button after the target instead of at its position.
  order.splice(order.indexOf(targetId), 0, dragId);
  return order;
}

/** Move an id one step up/down within the full order (for the Settings UI). */
export function nudgeNavButton(saved: string[], id: string, delta: -1 | 1): string[] {
  const order = resolveNavOrder(saved);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return order;
}
