/** In-app file explorer: lazy tree, custom context menu, opens files in
 *  the editor / image viewer / database viewer panels. */

import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  CopyPlus,
  ExternalLink,
  Database,
  File,
  FileCode,
  FilePen,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Bot,
  CopyMinus,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  SquareTerminal,
  SquareCheckBig,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VList } from "virtua";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { buildContentsPrompt, buildPathsPrompt, type AgentFile } from "@/lib/agentContext";
import type { DetectedIde, FsEntry } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { isFileManagerIde, isSystemDefaultIde, mergeIdeActions, resolveDefaultIde } from "@/lib/ideActions";
import { fileExt, useDockStore } from "@/layout/dockStore";
import { NoFolderCta } from "@/components/NoFolderCta";
import { lazy, Suspense } from "react";
import { useAppStore } from "@/state/appStore";

// Lazy because `FileEditorSurface` pulls in the ~770 KB CodeMirror runtime.
// Loaded the first time the user opens a file in the explorer preview.
const FileEditorSurface = lazy(() =>
  import("@/panels/EditorPanel").then((m) => ({ default: m.FileEditorSurface })),
);

function FileEditorSurfaceFallback({ height = 360 }: { height?: number }) {
  return (
    <div
      className="flex w-full items-center justify-center gap-2 bg-surface text-xs text-muted"
      style={{ minHeight: height }}
    >
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-edge border-t-muted" />
      {t("Loading editor…", "Loading editor…")}
    </div>
  );
}
import { confirmDestructive, openContextMenu, useUiStore, type MenuItem } from "@/state/uiStore";
import { useActiveProject } from "@/state/projectsStore";

const CODE_EXTS = new Set(["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "h", "cpp", "css", "html", "sh", "toml", "yml", "yaml", "json", "sql"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const DB_EXTS = new Set(["db", "sqlite", "sqlite3", "db3"]);
type FilterType = "all" | "code" | "image" | "config" | "doc";
const FILTER_TYPE_EXTS: Record<Exclude<FilterType, "all">, Set<string>> = {
  code: new Set(["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "h", "cpp", "cs", "rb", "swift", "kt", "php", "css", "scss", "less", "html", "sh", "bash", "zsh", "fish"]),
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "tiff"]),
  config: new Set(["toml", "yml", "yaml", "json", "jsonc", "env", "ini", "cfg", "conf", "lock", "editorconfig", "gitignore", "gitattributes", "npmrc", "nvmrc"]),
  doc: new Set(["md", "txt", "rst", "pdf", "docx", "readme"]),
};
const NON_TEXT_EXTS = new Set([...IMAGE_EXTS, ...DB_EXTS, "pdf"]);

function entryIcon(entry: FsEntry, expanded: boolean) {
  if (entry.is_dir) return expanded ? FolderOpen : Folder;
  const ext = fileExt(entry.name);
  if (IMAGE_EXTS.has(ext)) return ImageIcon;
  if (DB_EXTS.has(ext)) return Database;
  if (CODE_EXTS.has(ext)) return FileCode;
  if (ext === "md" || ext === "txt") return FileText;
  return File;
}

const HIDDEN_KEY = "luxor.files.showHidden";

const parentOf = (path: string) => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
};
const sep = (path: string) => (path.includes("\\") ? "\\" : "/");
const normalizeSearch = (value: string) =>
  value.trim().toLowerCase().replace(/[\\/]+/g, "/");

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

/** Compact, human-readable file size shown on the right of file rows on hover
 *  (e.g. "812 B", "1.2 KB", "3 MB"). Returns "" for zero/unknown sizes so the
 *  caller can skip rendering entirely. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** Shared style for the small square toolbar icon buttons in the header. */
const TOOLBAR_BTN =
  "flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40";

export function FilesPanel() {
  const project = useActiveProject();
  const toast = useAppStore((s) => s.toast);
  const config = useAppStore((s) => s.config);
  const openFile = useDockStore((s) => s.openFile);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Multi-select for "hand these files to an AI agent" (Ctrl/Shift+click).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  // QOL: quick filter, dotfile toggle and keyboard focus (arrows/Enter/F2/Del).
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // Built-in Explorer editor: uses the exact same CodeMirror surface as normal
  // editor tabs, so syntax/theme/hotkey behavior stays unified.
  const [embeddedPath, setEmbeddedPath] = useState<string | null>(null);
  const [embeddedDirty, setEmbeddedDirty] = useState(false);
  const [detectedIdes, setDetectedIdes] = useState<DetectedIde[]>([]);
  const [searching, setSearching] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const loadVersionsRef = useRef(new Map<string, number>());
  const rootRef = useRef<string | null>(null);
  const root = project && project.path !== "" ? project.path : null;
  rootRef.current = root;
  const ideActions = mergeIdeActions(config?.custom_ides, detectedIdes, true);
  const defaultIde = resolveDefaultIde(ideActions, project?.preferred_ide ?? config?.default_ide ?? null);
  const defaultIdeLabel = defaultIde ? t(defaultIde.label) : t("IDE");

  const load = useCallback(
    async (dir: string) => {
      const version = (loadVersionsRef.current.get(dir) ?? 0) + 1;
      loadVersionsRef.current.set(dir, version);
      const requestedRoot = rootRef.current;
      try {
        const entries = await ipc.fsListDir(dir);
        if (loadVersionsRef.current.get(dir) !== version || rootRef.current !== requestedRoot) return;
        setChildren((c) => ({ ...c, [dir]: entries }));
      } catch (e) {
        if (loadVersionsRef.current.get(dir) !== version || rootRef.current !== requestedRoot) return;
        toast(`${t("Cannot read folder:")} ${errorMessage(e)}`, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void ipc.launcherDetectIdes().then(
        (ides) => { if (!cancelled) setDetectedIdes(ides); },
        () => { if (!cancelled) setDetectedIdes([]); },
      );
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(run, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    loadVersionsRef.current.clear();
    setChildren({});
    setExpanded({});
    setSelected(new Set());
    setEmbeddedPath(null);
    setEmbeddedDirty(false);
    lastClickedRef.current = null;
    if (root) void load(root);
  }, [root, load]);

  const refresh = () => {
    if (!root) return;
    void load(root);
    for (const dir of Object.keys(expanded)) {
      if (expanded[dir]) void load(dir);
    }
  };

  const isTextPath = (path: string) => !NON_TEXT_EXTS.has(fileExt(path));
  const canUseEmbeddedEditor = (entry: FsEntry) => !entry.is_dir && isTextPath(entry.name);

  const openInDefaultIde = (targetDir = root) => {
    if (!targetDir || !defaultIde) return;
    const label = t(defaultIde.label);
    const action = isSystemDefaultIde(defaultIde.command)
      ? ipc.launcherOpenDefaultApp(targetDir)
      : isFileManagerIde(defaultIde.command)
        ? ipc.launcherOpenFileManager(targetDir)
        : ipc.launcherOpenIde(targetDir, defaultIde.command);
    void action.then(
      () => toast(`${t("Opening in")} ${label}`, "success"),
      (e) => toast(`${t("Open IDE")} — ${t("failed:")} ${errorMessage(e)}`, "error"),
    );
  };

  const confirmEditorSwitch = async () => {
    if (!embeddedDirty) return true;
    return await confirmDestructive({
      title: t("Discard unsaved changes?"),
      message: t("The Explorer editor has unsaved changes. Save them or discard before opening another file here."),
      confirmLabel: t("Discard"),
    });
  };

  const openInExplorerEditor = async (path: string) => {
    if (embeddedPath === path) return;
    if (!(await confirmEditorSwitch())) return;
    setEmbeddedPath(path);
    setEmbeddedDirty(false);
  };

  const closeExplorerEditor = async () => {
    if (!(await confirmEditorSwitch())) return;
    setEmbeddedPath(null);
    setEmbeddedDirty(false);
  };

  const toggle = (entry: FsEntry) => {
    if (!entry.is_dir) {
      if (canUseEmbeddedEditor(entry)) void openInExplorerEditor(entry.path);
      else openFile(entry.path);
      return;
    }
    const open = !expanded[entry.path];
    setExpanded((x) => ({ ...x, [entry.path]: open }));
    if (open && !children[entry.path]) void load(entry.path);
  };

  const newEntry = async (dir: string, isDir: boolean) => {
    const name = await useUiStore.getState().prompt({
      title: isDir ? t("New folder") : t("New file"),
      placeholder: isDir ? "folder name" : "file name",
    });
    if (!name?.trim()) return;
    const path = `${dir}${sep(dir)}${name.trim()}`;
    try {
      if (isDir) await ipc.fsCreateDir(path);
      else await ipc.fsCreateFile(path);
      void load(dir);
      if (!isDir) {
        if (isTextPath(path)) void openInExplorerEditor(path);
        else openFile(path);
      }
    } catch (e) {
      toast(`${t("Create failed:")} ${errorMessage(e)}`, "error");
    }
  };

  /** File type filter tabs. */
  const [filterType, setFilterType] = useState<FilterType>("all");

  const relPath = useCallback(
    (path: string) => (root && path.startsWith(root) ? path.slice(root.length).replace(/^[/\u005c]/, "") : path),
    [root],
  );

  const searchTerms = useMemo(
    () => normalizeSearch(filter).split(/\s+/).filter(Boolean),
    [filter],
  );
  const loadedEntryCount = useMemo(
    () => Object.values(children).reduce((n, rows) => n + rows.length, 0),
    [children],
  );

  const matchesSearch = useCallback(
    (entry: FsEntry): boolean => {
      if (searchTerms.length === 0) return true;
      const rel = normalizeSearch(relPath(entry.path));
      const name = normalizeSearch(entry.name);
      return searchTerms.every((term) => fuzzyIncludes(rel, term) || fuzzyIncludes(name, term));
    },
    [relPath, searchTerms],
  );

  const collectSearchMatches = useCallback((): FsEntry[] => {
    if (searchTerms.length === 0) return [];
    const matches: FsEntry[] = [];
    for (const rows of Object.values(children)) {
      for (const entry of rows) {
        if (!showHidden && entry.name.startsWith(".")) continue;
        if (!matchesSearch(entry)) continue;
        if (filterType !== "all" && !entry.is_dir) {
          const nameLower = entry.name.toLowerCase();
          const ext = nameLower.includes(".") ? nameLower.split(".").pop() ?? "" : "";
          if (!FILTER_TYPE_EXTS[filterType as Exclude<FilterType, "all">]?.has(ext)) continue;
        }
        matches.push(entry);
      }
    }
    return matches.sort((a, b) => relPath(a.path).localeCompare(relPath(b.path)));
  }, [children, filterType, matchesSearch, relPath, searchTerms.length, showHidden]);

  /** Returns true if this entry (or any descendant) would pass the current filter. */
  const entryMatchesFilter = useCallback(
    (entry: FsEntry): boolean => {
      if (!showHidden && entry.name.startsWith(".")) return false;
      const nameLower = entry.name.toLowerCase();
      const ext = nameLower.includes(".") ? nameLower.split(".").pop() ?? "" : "";
      if (filterType !== "all" && !entry.is_dir) {
        if (!FILTER_TYPE_EXTS[filterType as Exclude<FilterType, "all">]?.has(ext)) return false;
      }
      if (searchTerms.length > 0 && !matchesSearch(entry)) return false;
      return true;
    },
    [showHidden, filterType, matchesSearch, searchTerms.length],
  );

  const searchMatches = useMemo(() => collectSearchMatches(), [collectSearchMatches]);
  const searchMatchCount = searchMatches.length;

  const mergeSearchResults = useCallback((entries: FsEntry[]) => {
    if (!root) return;
    const nameOf = (path: string) => {
      const normalized = path.replace(/[\\/]+$/, "");
      const i = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
      return i >= 0 ? normalized.slice(i + 1) : normalized;
    };
    setChildren((cur) => {
      const next: Record<string, FsEntry[]> = { ...cur };
      const addEntry = (parent: string, entry: FsEntry) => {
        const rows = next[parent] ? [...next[parent]] : [];
        if (!rows.some((row) => row.path === entry.path)) {
          rows.push(entry);
          rows.sort((a, b) =>
            Number(b.is_dir) - Number(a.is_dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
          );
          next[parent] = rows;
        }
      };
      const ensureAncestors = (path: string) => {
        let dir = parentOf(path);
        const stack: string[] = [];
        while (dir && dir !== root && dir !== parentOf(dir)) {
          stack.push(dir);
          dir = parentOf(dir);
        }
        for (let i = stack.length - 1; i >= 0; i--) {
          const ancestor = stack[i];
          addEntry(parentOf(ancestor), {
            name: nameOf(ancestor),
            path: ancestor,
            is_dir: true,
            size: 0,
            modified: null,
          });
        }
      };
      for (const entry of entries) {
        ensureAncestors(entry.path);
        addEntry(parentOf(entry.path), entry);
      }
      return next;
    });
  }, [root]);

  const expandPaths = useCallback((paths: string[]) => {
    if (!root || paths.length === 0) return;
    const next: Record<string, boolean> = {};
    const markParents = (path: string) => {
      let parent = parentOf(path);
      while (parent && parent !== path) {
        next[parent] = true;
        if (parent === root) break;
        const prev = parent;
        parent = parentOf(parent);
        if (parent === prev) break;
      }
    };
    for (const path of paths) markParents(path);
    setExpanded((cur) => ({ ...cur, ...next }));
  }, [root]);

  const expandSearchMatches = useCallback((focusFirst = false) => {
    if (!root || searchTerms.length === 0) return;
    expandPaths(searchMatches.map((entry) => entry.path));
    if (focusFirst && searchMatches[0]) setFocusedPath(searchMatches[0].path);
  }, [expandPaths, root, searchMatches, searchTerms.length]);

  useEffect(() => {
    if (!root || searchTerms.length === 0) {
      setSearching(false);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      setSearching(true);
      void ipc.fsSearch(root, filter, 160).then(
        (entries) => {
          if (cancelled) return;
          mergeSearchResults(entries);
          expandPaths(entries.map((entry) => entry.path));
          setSearching(false);
        },
        () => {
          if (!cancelled) setSearching(false);
        },
      );
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [expandPaths, filter, mergeSearchResults, root, searchTerms.length]);

  useEffect(() => {
    if (searchTerms.length === 0) return;
    const id = window.setTimeout(() => expandSearchMatches(false), 260);
    return () => window.clearTimeout(id);
  }, [expandSearchMatches, searchTerms.length, searchMatchCount]);

  /** Returns true if a directory matches directly or has at least one visible descendant. */
  const dirHasMatch = useCallback(
    (dir: FsEntry): boolean => {
      if (searchTerms.length > 0 && matchesSearch(dir)) return true;
      const entries = children[dir.path];
      if (!entries) {
        // For type-only filters, keep unloaded folders visible so users can drill
        // down. For text search, hide unloaded nonmatching folders; recursive
        // fsSearch will inject ancestor folders for real matches.
        return searchTerms.length === 0;
      }
      for (const e of entries) {
        if (!showHidden && e.name.startsWith(".")) continue;
        if (e.is_dir) {
          if (dirHasMatch(e)) return true;
        } else {
          if (entryMatchesFilter(e)) return true;
        }
      }
      return false;
    },
    [children, showHidden, entryMatchesFilter, matchesSearch, searchTerms.length],
  );

  /** Visibility filter: dotfile toggle + quick name filter.
   *  Directories are hidden when they contain no matching descendants. */
  const isVisible = useCallback(
    (entry: FsEntry): boolean => {
      if (!showHidden && entry.name.startsWith(".")) return false;
      if (entry.is_dir) {
        // Only hide dirs when a filter is active and the dir has no matches.
        if ((filter || filterType !== "all") && !dirHasMatch(entry)) return false;
        return true;
      }
      return entryMatchesFilter(entry);
    },
    [showHidden, filter, filterType, dirHasMatch, entryMatchesFilter],
  );

  /** Flat list of currently visible rows (range select + keyboard nav). */
  const visibleRows = useCallback((): FsEntry[] => {
    const out: FsEntry[] = [];
    const walk = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        if (!isVisible(entry)) continue;
        out.push(entry);
        if (entry.is_dir && expanded[entry.path]) walk(entry.path);
      }
    };
    if (root) walk(root);
    return out;
  }, [children, expanded, root, isVisible]);

  const toggleHidden = () => {
    setShowHidden((v) => {
      try {
        localStorage.setItem(HIDDEN_KEY, v ? "0" : "1");
      } catch {
        // Preference just won't persist.
      }
      return !v;
    });
  };

  const collapseAll = () => {
    setExpanded({});
    setFocusedPath(null);
  };

  const toggleSelect = (entry: FsEntry, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedRef.current) {
      // Range select between the last clicked row and this one.
      const rows = visibleRows().map((r) => r.path);
      const a = rows.indexOf(lastClickedRef.current);
      const b = rows.indexOf(entry.path);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (const pth of rows.slice(from, to + 1)) next.add(pth);
          return next;
        });
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    lastClickedRef.current = entry.path;
  };

  /** Delete every selected entry after a single confirmation. */
  const deleteSelection = async () => {
    const paths = [...selected].sort();
    if (paths.length === 0) return;
    const ok = await confirmDestructive({
      title: `${t("Delete selected")} (${paths.length})?`,
      message: t("All selected files and folders will be deleted."),
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    const rows = visibleRows();
    let failed = 0;
    for (const path of paths) {
      const entry = rows.find((r) => r.path === path);
      try {
        await ipc.fsDelete(path, entry?.is_dir ?? true);
      } catch {
        failed += 1;
      }
    }
    if (embeddedPath && paths.some((p) => embeddedPath === p || embeddedPath.startsWith(`${p}${sep(p)}`))) {
      setEmbeddedPath(null);
      setEmbeddedDirty(false);
    }
    setSelected(new Set());
    refresh();
    if (failed > 0) toast(`${t("Delete failed:")} ${failed}`, "error");
    else toast(`${t("Deleted:")} ${paths.length}`, "success");
  };

  const copySelectionPaths = (forAgent: boolean) => {
    const paths = [...selected].map(relPath).sort();
    const text = forAgent ? buildPathsPrompt(paths) : paths.join("\n");
    void navigator.clipboard.writeText(text).then(
      () => toast(forAgent ? t("Agent prompt copied") : t("Paths copied"), "success"),
      () => toast(t("Copy failed"), "error"),
    );
  };

  const copySelectionWithContents = async () => {
    const rows = visibleRows();
    const files: AgentFile[] = [];
    for (const path of [...selected].sort()) {
      const entry = rows.find((r) => r.path === path);
      if (entry?.is_dir) {
        files.push({ path: `${relPath(path)}/ (folder)`, content: null });
        continue;
      }
      try {
        const file = await ipc.fsReadText(path);
        files.push({ path: relPath(path), content: file.content });
      } catch {
        files.push({ path: relPath(path), content: null });
      }
    }
    try {
      await navigator.clipboard.writeText(buildContentsPrompt(files));
      toast(`${t("Agent prompt copied — files:")} ${files.length}`, "success");
    } catch {
      toast(t("Copy failed"), "error");
    }
  };

  const renameEntry = async (entry: FsEntry) => {
    const name = await useUiStore.getState().prompt({ title: t("Rename"), initial: entry.name });
    if (!name?.trim() || name.trim() === entry.name) return;
    const target = `${parentOf(entry.path)}${sep(entry.path)}${name.trim()}`;
    try {
      if (embeddedPath === entry.path && embeddedDirty && !(await confirmEditorSwitch())) return;
      await ipc.fsRename(entry.path, target);
      if (embeddedPath === entry.path) {
        setEmbeddedPath(target);
        setEmbeddedDirty(false);
      }
      setSelected((prev) => {
        if (!prev.has(entry.path)) return prev;
        const next = new Set(prev);
        next.delete(entry.path);
        next.add(target);
        return next;
      });
      if (focusedPath === entry.path) setFocusedPath(target);
      void load(parentOf(entry.path));
    } catch (e) {
      toast(`${t("Rename failed:")} ${errorMessage(e)}`, "error");
    }
  };

  const deleteEntry = async (entry: FsEntry) => {
    const ok = await confirmDestructive({
      title: `${entry.is_dir ? t("Delete folder") : t("Delete file")} “${entry.name}”?`,
      message: entry.is_dir ? t("The folder and everything inside it will be deleted.") : undefined,
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await ipc.fsDelete(entry.path, entry.is_dir);
      if (embeddedPath === entry.path || (entry.is_dir && embeddedPath?.startsWith(`${entry.path}${sep(entry.path)}`))) {
        setEmbeddedPath(null);
        setEmbeddedDirty(false);
      }
      setSelected((prev) => {
        if (!prev.has(entry.path)) return prev;
        const next = new Set(prev);
        next.delete(entry.path);
        return next;
      });
      void load(parentOf(entry.path));
    } catch (e) {
      toast(`${t("Delete failed:")} ${errorMessage(e)}`, "error");
    }
  };

  /** Arrow/Enter/F2/Delete navigation over the visible rows. */
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const rows = visibleRows();
    if (rows.length === 0) return;
    const idx = focusedPath ? rows.findIndex((r) => r.path === focusedPath) : -1;
    const entry = idx >= 0 ? rows[idx] : null;
    const focusRow = (i: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (next) setFocusedPath(next.path);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(idx < 0 ? 0 : idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(idx < 0 ? 0 : idx - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (entry?.is_dir) {
          if (!expanded[entry.path]) toggle(entry);
          else focusRow(idx + 1);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (entry?.is_dir && expanded[entry.path]) toggle(entry);
        else if (entry && root) {
          const parent = parentOf(entry.path);
          if (parent !== root && parent !== entry.path) setFocusedPath(parent);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (entry) toggle(entry);
        break;
      case "F2":
        e.preventDefault();
        if (entry) void renameEntry(entry);
        break;
      case "Delete":
        e.preventDefault();
        if (entry) void deleteEntry(entry);
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      default: {
        // Type-ahead: jump to the next row whose name starts with the typed
        // character (wrapping), per the WAI-ARIA tree pattern (audit 5.1).
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const ch = e.key.toLowerCase();
          const start = idx < 0 ? 0 : idx + 1;
          for (let step = 0; step < rows.length; step++) {
            const r = rows[(start + step) % rows.length];
            if (r.name.toLowerCase().startsWith(ch)) {
              e.preventDefault();
              setFocusedPath(r.path);
              break;
            }
          }
        }
        break;
      }
    }
  };

  const menuFor = (entry: FsEntry): MenuItem[] => {
    const dir = entry.is_dir ? entry.path : parentOf(entry.path);
    return [
      ...(entry.is_dir
        ? []
        : [
            canUseEmbeddedEditor(entry)
              ? { label: t("Open in Explorer editor"), icon: FilePen, onClick: () => void openInExplorerEditor(entry.path) }
              : { label: t("Open"), icon: FilePen, onClick: () => openFile(entry.path) },
            ...(canUseEmbeddedEditor(entry)
              ? [{ label: t("Open in editor tab"), icon: ExternalLink, onClick: () => openFile(entry.path) }]
              : []),
            {
              label: t("Open with default app"),
              icon: ExternalLink,
              onClick: () => void ipc.openPath(entry.path).catch((e) => toast(errorMessage(e), "error")),
            },
            {
              label: `${t("Open project in")} ${defaultIdeLabel}`,
              icon: AppWindow,
              disabled: !defaultIde,
              onClick: () => openInDefaultIde(root),
            },
          ]),
      { label: t("Open terminal here"), icon: SquareTerminal, onClick: () => addTerminal({ cwd: dir }) },
      {
        label: t("Reveal in file manager"),
        icon: FolderOpen,
        onClick: () => void ipc.launcherOpenFileManager(dir).catch((e) => toast(errorMessage(e), "error")),
      },
      { separator: true },
      { label: t("New file…"), icon: FilePlus, onClick: () => void newEntry(dir, false) },
      { label: t("New folder…"), icon: FolderPlus, onClick: () => void newEntry(dir, true) },
      { label: t("Rename…"), icon: FilePen, hint: "F2", onClick: () => void renameEntry(entry) },
      {
        label: t("Duplicate"),
        icon: CopyPlus,
        onClick: () =>
          void (async () => {
            // "name copy", "name copy 2", … next to the original.
            const dot = entry.is_dir ? -1 : entry.name.lastIndexOf(".");
            const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name;
            const ext = dot > 0 ? entry.name.slice(dot) : "";
            const parent = parentOf(entry.path);
            for (let i = 1; i <= 99; i++) {
              const candidate = `${parent}${sep(entry.path)}${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`;
              try {
                await ipc.fsCopy(entry.path, candidate);
                void load(parent);
                return;
              } catch (e) {
                if (!String(errorMessage(e)).includes("already exists")) {
                  toast(`${t("Duplicate failed:")} ${errorMessage(e)}`, "error");
                  return;
                }
              }
            }
            toast(t("Duplicate failed: too many copies"), "error");
          })(),
      },
      {
        label: selected.has(entry.path) ? t("Deselect") : t("Select (Ctrl+click)"),
        icon: SquareCheckBig,
        onClick: () =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            return next;
          }),
      },
      {
        label: t("Copy path"),
        icon: ClipboardCopy,
        onClick: () => void navigator.clipboard.writeText(entry.path).then(() => toast(t("Path copied"), "success")),
      },
      {
        label: t("Copy relative path"),
        icon: ClipboardCopy,
        onClick: () =>
          void navigator.clipboard.writeText(relPath(entry.path)).then(() => toast(t("Path copied"), "success")),
      },
      {
        label: t("Copy name"),
        icon: ClipboardCopy,
        onClick: () => void navigator.clipboard.writeText(entry.name).then(() => toast(t("Name copied"), "success")),
      },
      { separator: true },
      { label: t("Delete"), icon: Trash2, danger: true, hint: "Del", onClick: () => void deleteEntry(entry) },
    ];
  };

  /** Flat, depth-annotated list of visible rows for the virtualized tree
   *  (audit 3.1: the tree used to render every loaded node into the DOM). */
  const flatRows = useMemo(() => {
    const out: { entry: FsEntry; depth: number }[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of children[dir] ?? []) {
        if (!isVisible(entry)) continue;
        out.push({ entry, depth });
        if (entry.is_dir && expanded[entry.path]) walk(entry.path, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return out;
  }, [children, expanded, root, isVisible]);

  const renderRow = (entry: FsEntry, depth: number): React.ReactNode => {
    {
      const Icon = entryIcon(entry, !!expanded[entry.path]);
      const isSearchMatch = searchTerms.length > 0 && matchesSearch(entry);
      return (
        <div
          key={entry.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected.has(entry.path) || focusedPath === entry.path}
          aria-expanded={entry.is_dir ? !!expanded[entry.path] : undefined}
        >
          <button
            tabIndex={-1}
            draggable={!entry.is_dir}
            onDragStart={(e) => {
              // Drag a file onto the editor area to open it (see DockLayout).
              e.dataTransfer.setData("application/x-luxor-file", entry.path);
              e.dataTransfer.setData("text/plain", entry.path);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className={`group relative flex h-7 w-full items-center gap-1.5 truncate rounded-md pr-2 text-left transition-colors duration-150 hover:bg-raised/70 ${
              selected.has(entry.path) ? "bg-accent/10 text-strong lx-active-strip" : ""
            } ${embeddedPath === entry.path ? "bg-accent/10 text-strong lx-active-strip" : ""} ${focusedPath === entry.path && !selected.has(entry.path) && embeddedPath !== entry.path ? "bg-raised text-strong" : ""} ${isSearchMatch ? "ring-1 ring-accent/20 bg-accent/5" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={(e) => {
              setFocusedPath(entry.path);
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                toggleSelect(entry, e);
                return;
              }
              lastClickedRef.current = entry.path;
              toggle(entry);
            }}
            onContextMenu={(e) => openContextMenu(e, menuFor(entry))}
            title={entry.path}
          >
            {entry.is_dir ? (
              expanded[entry.path] ? (
                <ChevronDown size={12} className="shrink-0 text-muted" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-muted" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <Icon size={14} className={`shrink-0 ${entry.is_dir ? "text-strong" : "text-muted"}`} />
            <span className={`min-w-0 flex-1 truncate ${entry.is_dir ? "font-medium text-strong" : "text-strong/90 group-hover:text-strong"}`}>{entry.name}</span>
            {!entry.is_dir && !embeddedPath && entry.size > 0 && (
              <span className="shrink-0 pl-2 text-[10px] tabular-nums text-transparent transition-colors group-hover:text-muted/70">
                {formatSize(entry.size)}
              </span>
            )}
          </button>
        </div>
      );
    }
  };

  const visibleCount = root ? visibleRows().length : 0;

  if (!root) {
    return <NoFolderCta hint={t("Attach a folder to browse and edit its files here.")} />;
  }

  return (
    <div className="flex h-full flex-col bg-surface text-sm">
      <div className="border-b border-edge bg-bar/55 p-2">
        {/* Identity: folder name, path + item count, and the primary IDE action. */}
        <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface/70 px-2.5 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <FolderOpen size={17} />
          </span>
          <div
            className="min-w-0 flex-1"
            title={`${root}\n${t("Ctrl+click / Shift+click to select files for an AI agent")}`}
          >
            <div className="truncate font-semibold leading-tight text-strong">
              {project?.name ?? t("Project files")}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] leading-tight text-muted">
              <span className="truncate">{root}</span>
              <span className="shrink-0 opacity-50">·</span>
              <span className="shrink-0 tabular-nums">
                {visibleCount} {t("items")}
              </span>
            </div>
          </div>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!defaultIde}
            title={`${t("Open project in")} ${defaultIdeLabel}`}
            onClick={() => openInDefaultIde(root)}
          >
            <AppWindow size={14} />
            <span className="hidden sm:inline">
              {t("Open in")} {defaultIdeLabel}
            </span>
          </button>
        </div>

        {/* Search by name or path. */}
        <div className="lx-filter-bar mt-2 flex items-center gap-2 rounded-lg border border-edge/50 bg-raised/50 px-2.5 py-1.5 transition-colors focus-within:border-accent/40 focus-within:bg-raised hover:border-edge">
          <Search size={13} className="shrink-0 text-muted/70" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                expandSearchMatches(true);
                treeRef.current?.focus();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setFilter("");
                setFocusedPath(null);
              }
            }}
            placeholder={t("Search files by name or path…")}
            data-testid="files-filter"
            className="min-w-0 flex-1 bg-transparent text-xs text-strong focus:outline-none placeholder:text-muted/60"
            style={{ border: "none", boxShadow: "none", WebkitAppearance: "none" }}
          />
          {filter && (
            <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] tabular-nums text-muted" title={`${loadedEntryCount} ${t("loaded entries")}`}>
              {searching ? t("Searching…") : `${searchMatchCount} ${t("matches")}`} · {visibleCount}/{loadedEntryCount}
            </span>
          )}
          {filter && (
            <button className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surface hover:text-strong" title={t("Expand matching folders and focus the first result")} onClick={() => expandSearchMatches(true)}>
              {t("Reveal")}
            </button>
          )}
          {filter && (
            <button className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface hover:text-strong" title={t("Clear filter")} onClick={() => setFilter("")}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Controls: type filter chips on the left; grouped file actions on the right. */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
            {(["all", "code", "image", "config", "doc"] as const).map((ft) => (
              <button
                key={ft}
                onClick={() => setFilterType(ft)}
                aria-pressed={filterType === ft}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  filterType === ft
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:bg-raised hover:text-strong"
                }`}
              >
                {ft === "all" ? t("All") : ft === "code" ? t("Code") : ft === "image" ? t("Images") : ft === "config" ? t("Config") : t("Docs")}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-edge/60 bg-surface/60 p-0.5">
            <button className={TOOLBAR_BTN} title={t("New file")} onClick={() => void newEntry(root, false)}>
              <FilePlus size={14} />
            </button>
            <button className={TOOLBAR_BTN} title={t("New folder")} onClick={() => void newEntry(root, true)}>
              <FolderPlus size={14} />
            </button>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-edge/70" />
            <button
              className={TOOLBAR_BTN}
              title={showHidden ? t("Hide dotfiles") : t("Show hidden files")}
              aria-pressed={showHidden}
              onClick={toggleHidden}
            >
              {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button className={TOOLBAR_BTN} title={t("Collapse all")} onClick={collapseAll}>
              <CopyMinus size={14} />
            </button>
            <button className={TOOLBAR_BTN} title={t("Refresh")} onClick={refresh}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="border-b border-edge bg-accent/5 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/20 bg-surface/80 px-2 py-2">
            <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-1 font-medium text-accent">
              <SquareCheckBig size={12} />
              {selected.size} {t("selected")}
            </span>
            <span className="min-w-36 flex-1 text-muted">{t("Copy selected files as paths or agent-ready context.")}</span>
            <button
              className="flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-strong"
              title={t("Copy an AI-agent prompt listing the selected paths")}
              onClick={() => copySelectionPaths(true)}
            >
              <Bot size={12} /> {t("Copy for agent")}
            </button>
            <button
              className="flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-strong"
              title={t("Copy an AI-agent prompt embedding the file contents")}
              onClick={() => void copySelectionWithContents()}
            >
              <Bot size={12} /> {t("+ contents")}
            </button>
            <button
              className="flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-strong"
              title={t("Copy the selected paths")}
              onClick={() => copySelectionPaths(false)}
            >
              <ClipboardCopy size={12} /> {t("Paths")}
            </button>
            <button
              className="flex items-center gap-1 rounded-lg border border-danger-soft-strong bg-danger-soft px-2 py-1 text-danger transition-colors hover:bg-danger-soft-strong"
              title={t("Delete selected")}
              onClick={() => void deleteSelection()}
            >
              <Trash2 size={12} /> {t("Delete")}
            </button>
            <button
              className="rounded-lg px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-strong"
              title={t("Clear selection")}
              onClick={() => setSelected(new Set())}
            >
              {t("Clear")}
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <div className={`flex h-full min-h-0 ${embeddedPath ? "flex-row" : ""}`}>
          <div className={`${embeddedPath ? "h-full w-[min(42%,22rem)] min-w-56 shrink-0 border-r border-edge" : "h-full flex-1"}`}>
            <div
              ref={treeRef}
              tabIndex={0}
              role="tree"
              aria-label={t("Project files")}
              aria-multiselectable="true"
              onKeyDown={onTreeKeyDown}
              className="h-full min-h-0 overflow-hidden p-2 outline-none"
              onContextMenu={(e) =>
                openContextMenu(e, [
                  { label: t("New file…"), icon: FilePlus, onClick: () => void newEntry(root, false) },
                  { label: t("New folder…"), icon: FolderPlus, onClick: () => void newEntry(root, true) },
                  { label: t("Refresh"), icon: RefreshCw, onClick: refresh },
                ])
              }
            >
              {flatRows.length > 0 && (
                // Virtualized: only visible rows hit the DOM (audit 3.1).
                <VList style={{ height: "100%" }} className="lx-virtual-scroll">
                  {flatRows.map(({ entry, depth }) => renderRow(entry, depth))}
                </VList>
              )}
              {children[root]?.length === 0 && (
                <div className="m-2 rounded-lg border border-dashed border-edge bg-bar/30 px-4 py-8 text-center text-xs text-muted">
                  <FolderOpen size={24} className="mx-auto mb-2 text-accent" />
                  <div className="font-medium text-strong">{t("Empty folder.")}</div>
                  <div className="mt-1">{t("Create a file or folder from the toolbar above.")}</div>
                </div>
              )}
              {children[root] && children[root].length > 0 && visibleCount === 0 && (
                <div className="m-2 rounded-lg border border-dashed border-edge bg-bar/30 px-4 py-8 text-center text-xs text-muted">
                  <Search size={24} className="mx-auto mb-2 text-accent" />
                  <div className="font-medium text-strong">{t("No files match this filter")}</div>
                  <div className="mx-auto mt-1 max-w-xs leading-5 opacity-70">
                    {t("Search checks loaded folders. Expand or refresh folders to include more files.")}
                  </div>
                  <div className="mt-3 flex justify-center gap-2">
                    <button className="rounded-lg border border-edge px-2 py-1 hover:bg-raised hover:text-strong" onClick={() => expandSearchMatches()}>{t("Reveal matches")}</button>
                    <button className="rounded-lg border border-edge px-2 py-1 hover:bg-raised hover:text-strong" onClick={() => setFilter("")}>{t("Clear filter")}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {embeddedPath && (
            <div className="flex min-w-0 flex-1 flex-col bg-surface">
              <div className="flex items-center gap-1.5 border-b border-edge/50 bg-bar/40 px-2 py-1.5 text-xs text-muted">
                <FilePen size={13} className="text-accent" />
                <span className="min-w-0 flex-1 truncate" title={embeddedPath}>
                  {t("Explorer editor")} · {relPath(embeddedPath)}{embeddedDirty ? " *" : ""}
                </span>
                <button
                  className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                  disabled={!defaultIde}
                  onClick={() => openInDefaultIde(root)}
                  title={`${t("Open project in")} ${defaultIdeLabel}`}
                >
                  <AppWindow size={12} />
                  <span className="hidden lg:inline">{defaultIdeLabel}</span>
                </button>
                <button className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-strong" onClick={() => openFile(embeddedPath)} title={t("Open in editor tab")}>
                  <ExternalLink size={12} />
                </button>
                <button className="rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-strong" onClick={() => void closeExplorerEditor()} title={t("Close editor")}>
                  <X size={12} />
                </button>
              </div>
              <Suspense fallback={<FileEditorSurfaceFallback />}>
                <FileEditorSurface
                  key={embeddedPath}
                  path={embeddedPath}
                  panelId={`files-editor:${embeddedPath}`}
                  embedded
                  onDirtyChange={setEmbeddedDirty}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
