/** Agent skills: a manager for the skill folders inside the project
 *  (.agents / .claude / .codex / .cursor / .opencode / .github) and the
 *  user-level ones under the home directory. */

import {
  ClipboardCopy,
  Copy,
  Globe,
  FileText,
  FolderInput,
  GraduationCap,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { SkillEntry } from "@/lib/types";
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
  const [tab, setTab] = useState<"project" | "global">("project");
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
          <span className="rounded-md border border-edge bg-raised px-2 py-1 text-2xs text-muted">Project · Global</span>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-edge bg-bar/30 px-2 py-2 lx-no-scrollbar">
        <TabButton active={tab === "project"} onClick={() => setTab("project")} icon={FolderInput}>
          Project skills
        </TabButton>
        <TabButton active={tab === "global"} onClick={() => setTab("global")} icon={Globe}>
          Global skills
        </TabButton>
      </div>
      {tab === "project" && <ManagerTab root={root} scope="project" />}
      {tab === "global" && <ManagerTab root={globalRoot} scope="global" />}
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

  const entryMenu = (e: React.MouseEvent, entry: SkillEntry) => {
    const items: MenuItem[] = [
      { label: t("Open SKILL.md"), icon: Pencil, onClick: () => openFile(entry.skill_md) },
      {
        label: entry.enabled ? t("Disable (agents skip it)") : t("Enable"),
        icon: Power,
        onClick: () => void setEnabled(entry, !entry.enabled),
      },
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
          <div className="mt-1">Create one with “New skill…”.</div>
        </div>
      )}
      {grouped
        .filter((g) => g.skills.length > 0)
        .map((g) => (
          <div key={g.id} className="mb-3 overflow-hidden rounded-lg border border-edge bg-bar/25">
            <div className="border-b border-edge bg-raised/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {g.dir} <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-3xs font-normal">{g.skills.length}</span>
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
                  <span className="rounded bg-raised px-1 text-3xs text-warning">off</span>
                )}
                {(hashCount.get(s.content_hash) ?? 0) > 1 && (
                  <span
                    className="rounded bg-raised px-1 text-3xs text-warning"
                    title={t("Identical copy exists in another convention folder")}
                  >
                    identical copy
                  </span>
                )}
                {(nameCount.get(s.name.toLowerCase()) ?? 0) > 1 &&
                  (hashCount.get(s.content_hash) ?? 0) <= 1 && (
                    <span
                      className="rounded bg-raised px-1 text-3xs text-info"
                      title="A skill with the same name exists elsewhere (different content)"
                    >
                      duplicate name
                    </span>
                  )}
                {!s.is_dir && <span className="text-3xs text-muted">bare .md</span>}
                <span className="text-3xs text-muted">{(s.size / 1024).toFixed(1)} KB</span>
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

