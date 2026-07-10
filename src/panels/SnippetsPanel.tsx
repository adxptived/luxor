/** Personal library: code snippets, per-project scratch notes and bookmarks. */

import { Bookmark as BookmarkIcon, Copy, NotebookPen, Plus, Scissors, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";

import * as ipc from "@/lib/ipc";
import { t as tr } from "@/lib/i18n";
import type { Bookmark, Snippet } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive } from "@/state/uiStore";
import { useActiveProject } from "@/state/projectsStore";

type Tab = "snippets" | "notes" | "bookmarks";

const TAB_META: Record<Tab, { icon: ComponentType<{ size?: number; className?: string }>; hint: string }> = {
  snippets: { icon: Scissors, hint: "Reusable code blocks" },
  notes: { icon: NotebookPen, hint: "Auto-saved scratchpad" },
  bookmarks: { icon: BookmarkIcon, hint: "Editor jump points" },
};

export function SnippetsPanel() {
  const [tab, setTab] = useState<Tab>("snippets");
  return (
    <div className="flex h-full flex-col bg-surface text-sm">
      <div className="border-b border-edge bg-bar/60 p-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-edge bg-surface/60 p-1">
          {(["snippets", "notes", "bookmarks"] as Tab[]).map((t) => {
            const Icon = TAB_META[t].icon;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors sm:justify-start ${
                  tab === t ? "bg-raised text-strong shadow-sm" : "text-muted hover:bg-raised/60 hover:text-strong"
                }`}
                title={TAB_META[t].hint}
              >
                <Icon size={13} className="shrink-0" />
                <span className="truncate capitalize">{tr(`snippets.tab.${t}`, t)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "snippets" && <SnippetsTab />}
        {tab === "notes" && <NotesTab />}
        {tab === "bookmarks" && <BookmarksTab />}
      </div>
    </div>
  );
}

function SnippetsTab() {
  const toast = useAppStore((s) => s.toast);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [query, setQuery] = useState("");

  const load = () => void ipc.snippetList().then(setSnippets).catch((e) => toast(errorMessage(e), "error"));
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const blank: Snippet = { id: "", title: "", body: "", lang: "", tags: "", created_at: "", updated_at: "" };
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return snippets;
    return snippets.filter((s) => `${s.title} ${s.lang} ${s.tags} ${s.body}`.toLowerCase().includes(q));
  }, [snippets, query]);

  const save = async () => {
    if (!editing || !editing.title.trim()) return;
    try {
      await ipc.snippetSave(editing);
      setEditing(null);
      load();
      toast(tr("Snippet saved"), "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="rounded-lg border border-edge bg-bar/50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-strong">
            <Scissors size={15} className="text-accent" /> {editing.id ? tr("Edit snippet") : tr("New snippet")}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder={tr("Title")}
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-strong outline-none focus:border-accent"
            />
            <input
              value={editing.lang}
              onChange={(e) => setEditing({ ...editing, lang: e.target.value })}
              placeholder={tr("Language")}
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-strong outline-none focus:border-accent"
            />
          </div>
          <input
            value={editing.tags}
            onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
            placeholder={tr("Tags (comma separated)")}
            className="mt-2 w-full rounded-lg border border-edge bg-raised px-3 py-2 text-strong outline-none focus:border-accent"
          />
        </div>
        <textarea
          value={editing.body}
          onChange={(e) => setEditing({ ...editing, body: e.target.value })}
          placeholder={tr("Snippet body…")}
          className="min-h-0 flex-1 resize-none rounded-lg border border-edge bg-raised p-3 font-mono text-xs text-strong outline-none focus:border-accent"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => setEditing(null)} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong">
            {tr("common.cancel", "Cancel")}
          </button>
          <button onClick={() => void save()} disabled={!editing.title.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40">
            {tr("Save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setEditing(blank)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
        >
          <Plus size={13} /> {tr("New snippet")}
        </button>
        <span className="relative min-w-40 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Search snippets…")}
            className="w-full rounded-lg border border-edge bg-raised py-1.5 pl-7 pr-2 text-xs text-strong outline-none focus:border-accent"
          />
        </span>
        <span className="rounded-full border border-edge px-2 py-1 text-[10px] text-muted">{filtered.length}/{snippets.length}</span>
      </div>
      {snippets.length === 0 && <EmptyHint icon={<Scissors size={24} />} title={tr("No snippets yet")} text={tr("Save reusable commands, code blocks, prompts or config fragments here.")} />}
      {snippets.length > 0 && filtered.length === 0 && <EmptyHint icon={<Search size={24} />} title={tr("No matching snippets")} text={tr("Try another query or clear search to see the full library.")} />}
      <div className="grid gap-2">
        {filtered.map((s) => (
          <div key={s.id} className="group rounded-lg border border-edge bg-bar/35 p-3 transition-colors hover:border-accent/50 hover:bg-raised/40">
            <div className="flex min-w-0 items-center gap-2">
              <button className="min-w-0 flex-1 truncate text-left font-medium text-strong" onClick={() => setEditing(s)}>
                {s.title}
              </button>
              {s.lang && <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-muted">{s.lang}</span>}
              <button
                title={tr("Copy to clipboard")}
                className="rounded p-1 text-muted hover:bg-raised hover:text-strong sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                onClick={() => {
                  void navigator.clipboard.writeText(s.body);
                  useAppStore.getState().toast(tr("Copied"), "success");
                }}
              >
                <Copy size={13} />
              </button>
              <button
                title={tr("Delete snippet")}
                aria-label={tr("Delete snippet")}
                className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                onClick={() =>
                  void confirmDestructive({
                    title: tr("Delete snippet"),
                    message: `${tr("Delete snippet")} “${s.title}”?`,
                    confirmLabel: tr("Delete"),
                  }).then((ok) => {
                    if (ok) void ipc.snippetDelete(s.id).then(load);
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            {s.tags && <div className="mt-1 text-xs text-muted">{s.tags}</div>}
            <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap rounded-lg border border-edge bg-surface/60 p-2 font-mono text-xs text-muted">{s.body}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotesTab() {
  const project = useActiveProject();
  const projectId = project?.id ?? "";
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    setLoaded(false);
    void ipc.noteGet(projectId).then((text) => {
      setBody(text);
      setLoaded(true);
    });
  }, [projectId]);

  const onChange = (text: string) => {
    setBody(text);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void ipc.noteSet(projectId, text).catch(() => {}), 600);
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="rounded-lg border border-edge bg-bar/45 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-strong">
          <NotebookPen size={15} className="text-accent" />
          {project ? `${tr("Scratch note for")} ${project.name}` : tr("Global scratch note")}
        </div>
        <div className="mt-1 text-xs text-muted">{tr("Auto-saves after you stop typing. Good for TODOs, commands and review notes.")}</div>
      </div>
      <textarea
        value={body}
        disabled={!loaded}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tr("Jot down anything — TODOs, command snippets, review notes…")}
        className="min-h-0 flex-1 resize-none rounded-lg border border-edge bg-raised p-3 text-strong outline-none focus:border-accent disabled:opacity-50"
      />
    </div>
  );
}

function BookmarksTab() {
  const project = useActiveProject();
  const openFile = useDockStore((s) => s.openFile);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const load = () => void ipc.bookmarkList(project?.id).then(setBookmarks).catch(() => {});
  useEffect(load, [project?.id]);  

  return (
    <div className="p-3">
      {bookmarks.length === 0 && (
        <EmptyHint icon={<BookmarkIcon size={24} />} title={tr("No bookmarks yet")} text={tr("Use “Toggle bookmark” in the editor to save important lines here.")} />
      )}
      <div className="grid gap-2">
        {bookmarks.map((b) => (
          <div key={b.id} className="group flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-bar/35 px-3 py-2 hover:border-accent/50">
            <BookmarkIcon size={14} className="shrink-0 text-accent" />
            <button
              className="min-w-0 flex-1 truncate text-left text-strong hover:text-accent"
              onClick={() => openFile(b.file)}
              title={b.file}
            >
              {b.file.split(/[\\/]/).pop()}
              <span className="text-muted">:{b.line}</span>
            </button>
            {b.note && <span className="hidden max-w-[40%] truncate text-xs text-muted sm:inline">{b.note}</span>}
            <button
              title={tr("Delete bookmark")}
              aria-label={tr("Delete bookmark")}
              className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              onClick={() =>
                void confirmDestructive({
                  title: tr("Delete bookmark"),
                  message: `${tr("Delete bookmark for")} ${b.file.split(/[\\/]/).pop()}?`,
                  confirmLabel: tr("Delete"),
                }).then((ok) => {
                  if (ok) void ipc.bookmarkDelete(b.id).then(load);
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyHint({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-10 text-center text-muted">
      <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">{icon}</div>
      <div className="font-medium text-strong">{title}</div>
      <div className="mx-auto mt-1 max-w-xs text-xs leading-5">{text}</div>
    </div>
  );
}
