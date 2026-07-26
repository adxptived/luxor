/** Agent skills: a manager for the skill folders inside the project
 *  (.agents / .claude / .codex / .cursor / .opencode / .github) and a
 *  market tab that browses the skills.sh catalog and installs skills
 *  straight into the project. */

import { formatNumber } from "@/lib/format";
import {
  BadgeCheck,
  ChevronDown,
  CircleCheck,
  ClipboardCopy,
  Copy,
  Globe,
  Download,
  ExternalLink,
  FileText,
  FolderInput,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Star,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { fnv1a64Hex } from "@/lib/skillsHash";
import type { MarketSkill, SkillEntry } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { openContextMenu, useUiStore, type MenuItem } from "@/state/uiStore";
import { useActiveProject } from "@/state/projectsStore";

/** Known skill-folder conventions (mirrors luxor-core::skills::CONVENTIONS). */
export const SKILL_CONVENTIONS: { id: string; dir: string }[] = [
  { id: "agents", dir: ".agents/skills" },
  { id: "claude", dir: ".claude/skills" },
  { id: "codex", dir: ".codex/skills" },
  { id: "cursor", dir: ".cursor/skills" },
  { id: "opencode", dir: ".opencode/skills" },
  { id: "github", dir: ".github/skills" },
];

const LAST_TARGET_KEY = "luxor.skills.lastInstallTarget";

function readLastTarget(): { convention: string; scope: "project" | "global" } | null {
  try {
    const raw = localStorage.getItem(LAST_TARGET_KEY);
    return raw ? (JSON.parse(raw) as { convention: string; scope: "project" | "global" }) : null;
  } catch {
    return null;
  }
}

function installTitle(root: string | null): string {
  const last = readLastTarget();
  const scope = last?.scope === "global" || !root ? "global" : "project";
  return `${t("Install into")} ${scope} ${last?.convention ?? "claude"} ${t("(last used) — use the arrow to pick another target")}`;
}

const FAVORITES_KEY = "luxor.skills.favorites";

function loadFavorites(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    /* ignore quota errors */
  }
}

const SKILL_TEMPLATE = (name: string) =>
  `---\nname: ${name}\ndescription: What this skill is for and when an agent should use it.\n---\n\n# ${name}\n\nInstructions for the agent…\n`;

export function SkillsPanel() {
  const [tab, setTab] = useState<"project" | "global" | "market">("project");
  const project = useActiveProject();
  const root = project?.path || null;
  // User-level skills live under the home directory (~/.claude/skills, …).
  const [globalRoot, setGlobalRoot] = useState<string | null>(null);
  useEffect(() => {
    ipc.skillsGlobalRoot().then(setGlobalRoot, () => setGlobalRoot(null));
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface text-sm" data-testid="skills-panel">
      <div className="border-b border-edge bg-bar/55 p-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface/70 px-3 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <GraduationCap size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-strong">Skills</div>
            <div className="truncate text-xs text-muted">{project ? project.name : "no project"}</div>
          </div>
          <span className="rounded-md border border-edge bg-raised px-2 py-1 text-[11px] text-muted">Project · Global · Market</span>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-edge bg-bar/30 px-2 py-2 lx-noscrollbar">
        <TabButton active={tab === "project"} onClick={() => setTab("project")} icon={FolderInput}>
          Project skills
        </TabButton>
        <TabButton active={tab === "global"} onClick={() => setTab("global")} icon={Globe}>
          Global skills
        </TabButton>
        <TabButton active={tab === "market"} onClick={() => setTab("market")} icon={Store}>
          Market
        </TabButton>
      </div>
      {tab === "project" && <ManagerTab root={root} scope="project" />}
      {tab === "global" && <ManagerTab root={globalRoot} scope="global" />}
      {tab === "market" && <MarketTab root={root} globalRoot={globalRoot} />}
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
        props.active
          ? "border-muted bg-raised text-strong"
          : "border-edge bg-surface text-muted hover:bg-raised hover:text-strong"
      }`}
      onClick={props.onClick}
    >
      <props.icon size={13} /> {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Project skills (manager)
// ---------------------------------------------------------------------------

function ManagerTab(props: { root: string | null; scope: "project" | "global" }) {
  const { root, scope } = props;
  const toast = useAppStore((s) => s.toast);
  const openFile = useDockStore((s) => s.openFile);
  const [entries, setEntries] = useState<SkillEntry[]>([]);
  const [scanned, setScanned] = useState(false);
  // Local filter across the installed skills (name / convention / path).
  const [query, setQuery] = useState("");
  // Favorite skills (persisted, keyed by skill path) + favorites-only filter.
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [favOnly, setFavOnly] = useState(false);

  const toggleFavorite = (path: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  };

  const reload = useCallback(async () => {
    if (!root) return;
    try {
      setEntries(await ipc.skillsScan(root));
    } catch (e) {
      toast(`${t("Skill scan failed:")} ${errorMessage(e)}`, "error");
    } finally {
      setScanned(true);
    }
  }, [root, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Apply the local search filter (all terms must match) before grouping.
  // Declared BEFORE the `!root` early return so the hook order never changes
  // between renders (rules-of-hooks).
  const filtered = useMemo(() => {
    const base = favOnly ? entries.filter((s) => favorites.has(s.path)) : entries;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return base;
    return base.filter((s) => {
      const hay = `${s.name} ${s.convention} ${s.path}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [entries, query, favOnly, favorites]);

  if (!root) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-muted">
        {scope === "global" ? (
          <>{t("Could not resolve the home directory for global skills.")}</>
        ) : (
          <>
            Open a project folder to manage its agent skills
            <br />
            (.agents, .claude, .codex, .cursor, …).
          </>
        )}
      </div>
    );
  }

  const newSkill = async (convention: string) => {
    const name = await useUiStore
      .getState()
      .prompt({ title: t("New skill name"), placeholder: "my-skill" });
    if (!name?.trim()) return;
    try {
      const entry = await ipc.skillsImport(root, convention, name.trim(), SKILL_TEMPLATE(name.trim()));
      toast(`${t("Skill created:")} “${entry.name}” → ${convention}`, "success");
      await reload();
      openFile(entry.skill_md);
    } catch (e) {
      toast(`${t("Failed to create skill:")} ${errorMessage(e)}`, "error");
    }
  };

  const importFile = async (convention: string) => {
    const path = await ipc.pickFile();
    if (!path) return;
    try {
      const file = await ipc.fsReadText(path);
      const base = path.split(/[\\/]/).pop() ?? "imported-skill";
      const name = base.replace(/\.md$/i, "");
      const entry = await ipc.skillsImport(root, convention, name, file.content);
      toast(`${t("Imported:")} “${entry.name}” → ${convention}`, "success");
      await reload();
    } catch (e) {
      toast(`${t("Import failed:")} ${errorMessage(e)}`, "error");
    }
  };

  const conventionMenu = (e: React.MouseEvent, action: (convention: string) => void) => {
    openContextMenu(
      e,
      SKILL_CONVENTIONS.map((c) => ({
        label: c.dir,
        icon: FolderInput,
        onClick: () => action(c.id),
      })),
    );
  };

  const copyTo = async (entry: SkillEntry, convention: string) => {
    try {
      const copied = await ipc.skillsCopy(root, entry.path, convention);
      toast(`${t("Copied:")} “${entry.name}” → ${copied.convention}`, "success");
      await reload();
    } catch (e) {
      toast(`${t("Copy failed:")} ${errorMessage(e)}`, "error");
    }
  };

  const setEnabled = async (entry: SkillEntry, enabled: boolean) => {
    try {
      await ipc.skillsSetEnabled(entry.path, enabled);
      toast(`“${entry.name}” — ${enabled ? t("skill enabled") : t("skill disabled")}`, "success");
      await reload();
    } catch (e) {
      toast(`${enabled ? t("Failed to enable:") : t("Failed to disable:")} ${errorMessage(e)}`, "error");
    }
  };

  const removeSkill = async (entry: SkillEntry) => {
    const ok = await useUiStore.getState().confirm({
      title: `${t("Delete skill")} “${entry.name}”?`,
      message: `${t("This permanently deletes:")} ${entry.path}`,
      confirmLabel: t("Delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await ipc.skillsRemove(entry.path);
      toast(`${t("Skill deleted:")} “${entry.name}”`, "success");
      await reload();
    } catch (e) {
      toast(`${t("Delete failed:")} ${errorMessage(e)}`, "error");
    }
  };

  /** Compare a skill with its skills.sh version; optionally update in place. */
  const checkUpdate = async (entry: SkillEntry) => {
    try {
      const catalog = await ipc.marketCatalog();
      const match = catalog.find(
        (m) =>
          m.skill_id.toLowerCase() === entry.name.toLowerCase() ||
          m.name.toLowerCase() === entry.name.toLowerCase(),
      );
      if (!match) {
        toast(`"${entry.name}" is not on skills.sh — nothing to compare`, "info");
        return;
      }
      const remote = await ipc.marketSkillMd(match.source, match.skill_id);
      if (fnv1a64Hex(remote) === entry.content_hash) {
        toast(`"${entry.name}" is up to date with skills.sh`, "success");
        return;
      }
      const ok = await useUiStore.getState().confirm({
        title: `${t("Update from skills.sh:")} “${entry.name}”?`,
        message: `${t("The local copy differs from")} ${match.source}. ${t("Overwrite SKILL.md with the market version?")}`,
        confirmLabel: t("Update"),
      });
      if (!ok) return;
      await ipc.fsWriteText(entry.skill_md, remote);
      toast(`"${entry.name}" updated from skills.sh`, "success");
      await reload();
    } catch (e) {
      toast(`${t("Update check failed:")} ${errorMessage(e)}`, "error");
    }
  };

  const entryMenu = (e: React.MouseEvent, entry: SkillEntry) => {
    const items: MenuItem[] = [
      { label: t("Open SKILL.md"), icon: Pencil, onClick: () => openFile(entry.skill_md) },
      {
        label: entry.enabled ? t("Disable (agents skip it)") : t("Enable"),
        icon: Power,
        onClick: () => void setEnabled(entry, !entry.enabled),
      },
      { label: t("Check for update on skills.sh"), icon: RefreshCw, onClick: () => void checkUpdate(entry) },
      {
        label: t("Copy path"),
        icon: Copy,
        onClick: () => void navigator.clipboard.writeText(entry.path),
      },
      { separator: true },
      ...SKILL_CONVENTIONS.filter((c) => c.id !== entry.convention).map((c) => ({
        label: `${t("Copy to")} ${c.dir}`,
        icon: ClipboardCopy,
        onClick: () => void copyTo(entry, c.id),
      })),
      { separator: true },
      { label: t("Delete skill"), icon: Trash2, danger: true, onClick: () => void removeSkill(entry) },
    ];
    openContextMenu(e, items);
  };

  // Duplicate detection: same name in several conventions; identical content
  // (same hash) is flagged separately so true copies are easy to clean up.
  const nameCount = new Map<string, number>();
  const hashCount = new Map<string, number>();
  for (const en of entries) {
    nameCount.set(en.name.toLowerCase(), (nameCount.get(en.name.toLowerCase()) ?? 0) + 1);
    hashCount.set(en.content_hash, (hashCount.get(en.content_hash) ?? 0) + 1);
  }

  const grouped = SKILL_CONVENTIONS.map((c) => ({
    ...c,
    skills: filtered.filter((s) => s.convention === c.id),
  }));
  const noMatches = scanned && entries.length > 0 && filtered.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="skills-manager">
      <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-edge bg-bar/30 p-2">
        <button
          className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong"
          onClick={(e) => conventionMenu(e, (c) => void newSkill(c))}
        >
          <Plus size={12} /> New skill…
        </button>
        <button
          className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong"
          onClick={(e) => conventionMenu(e, (c) => void importFile(c))}
        >
          <FolderInput size={12} /> Import .md file…
        </button>
        <div className="relative ml-auto min-w-[140px] flex-1 sm:max-w-[240px]">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            className="w-full rounded-lg border border-edge bg-surface pl-7 pr-7 py-1.5 text-xs text-strong outline-none focus:border-accent"
            placeholder={t("Search installed skills…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="skills-manager-search"
          />
          {query && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-strong"
              title={t("Clear search")}
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          className={`rounded-lg border p-1.5 ${
            favOnly ? "border-warning-soft-strong bg-warning-soft text-warning" : "border-edge bg-surface text-muted hover:bg-raised hover:text-strong"
          }`}
          title={t("Show favorites only")}
          aria-pressed={favOnly}
          onClick={() => setFavOnly((v) => !v)}
        >
          <Star size={14} className={favOnly ? "fill-current" : ""} />
        </button>
        <button
          className="rounded-lg border border-edge bg-surface p-1.5 text-muted hover:bg-raised hover:text-strong"
          title={scope === "global" ? t("Rescan home directory") : t("Rescan project")}
          onClick={() => void reload()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {noMatches && (
        <div className="rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-8 text-center text-xs text-muted">
          {favOnly && !query.trim()
            ? t("No favorite skills yet — click the star on a skill to add one.")
            : `${t("No installed skills match")} “${query.trim()}”.`}
        </div>
      )}
      {scanned && entries.length === 0 && (
        <div className="rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-8 text-center text-xs text-muted">
          <GraduationCap size={26} className="mx-auto mb-3 text-accent" />
          <div className="font-medium text-strong">No skills found {scope === "global" ? "in your home directory" : "in this project"} yet.</div>
          <div className="mt-1">Create one with “New skill…” or install one from the Market tab.</div>
        </div>
      )}
      {grouped
        .filter((g) => g.skills.length > 0)
        .map((g) => (
          <div key={g.id} className="mb-3 overflow-hidden rounded-lg border border-edge bg-bar/25">
            <div className="border-b border-edge bg-raised/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {g.dir} <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-normal">{g.skills.length}</span>
            </div>
            {g.skills.map((s) => (
              <div
                key={s.path}
                data-testid="skill-entry"
                className={`group mx-1 mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised ${
                  s.enabled ? "" : "opacity-50"
                }`}
                onDoubleClick={() => openFile(s.skill_md)}
                onContextMenu={(e) => entryMenu(e, s)}
                title={t("Double-click to open · right-click for actions")}
              >
                <FileText size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-strong">{s.name}</span>
                <button
                  className={`rounded p-1 transition-opacity ${
                    favorites.has(s.path)
                      ? "text-warning"
                      : "text-muted opacity-0 hover:text-warning group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  }`}
                  title={favorites.has(s.path) ? t("Remove from favorites") : t("Add to favorites")}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(s.path);
                  }}
                >
                  <Star size={13} className={favorites.has(s.path) ? "fill-current" : ""} />
                </button>
                {!s.enabled && (
                  <span className="rounded bg-raised px-1 text-[10px] text-warning">off</span>
                )}
                {(hashCount.get(s.content_hash) ?? 0) > 1 && (
                  <span
                    className="rounded bg-raised px-1 text-[10px] text-warning"
                    title={t("Identical copy exists in another convention folder")}
                  >
                    identical copy
                  </span>
                )}
                {(nameCount.get(s.name.toLowerCase()) ?? 0) > 1 &&
                  (hashCount.get(s.content_hash) ?? 0) <= 1 && (
                    <span
                      className="rounded bg-raised px-1 text-[10px] text-info"
                      title="A skill with the same name exists elsewhere (different content)"
                    >
                      duplicate name
                    </span>
                  )}
                {!s.is_dir && <span className="text-[10px] text-muted">bare .md</span>}
                <span className="text-[10px] text-muted">{(s.size / 1024).toFixed(1)} KB</span>
                <button
                  data-testid="skill-toggle"
                  className={`rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${
                    s.enabled ? "text-success hover:text-warning" : "text-muted hover:text-success opacity-100"
                  }`}
                  title={s.enabled ? t("Disable skill (agents will skip it)") : t("Enable skill")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void setEnabled(s, !s.enabled);
                  }}
                >
                  <Power size={13} />
                </button>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market (skills.sh)
// ---------------------------------------------------------------------------

/** A source is installable when it is a real `owner/repo` GitHub path (skills
 *  from external registries like smithery.ai / modelscope.cn can only be opened
 *  on the web). */
export function isInstallable(source: string): boolean {
  return source.includes("/") && !source.includes("..");
}

/** Case-insensitive local match: every whitespace term must appear in the
 *  skill's name, id or source. Mirrors the backend `filter_catalog` so the
 *  market search keeps returning results even when skills.sh is unreachable. */
export function localFilter(list: MarketSkill[] | null, query: string): MarketSkill[] {
  if (!list) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return list.filter((s) => {
    const hay = `${s.name} ${s.skill_id} ${s.source}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

function MarketTab(props: { root: string | null; globalRoot: string | null }) {
  const { root, globalRoot } = props;
  const toast = useAppStore((s) => s.toast);
  const [catalog, setCatalog] = useState<MarketSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  // Live search across the whole skills.sh catalog (not just the cached
  // homepage). Empty query → browse the featured catalog.
  const [results, setResults] = useState<MarketSkill[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  // True when the visible results came from the local cache (network down).
  const [offlineSearch, setOfflineSearch] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  // Keep the latest catalog reachable inside the (debounced) search effect
  // without re-triggering a network search every time the catalog loads.
  const catalogRef = useRef<MarketSkill[] | null>(null);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  // First load goes through the 1h disk cache (fast); the reload button
  // forces a fresh network fetch.
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await ipc.marketCatalog(force));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced full-text search: 250ms after the last keystroke we hit the
  // combined skills.sh + local-cache search. An empty query clears results →
  // browse mode.
  useEffect(() => {
    const q = filter.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      setSearchErr(null);
      setOfflineSearch(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = window.setTimeout(() => {
      ipc
        .marketSearch(q)
        .then((r) => {
          if (cancelled) return;
          // Backend already merges live + cached hits. If it still came back
          // empty (e.g. a brand-new query the cache never saw), filter the
          // in-memory featured catalog as a last local resort.
          const merged = r.length > 0 ? r : localFilter(catalogRef.current, q);
          setResults(merged);
          setOfflineSearch(false);
          setSearchErr(null);
        })
        .catch((e) => {
          if (cancelled) return;
          // Network down: fall back to the local catalog instead of a hard
          // error, so the user can still find and install cached skills.
          const local = localFilter(catalogRef.current, q);
          if (local.length > 0) {
            setResults(local);
            setOfflineSearch(true);
            setSearchErr(null);
          } else {
            setResults([]);
            setOfflineSearch(false);
            setSearchErr(errorMessage(e));
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [filter, searchNonce]);

  // Names of skills already installed in the project or globally → badge.
  const scanInstalled = useCallback(async () => {
    const names = new Set<string>();
    for (const r of [root, globalRoot]) {
      if (!r) continue;
      try {
        for (const e of await ipc.skillsScan(r)) names.add(e.name.toLowerCase());
      } catch {
        /* scan is best-effort */
      }
    }
    setInstalled(names);
  }, [root, globalRoot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void scanInstalled();
  }, [scanInstalled]);

  const install = async (skill: MarketSkill, convention: string, targetRoot: string) => {
    try {
      const content = await ipc.marketSkillMd(skill.source, skill.skill_id);
      const entry = await ipc.skillsImport(targetRoot, convention, skill.skill_id, content);
      // Remember the target so the next install is one click.
      localStorage.setItem(
        LAST_TARGET_KEY,
        JSON.stringify({ convention, scope: targetRoot === root ? "project" : "global" }),
      );
      toast(`${t("Installed:")} “${entry.name}” → ${convention}`, "success");
      void scanInstalled();
    } catch (e) {
      toast(`${t("Install failed:")} ${errorMessage(e)}`, "error");
    }
  };

  /** One-click install into the last used target (default: project .claude). */
  const quickInstall = (skill: MarketSkill) => {
    const last = readLastTarget();
    const scope = last?.scope === "global" || !root ? "global" : "project";
    const targetRoot = scope === "project" ? root : globalRoot;
    if (!targetRoot) {
      toast(t("Open a project folder first to install skills into it"), "error");
      return;
    }
    void install(skill, last?.convention ?? "claude", targetRoot);
  };

  const installMenu = (e: React.MouseEvent, skill: MarketSkill) => {
    const items: MenuItem[] = [];
    if (root) {
      for (const c of SKILL_CONVENTIONS) {
        items.push({
          label: `${t("Project")} · ${c.dir}`,
          icon: Download,
          onClick: () => void install(skill, c.id, root),
        });
      }
    }
    if (globalRoot) {
      if (items.length > 0) items.push({ separator: true });
      for (const c of SKILL_CONVENTIONS) {
        items.push({
          label: `${t("Global")} · ~/${c.dir}`,
          icon: Globe,
          onClick: () => void install(skill, c.id, globalRoot),
        });
      }
    }
    if (items.length === 0) {
      toast(t("Open a project folder first to install skills into it"), "error");
      return;
    }
    openContextMenu(e, items);
  };

  const searchMode = filter.trim().length > 0;
  const shown = searchMode ? (results ?? []) : (catalog ?? []);
  const busy = searchMode ? searching : loading;
  const err = searchMode ? searchErr : error;
  const isInstalled = (s: MarketSkill) =>
    installed.has(s.skill_id.toLowerCase()) || installed.has(s.name.toLowerCase());

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="skills-market">
      <div className="flex items-center gap-1.5 p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          {searching ? (
            <Loader2
              size={13}
              className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-accent"
            />
          ) : (
            filter && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-strong"
                title={t("Clear search")}
                onClick={() => setFilter("")}
              >
                <X size={13} />
              </button>
            )
          )}
          <input
            className="w-full rounded border border-edge bg-raised pl-7 pr-7 py-1 text-strong outline-none focus:border-accent"
            placeholder={t("Search all of skills.sh…")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="market-search"
          />
        </div>
        <button
          className="rounded p-1 text-muted hover:bg-raised hover:text-strong"
          title={t("Reload catalog (bypasses the cache)")}
          onClick={() => void load(true)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="flex items-center gap-1 rounded border border-edge px-2 py-1 text-xs text-muted hover:text-strong"
          title={t("Open skills.sh — browse and publish your own skills")}
          onClick={() => void ipc.openUrl("https://skills.sh/")}
        >
          <ExternalLink size={12} /> skills.sh
        </button>
      </div>
      {/* Context line: what the list currently represents. */}
      {!busy && !err && (
        <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] text-muted">
          {searchMode ? (
            <>
              <span>
                {shown.length} {t("result(s) for")} “{filter.trim()}”{" "}
                {offlineSearch ? t("in your local cache") : t("on skills.sh")}
              </span>
              {offlineSearch && (
                <span
                  className="rounded-full border border-edge bg-raised px-1.5 py-px text-[10px] text-warning"
                  title={t("skills.sh is unreachable — showing cached results")}
                >
                  {t("offline")}
                </span>
              )}
            </>
          ) : (
            <span>
              {t("Top skills on skills.sh")} · {t("type to search the full catalog")}
            </span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {busy && (
          <div className="flex items-center justify-center gap-2 p-4 text-muted">
            <Loader2 size={14} className="animate-spin" />
            {searchMode ? t("Searching skills.sh…") : t("Loading the skills.sh catalog…")}
          </div>
        )}
        {err && !busy && (
          <div className="p-4 text-center text-muted">
            <div className="text-strong">{t("Couldn’t reach skills.sh")}</div>
            <div className="mt-1 text-[11px] text-muted">{err}</div>
            <div className="mt-1 text-[11px] text-muted">
              {t("Check your connection — installed and cached skills are still searchable.")}
            </div>
            <button
              className="mt-3 rounded border border-edge px-2 py-1 text-xs text-accent hover:bg-raised"
              onClick={() => (searchMode ? setSearchNonce((n) => n + 1) : void load(true))}
            >
              {t("Try again")}
            </button>
          </div>
        )}
        {!busy &&
          !err &&
          shown.map((s) => {
            const installable = isInstallable(s.source);
            return (
              <div
                key={`${s.source}/${s.skill_id}`}
                data-testid="market-skill"
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-strong">{s.name}</span>
                    {s.is_official && (
                      <span title={t("Official")}>
                        <BadgeCheck size={13} className="shrink-0 text-accent" />
                      </span>
                    )}
                    {isInstalled(s) && (
                      <span
                        className="flex shrink-0 items-center gap-0.5 rounded bg-raised px-1 text-[10px] text-success"
                        title={t("Already installed in this project or globally")}
                      >
                        <CircleCheck size={10} /> installed
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {s.source} · {formatNumber(s.installs)} installs
                  </div>
                </div>
                <button
                  className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  title={t("Open on skills.sh")}
                  onClick={() => void ipc.openUrl(s.url)}
                >
                  <ExternalLink size={13} />
                </button>
                {installable ? (
                  <div className="flex items-stretch">
                    <button
                      className="flex items-center gap-1 rounded-l border border-edge px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                      title={installTitle(root)}
                      onClick={() => quickInstall(s)}
                    >
                      <Download size={12} /> Install
                    </button>
                    <button
                      className="flex items-center rounded-r border border-l-0 border-edge px-1 text-muted hover:border-accent hover:text-accent"
                      title={t("Choose where to install")}
                      onClick={(e) => installMenu(e, s)}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                    title={t("This source isn’t a GitHub repo — open it on skills.sh")}
                    onClick={() => void ipc.openUrl(s.url)}
                  >
                    <ExternalLink size={12} /> Open
                  </button>
                )}
              </div>
            );
          })}
        {!busy && !err && searchMode && shown.length === 0 && (
          <div className="p-4 text-center text-muted">
            {t("No skills on skills.sh match")} “{filter.trim()}”.
          </div>
        )}
        {!busy && !err && !searchMode && catalog && shown.length === 0 && (
          <div className="p-4 text-center text-muted">{t("The catalog is empty right now.")}</div>
        )}
      </div>
    </div>
  );
}
