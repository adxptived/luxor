/**
 * Global navigation: go-to-file, go-to-symbol, go-to-panel.
 *
 * Provides the data sources and fuzzy-search wrappers the command palette
 * uses for its "Go to" mode. File and symbol lists are fetched from the
 * backend; panel lists are derived from the dock store's known panel kinds.
 */

import * as ipc from "./ipc";
import { fuzzyFilter } from "./fuzzy";
import type { FsEntry } from "./types";

// ---------------------------------------------------------------------------
// Go to file
// ---------------------------------------------------------------------------

export interface NavFile {
  path: string;
  /** Last path segment, for display. */
  name: string;
  /** Directory portion, for secondary display. */
  dir: string;
}

/** Fetch a flat file list for a project root. Returns [] on failure. */
export async function listProjectFiles(root: string): Promise<NavFile[]> {
  // Guard rails for huge trees: each directory level is a separate IPC call,
  // so cap both how deep we recurse and how many files we collect.
  const MAX_DEPTH = 12;
  const MAX_FILES = 20_000;
  const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dist", ".next", ".cache", "build", "vendor", ".venv", "__pycache__"]);
  try {
    const out: NavFile[] = [];
    // FsEntry is a single directory level (no `children`), so walk recursively
    // by listing each subdirectory on demand.
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
      let entries: FsEntry[];
      try {
        entries = await ipc.fsListDir(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= MAX_FILES) return;
        if (e.is_dir) {
          // Skip common noise directories.
          if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
          await walk(`${dir}/${e.name}`, `${prefix}${e.name}/`, depth + 1);
        } else {
          out.push({ path: `${prefix}${e.name}`, name: e.name, dir: prefix });
        }
      }
    };
    await walk(root, "", 0);
    return out;
  } catch {
    return [];
  }
}

export function filterFiles(files: NavFile[], query: string): NavFile[] {
  return fuzzyFilter(files, query, (f) => f.path, 200);
}

// ---------------------------------------------------------------------------
// Go to symbol
// ---------------------------------------------------------------------------

export interface NavSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** One-line preview of the symbol's definition line. */
  preview?: string;
}

/**
 * Extract symbols from a file's content using lightweight regex patterns.
 * This is a frontend-only heuristic — no LSP round-trip — so it works
 * instantly for any language without a language server running.
 */
const SYMBOL_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "class", re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm },
  { kind: "interface", re: /^\s*(?:export\s+)?interface\s+(\w+)/gm },
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm },
  { kind: "const", re: /^\s*(?:export\s+)?const\s+(\w+)/gm },
  { kind: "type", re: /^\s*(?:export\s+)?type\s+(\w+)/gm },
  { kind: "enum", re: /^\s*(?:export\s+)?enum\s+(\w+)/gm },
  { kind: "method", re: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(\w+)\s*\(/gm },
];

export function extractSymbols(content: string, filePath: string): NavSymbol[] {
  const symbols: NavSymbol[] = [];
  const lines = content.split("\n");
  for (const { kind, re } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      symbols.push({
        name: m[1],
        kind,
        file: filePath,
        line,
        preview: lines[line - 1]?.trim().slice(0, 120),
      });
    }
  }
  return symbols;
}

/** Fetch symbols from a list of files (limited to text files under a size cap). */
export async function listProjectSymbols(root: string, files: NavFile[]): Promise<NavSymbol[]> {
  const symbols: NavSymbol[] = [];
  const textExts = new Set(["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "sh", "sql", "vue", "svelte"]);
  const maxFiles = 150;
  for (const f of files.slice(0, maxFiles)) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!textExts.has(ext)) continue;
    try {
      const file = await ipc.fsReadText(`${root}/${f.path}`);
      if (file.content) symbols.push(...extractSymbols(file.content, f.path));
    } catch {
      /* skip unreadable files */
    }
  }
  return symbols;
}

export function filterSymbols(symbols: NavSymbol[], query: string): NavSymbol[] {
  return fuzzyFilter(symbols, query, (s) => `${s.name} ${s.kind} ${s.file}`, 200);
}

// ---------------------------------------------------------------------------
// Go to panel
// ---------------------------------------------------------------------------

export interface NavPanel {
  id: string;
  label: string;
  /** The dock store panel kind to open. */
  kind: string;
}

export const NAV_PANELS: NavPanel[] = [
  { id: "nav.files", label: "Files: File explorer", kind: "files" },
  { id: "nav.git", label: "Git: Explorer", kind: "git" },
  { id: "nav.github", label: "GitHub: Issues & PRs", kind: "github" },
  { id: "nav.agents", label: "AI: Agent monitor", kind: "agents" },
  { id: "nav.search", label: "Search: Find in project", kind: "search" },
  { id: "nav.tasks", label: "Tasks: Kanban board", kind: "tasks" },
  { id: "nav.skills", label: "Skills: Manager & market", kind: "skills" },
  { id: "nav.launcher", label: "Launcher: Quick run", kind: "launcher" },
  { id: "nav.snippets", label: "Snippets: Notes & bookmarks", kind: "snippets" },
  { id: "nav.http", label: "HTTP: REST client", kind: "http" },
  { id: "nav.docker", label: "Docker: Containers & images", kind: "docker" },
  { id: "nav.devtools", label: "Dev Tools: Logs & diagnostics", kind: "devtools" },
  { id: "nav.activity", label: "Activity: Log", kind: "activity" },
  { id: "nav.terminal", label: "Terminal: New terminal", kind: "terminal" },
];

export function filterPanels(panels: NavPanel[], query: string): NavPanel[] {
  if (!query.trim()) return panels;
  return fuzzyFilter(panels, query, (p) => p.label);
}