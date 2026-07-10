/**
 * Command palette category system.
 *
 * Groups commands into labeled sections so the palette can show a structured
 * list with category headers instead of a flat list. Categories are derived
 * from the command label prefix (e.g. "Git: Open panel" → "Git").
 */

import {
  Activity,
  AppWindow,
  Blocks,
  Bookmark,
  Boxes,
  Clock,
  Command,
  Database,
  DownloadCloud,
  FileText,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Globe,
  LayoutGrid,
  ListTodo,
  Palette,
  Rocket,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  Eye,
  History,
  type LucideIcon,
} from "lucide-react";

export interface PaletteCategory {
  id: string;
  label: string;
  /** Sort order (lower = first). */
  order: number;
  /** Icon shown on each command row and category header (E-wave polish). */
  icon: LucideIcon;
}

export const CATEGORIES: PaletteCategory[] = [
  { id: "recent", label: "Recently used", order: -1, icon: Clock },
  { id: "terminal", label: "Terminal", order: 1, icon: SquareTerminal },
  { id: "git", label: "Git", order: 2, icon: GitBranch },
  { id: "github", label: "GitHub", order: 3, icon: GitPullRequest },
  { id: "files", label: "Files", order: 4, icon: FolderTree },
  { id: "project", label: "Project", order: 5, icon: Boxes },
  { id: "layout", label: "Layout", order: 6, icon: LayoutGrid },
  { id: "appearance", label: "Appearance", order: 7, icon: Palette },
  { id: "view", label: "View", order: 8, icon: Eye },
  { id: "settings", label: "Settings", order: 9, icon: Settings },
  { id: "ai", label: "AI", order: 10, icon: Sparkles },
  { id: "search", label: "Search", order: 11, icon: Search },
  { id: "session", label: "Session", order: 12, icon: History },
  { id: "tab", label: "Tab", order: 13, icon: AppWindow },
  { id: "snippets", label: "Snippets", order: 14, icon: Bookmark },
  { id: "http", label: "HTTP", order: 15, icon: Globe },
  { id: "docker", label: "Docker", order: 16, icon: Blocks },
  { id: "devtools", label: "Dev Tools", order: 17, icon: FileText },
  { id: "activity", label: "Activity", order: 18, icon: Activity },
  { id: "tasks", label: "Tasks", order: 19, icon: ListTodo },
  { id: "skills", label: "Skills", order: 20, icon: Sparkles },
  { id: "launcher", label: "Launcher", order: 21, icon: Rocket },
  { id: "updates", label: "Updates", order: 22, icon: DownloadCloud },
  { id: "database", label: "Database", order: 23, icon: Database },
  { id: "command", label: "Command", order: 99, icon: Command },
];

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Extract the category id from a command label like "Git: Open panel". */
export function categoryFromLabel(label: string): string {
  const idx = label.indexOf(":");
  if (idx <= 0) return "command";
  const prefix = label.slice(0, idx).trim().toLowerCase();
  // Map common prefixes to category ids.
  const aliasMap: Record<string, string> = {
    terminal: "terminal",
    git: "git",
    github: "github",
    files: "files",
    file: "files",
    project: "project",
    layout: "layout",
    appearance: "appearance",
    view: "view",
    settings: "settings",
    ai: "ai",
    search: "search",
    session: "session",
    tab: "tab",
    snippets: "snippets",
    http: "http",
    docker: "docker",
    "dev tools": "devtools",
    devtools: "devtools",
    activity: "activity",
    tasks: "tasks",
    skills: "skills",
    launcher: "launcher",
    updates: "updates",
    database: "database",
  };
  return aliasMap[prefix] ?? "command";
}

/** Get the category metadata for a label. */
export function categoryOf(label: string): PaletteCategory {
  return CATEGORY_MAP.get(categoryFromLabel(label)) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Group commands by category, sorted by category order. */
export function groupByCategory<T extends { label: string }>(
  items: T[],
  recentIds: string[] = [],
): { category: PaletteCategory; items: T[] }[] {
  const groups = new Map<string, T[]>();

  // Recent items go first.
  const recentSet = new Set(recentIds);
  const recentItems: T[] = [];
  const restItems: T[] = [];
  for (const item of items) {
    const id = (item as { id?: string }).id;
    if (id && recentSet.has(id)) recentItems.push(item);
    else restItems.push(item);
  }

  const result: { category: PaletteCategory; items: T[] }[] = [];
  if (recentItems.length > 0) {
    result.push({ category: CATEGORY_MAP.get("recent")!, items: recentItems });
  }

  for (const item of restItems) {
    const catId = categoryFromLabel(item.label);
    if (!groups.has(catId)) groups.set(catId, []);
    groups.get(catId)!.push(item);
  }

  const sorted = [...groups.entries()].sort((a, b) => {
    const ca = CATEGORY_MAP.get(a[0]) ?? { order: 99 };
    const cb = CATEGORY_MAP.get(b[0]) ?? { order: 99 };
    return ca.order - cb.order;
  });

  for (const [catId, catItems] of sorted) {
    const cat = CATEGORY_MAP.get(catId);
    if (cat) result.push({ category: cat, items: catItems });
  }

  return result;
}
