/** Extra Git views: tags, reflog (with cherry-pick), submodules and conflict resolution. */

import { formatUnixDateTime } from "@/lib/format";
import { GitMerge, RefreshCw, Tag, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import * as ipc from "@/lib/ipc";
import type { ConflictSides, ReflogEntry, SubmoduleInfo, TagInfo } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { t as tr } from "@/lib/i18n";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive } from "@/state/uiStore";

type RunFn = (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

export function TagsView({ repo, busy, run }: { repo: string; busy: string | null; run: RunFn }) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => void ipc.gitTags(repo).then(setTags).catch(() => setTags([])), [repo]);
  useEffect(load, [load]);

  const create = () =>
    run(tr("Create tag"), async () => {
      await ipc.gitTagCreate(repo, name.trim(), message.trim() || undefined);
      setName("");
      setMessage("");
      load();
    }, tr("Tag created"));

  return (
    <div className="p-2">
      <div className="mb-2 flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="v1.2.3"
          className="w-28 rounded border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-accent"
        />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={tr("Annotation (optional)")}
          className="flex-1 rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-accent"
        />
        <button
          onClick={() => void create()}
          disabled={!name.trim() || busy !== null}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
        >
          Tag HEAD
        </button>
      </div>
      {tags.length === 0 && <div className="py-6 text-center text-xs text-muted">{tr("No tags.")}</div>}
      {tags.map((t) => (
        <div key={t.name} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-raised">
          <Tag size={13} className="shrink-0 text-accent" />
          <span className="font-mono text-strong">{t.name}</span>
          <span className="font-mono text-xs text-muted">{t.short_target}</span>
          {t.message && <span className="flex-1 truncate text-xs text-muted">{t.message}</span>}
          {!t.message && <span className="flex-1" />}
          <button
            title={tr("Push tag to remote")}
            className="text-muted opacity-0 hover:text-strong group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            onClick={() => void run(tr("Push tag"), () => ipc.gitPushTag(repo, t.name), `${tr("Pushed")} ${t.name}`)}
          >
            <UploadCloud size={13} />
          </button>
          <button
            title={tr("Delete tag")}
            className="text-muted opacity-0 hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            onClick={() =>
              void confirmDestructive({ title: tr("Delete tag"), message: `${tr("Delete tag")} ${t.name}? ${tr("(local only)")}` }).then(
                (ok) => { if (ok) void run(tr("Delete tag"), () => ipc.gitTagDelete(repo, t.name), tr("Tag deleted")).then(load); },
              )
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ReflogView({ repo, run }: { repo: string; run: RunFn }) {
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const load = useCallback(() => void ipc.gitReflog(repo).then(setEntries).catch(() => setEntries([])), [repo]);
  useEffect(load, [load]);

  return (
    <div className="p-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
        {tr("HEAD movements — recover lost commits via cherry-pick")}
        <button onClick={load} aria-label={tr("Refresh")} title={tr("Refresh")} className="ml-auto hover:text-strong"><RefreshCw size={12} /></button>
      </div>
      {entries.length === 0 && <div className="py-6 text-center text-xs text-muted">{tr("Reflog is empty.")}</div>}
      {entries.map((e, i) => (
        <div key={`${e.id}-${i}`} className="group flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-raised">
          <span className="font-mono text-accent">{e.short_id}</span>
          <span className="flex-1 truncate text-strong">{e.message}</span>
          <span className="shrink-0 text-muted">{formatUnixDateTime(e.time)}</span>
          <button
            title={tr("Cherry-pick this commit onto HEAD")}
            className="shrink-0 text-muted opacity-0 hover:text-strong group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            onClick={() =>
              void run(tr("Cherry-pick"), () => ipc.gitCherryPick(repo, e.id), `${tr("Cherry-picked")} ${e.short_id}`)
            }
          >
            <GitMerge size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SubmodulesView({ repo, run }: { repo: string; run: RunFn }) {
  const [subs, setSubs] = useState<SubmoduleInfo[]>([]);
  const load = useCallback(() => void ipc.gitSubmodules(repo).then(setSubs).catch(() => setSubs([])), [repo]);
  useEffect(load, [load]);

  return (
    <div className="p-2">
      {subs.length === 0 && <div className="py-6 text-center text-xs text-muted">{tr("No submodules.")}</div>}
      {subs.map((s) => (
        <div key={s.name} className="mb-1 flex items-center gap-2 rounded border border-edge px-2 py-1">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-strong">{s.path}</div>
            <div className="truncate text-xs text-muted">
              {s.url ?? "no url"} {s.head_id && `· ${s.head_id.slice(0, 7)}`}
            </div>
          </div>
          <button
            className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong"
            onClick={() => void run(tr("Update submodule"), () => ipc.gitSubmoduleUpdate(repo, s.name).then(load), tr("Submodule updated"))}
          >
            Init / update
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConflictsView({ repo }: { repo: string }) {
  const toast = useAppStore((s) => s.toast);
  const [paths, setPaths] = useState<string[]>([]);
  const [active, setActive] = useState<ConflictSides | null>(null);
  const [content, setContent] = useState("");
  const [showSides, setShowSides] = useState(true);
  const load = useCallback(() => void ipc.gitConflictPaths(repo).then(setPaths).catch(() => setPaths([])), [repo]);
  useEffect(load, [load]);

  const open = async (path: string) => {
    try {
      const sides = await ipc.gitConflictSides(repo, path);
      setActive(sides);
      setContent(sides.current);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const resolve = async () => {
    if (!active) return;
    try {
      await ipc.gitConflictResolve(repo, active.path, content);
      toast(`Resolved ${active.path}`, "success");
      setActive(null);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (active) {
    return (
      <div className="flex h-full flex-col p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => setActive(null)} className="rounded border border-edge px-2 py-0.5 text-muted hover:text-strong">← Back</button>
          <span className="min-w-0 flex-1 truncate font-medium text-strong">{active.path}</span>
          <button
            onClick={() => setShowSides((v) => !v)}
            aria-pressed={showSides}
            className="rounded border border-edge px-2 py-0.5 text-muted hover:text-strong"
          >
            {showSides ? tr("Hide 3-way view") : tr("3-way view")}
          </button>
          <button onClick={() => setContent(active.ours)} className="rounded border border-edge px-2 py-0.5 text-muted hover:text-strong">{tr("Take ours")}</button>
          <button onClick={() => setContent(active.theirs)} className="rounded border border-edge px-2 py-0.5 text-muted hover:text-strong">{tr("Take theirs")}</button>
          <button onClick={() => void resolve()} className="rounded bg-accent px-2 py-0.5 font-medium text-on-accent">{tr("Mark resolved")}</button>
        </div>
        {showSides && (
          <div className="mb-1 grid min-h-0 flex-1 grid-cols-1 gap-1 md:grid-cols-3">
            {([
              [tr("Ours (HEAD)"), active.ours],
              [tr("Base"), active.base],
              [tr("Theirs (incoming)"), active.theirs],
            ] as const).map(([label, text]) => (
              <div key={label} className="flex min-h-24 flex-col overflow-hidden rounded border border-edge">
                <div className="border-b border-edge bg-raised px-2 py-0.5 text-3xs uppercase tracking-wide text-muted">{label}</div>
                <pre className="min-h-0 flex-1 overflow-auto bg-surface p-2 font-mono text-xs leading-5 text-strong">{text}</pre>
              </div>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge">
          <div className="border-b border-edge bg-raised px-2 py-0.5 text-3xs uppercase tracking-wide text-muted">{tr("Result (editable)")}</div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            aria-label={tr("Result (editable)")}
            className="min-h-0 flex-1 resize-none bg-raised p-2 font-mono text-xs text-strong outline-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-2">
      {paths.length === 0 && <div className="py-6 text-center text-xs text-muted">{tr("No merge conflicts ✓")}</div>}
      {paths.map((p) => (
        <button key={p} onClick={() => void open(p)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-raised">
          <span className="font-mono font-bold text-danger">!</span>
          <span className="truncate text-strong">{p}</span>
        </button>
      ))}
    </div>
  );
}
