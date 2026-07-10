import { t as tr } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VList } from "virtua";

import * as ipc from "@/lib/ipc";
import type {
  BranchInfo,
  ChangedFile,
  CommitInfo,
  CommitStats,
  FileBlame,
  FileState,
  RepoStatus,
  StashEntry,
  StatusEntry,
} from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { NoFolderCta } from "@/components/NoFolderCta";
import { ErrorState } from "@/components/ErrorState";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";
import { GitBranch, RefreshCw } from "lucide-react";
import { useActiveProject } from "@/state/projectsStore";
import { ConflictsView, ReflogView, SubmodulesView, TagsView } from "./GitExtras";
import { computeBranchGraph, edgePath } from "@/lib/branchGraph";

/**
 * Fire-and-forget git telemetry. GitPanel is an eager (frequently-first) panel,
 * so a static `import` of analytics.ts would drag its ~700-line telemetry driver
 * into the entry chunk. Telemetry is non-blocking best-effort, so we import the
 * module lazily on the first git action instead — keeping it off startup.
 */
function emitGitTelemetry(event: {
  project_path?: string | null;
  event_type: "commit" | "branch_switch" | "merge";
  lines_added?: number;
  lines_removed?: number;
  branch?: string | null;
}): void {
  void import("@/lib/analytics")
    .then((m) => m.telemetryGitEvent(event))
    .catch(() => {});
}

type Tab = "changes" | "history" | "branches" | "graph" | "stash" | "blame" | "tags" | "reflog" | "submodules" | "conflicts";

const STATE_BADGE: Record<FileState, { label: string; cls: string }> = {
  new: { label: "A", cls: "text-success" },
  untracked: { label: "U", cls: "text-success" },
  modified: { label: "M", cls: "text-warning" },
  deleted: { label: "D", cls: "text-danger" },
  renamed: { label: "R", cls: "text-info" },
  typechange: { label: "T", cls: "text-info" },
  conflicted: { label: "!", cls: "text-danger" },
  ignored: { label: "·", cls: "text-muted" },
};

export function GitPanel() {
  const project = useActiveProject();
  const [repoRoot, setRepoRoot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!project || project.path === "") {
      setRepoRoot(null);
      return;
    }
    void ipc
      .gitDiscoverRoot(project.path)
      .then((root) => !cancelled && setRepoRoot(root ?? project.path))
      .catch(() => !cancelled && setRepoRoot(project.path));
    return () => {
      cancelled = true;
    };
  }, [project]);
  const toast = useAppStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>("changes");
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [log, setLog] = useState<CommitInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repo = repoRoot;

  const refresh = useCallback(async () => {
    if (!repo) return;
    try {
      setStatus(await ipc.gitStatus(repo));
      setError(null);
      const [logRes, branchRes, stashRes] = await Promise.allSettled([
        ipc.gitLog(repo, 200),
        ipc.gitBranches(repo),
        ipc.gitStashList(repo),
      ]);
      if (logRes.status === "fulfilled") setLog(logRes.value);
      if (branchRes.status === "fulfilled") setBranches(branchRes.value);
      if (stashRes.status === "fulfilled") setStashes(stashRes.value);
    } catch (e) {
      setStatus(null);
      setError(errorMessage(e));
    }
  }, [repo]);

  const autoRefreshSecs = useAppStore((s) => s.config?.git.auto_refresh_secs ?? 5);
  const confirmDestructive = useAppStore((s) => s.config?.confirm_destructive ?? true);

  useEffect(() => {
    if (!repo) return;
    const first = setTimeout(() => {
      if (!document.hidden) void refresh();
    }, 250);
    if (autoRefreshSecs <= 0) {
      return () => clearTimeout(first);
    }
    // git status + log + branches + stash is heavy — don't auto-refresh while
    // the window is hidden (tray / minimized).
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, autoRefreshSecs * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [repo, refresh, autoRefreshSecs]);

  const confirmThen = (question: string, action: () => void) => {
    if (!confirmDestructive) {
      action();
      return;
    }
    void useUiStore
      .getState()
      .confirm({ title: question, danger: true })
      .then((ok) => ok && action());
  };

  const run = async (label: string, fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(label);
    try {
      await fn();
      if (successMsg) toast(successMsg);
      await refresh();
    } catch (e) {
      toast(`${label} — ${tr("failed:")} ${errorMessage(e)}`, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!project || project.path === "") {
    return <NoFolderCta hint={tr("Attach a folder to use the Git explorer.")} />;
  }
  if (!repo) {
    return <Empty text={tr("Looking for a git repository…")} />;
  }
  if (error) {
    return <Empty text={`${tr("Not a git repository")} (${error})`} />;
  }
  if (!status) {
    return <Empty text={tr("Loading repository…")} />;
  }

  const staged = status.entries.filter((e) => e.staged);
  const unstaged = status.entries.filter((e) => e.unstaged);

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface text-sm">
      {/* Header: branch + sync actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-accent">
          <GitBranch size={14} />
          {status.head_detached ? "detached HEAD" : (status.branch ?? tr("no branch"))}
        </span>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="text-muted">
            {status.ahead > 0 && `↑${status.ahead} `}
            {status.behind > 0 && `↓${status.behind}`}
          </span>
        )}
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          <Btn label={<RefreshCw size={13} />} busy={busy} onClick={() => void refresh()} />
          <Btn label={tr("Fetch")} busy={busy} onClick={() => run(tr("Fetch"), () => ipc.gitFetch(repo!), tr("Fetched"))} />
          <Btn
            label={tr("Pull")}
            busy={busy}
            onClick={() => run(tr("Pull"), () => ipc.gitPull(repo!), tr("Pulled"))}
          />
          <Btn label={tr("Push")} busy={busy} onClick={() => run(tr("Push"), () => ipc.gitPush(repo!), tr("Pushed"))} />
        </div>
      </div>

      {/* Tabs */}
      <div className="lx-no-scrollbar flex gap-1 overflow-x-auto border-b border-edge px-2 pt-1">
        {(["changes", "history", "branches", "graph", "stash", "blame", "tags", "reflog", "submodules", "conflicts"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-t px-3 py-1 capitalize ${
              tab === t ? "bg-raised text-strong" : "text-muted hover:text-strong"
            }`}
          >
            {tr(`git.tab.${t}`, t)}
            {t === "changes" && status.entries.length > 0 && (
              <span className="ml-1 text-xs text-accent">{status.entries.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "changes" && (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <FileSection
                title={`${tr("Staged")} (${staged.length})`}
                entries={staged}
                kind="staged"
                repo={repo!}
                busy={busy}
                run={run}
                confirmThen={confirmThen}
              />
              <FileSection
                title={`${tr("Changes")} (${unstaged.length})`}
                entries={unstaged}
                kind="unstaged"
                repo={repo!}
                busy={busy}
                run={run}
                confirmThen={confirmThen}
              />
              {status.entries.length === 0 && <Empty text={tr("Working tree clean ✓")} />}
            </div>
            {/* Commit box */}
            <div className="border-t border-edge p-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={tr("Commit message")}
                rows={2}
                className="w-full resize-none rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-accent"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Btn
                  label={amend ? tr("Amend") : `${tr("Commit")}${staged.length ? ` (${staged.length})` : ""}`}
                  primary
                  busy={busy}
                  disabled={!message.trim() || (staged.length === 0 && !amend)}
                  onClick={() =>
                    run(amend ? tr("Amend") : tr("Commit"), async () => {
                      await ipc.gitCommit(repo!, message.trim(), amend);
                      // Capture commit churn (insertions/deletions) + branch so
                      // the dashboard's "lines changed" and Commit Impact Score
                      // (plan 1.2 / 3.1) are populated, not left at zero.
                      let linesAdded = 0;
                      let linesRemoved = 0;
                      try {
                        const head = (await ipc.gitLog(repo!, 1))[0];
                        if (head) {
                          const stats = await ipc.gitCommitStats(repo!, head.id);
                          linesAdded = stats.insertions;
                          linesRemoved = stats.deletions;
                        }
                      } catch {
                        /* commit stats optional — never block the commit UX */
                      }
                      emitGitTelemetry({
                        project_path: repo ?? null,
                        event_type: "commit",
                        lines_added: linesAdded,
                        lines_removed: linesRemoved,
                        branch: status.branch ?? null,
                      });
                      setMessage("");
                      setAmend(false);
                    }, amend ? tr("Amended") : tr("Committed"))
                  }
                />
                <label className="flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-strong">
                  <input
                    type="checkbox"
                    checked={amend}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setAmend(on);
                      if (on && !message.trim()) {
                        void ipc.gitLastCommitMessage(repo!).then(
                          (m) => m && setMessage(m.trim()),
                          () => {},
                        );
                      }
                    }}
                  />
                  amend
                </label>
                <Btn
                  label={tr("Stage all")}
                  busy={busy}
                  disabled={unstaged.length === 0}
                  onClick={() => run(tr("Stage all"), () => ipc.gitStage(repo!, []))}
                />
                <Btn
                  label={tr("Stash")}
                  busy={busy}
                  disabled={status.entries.length === 0}
                  onClick={() => run(tr("Stash"), () => ipc.gitStashSave(repo!, message || undefined), tr("Stashed"))}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "history" && <HistoryList log={log} repo={repo!} />}

        {tab === "graph" && (
          <BranchGraphView log={log} />
        )}

        {tab === "branches" && (
          <BranchList branches={branches} repo={repo!} busy={busy} run={run} confirmThen={confirmThen} />
        )}

        {tab === "stash" && (
          <div className="p-2">
            {stashes.length === 0 && <Empty text={tr("No stashes.")} />}
            {stashes.map((s) => (
              <div key={s.index} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-raised">
                <span className="text-muted">#{s.index}</span>
                <span className="flex-1 truncate" title={s.message}>{s.message}</span>
                <div className="flex shrink-0 gap-1 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <Btn
                    label={tr("Pop")}
                    busy={busy}
                    onClick={() => run(tr("Stash pop"), () => ipc.gitStashPop(repo!, s.index), tr("Stash applied"))}
                  />
                  <Btn
                    label={tr("Apply")}
                    busy={busy}
                    onClick={() => run(tr("Stash apply"), () => ipc.gitStashApply(repo!, s.index), tr("Stash applied"))}
                  />
                  <Btn
                    label={tr("Drop")}
                    danger
                    busy={busy}
                    onClick={() => confirmThen(`${tr("Drop stash")} #${s.index}?`, () => {
                      void run(tr("Drop stash"), () => ipc.gitStashDrop(repo!, s.index), tr("Stash dropped"));
                    })}
                  />
                </div>
              </div>
            ))}
            {stashes.length > 0 && (
              <div className="mt-2 border-t border-edge pt-2">
                <Btn
                  label={tr("Stash all")}
                  busy={busy}
                  onClick={() => run(tr("Stash"), () => ipc.gitStashSave(repo!, message || undefined), tr("Stashed"))}
                />
              </div>
            )}
          </div>
        )}

        {tab === "blame" && <BlameView repo={repo!} />}

        {tab === "tags" && <TagsView repo={repo!} busy={busy} run={run} />}
        {tab === "reflog" && <ReflogView repo={repo!} run={run} />}
        {tab === "submodules" && <SubmodulesView repo={repo!} run={run} />}
        {tab === "conflicts" && <ConflictsView repo={repo!} />}
      </div>
    </div>
  );
}

/** Per-line authorship for one file (`git blame` against HEAD). */
function BlameView({ repo }: { repo: string }) {
  const [file, setFile] = useState("");
  const [blame, setBlame] = useState<FileBlame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const path = file.trim();
    if (!path || busy) return;
    setBusy(true);
    setError(null);
    try {
      setBlame(await ipc.gitBlame(repo, path));
    } catch (e) {
      setBlame(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // line number -> hunk lookup
  const hunkFor = (lineNo: number) =>
    blame?.hunks.find((h) => lineNo >= h.start_line && lineNo < h.start_line + h.lines) ?? null;

  return (
    <div className="flex h-full flex-col" data-testid="blame-view">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-2">
        <input
          value={file}
          onChange={(e) => setFile(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          placeholder={tr("File path relative to the repo, e.g. src/main.rs")}
          className="flex-1 rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-accent"
          data-testid="blame-file-input"
        />
        <button
          onClick={() => void load()}
          disabled={busy || !file.trim()}
          className="rounded border border-edge px-3 py-1 text-xs text-muted hover:text-strong disabled:opacity-50"
        >
          {busy ? tr("Blaming���") : tr("Blame")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {error && (
          <ErrorState
            compact
            title={tr("Blame failed")}
            message={error}
            retrying={busy}
            onRetry={file.trim() ? () => void load() : undefined}
          />
        )}
        {!blame && !error && (
          <Empty text={tr("Enter a tracked file path to see who last changed each line (against HEAD).")} />
        )}
        {blame?.truncated && (
          <div className="border-b border-warning-soft-strong bg-warning-soft px-3 py-1 text-warning">
            File is large — blame is limited to the first {blame.lines.length} lines.
          </div>
        )}
        {blame?.lines.map((text, i) => {
          const h = hunkFor(i + 1);
          const first = h?.start_line === i + 1;
          return (
            <div
              key={i}
              data-testid="blame-line"
              className="flex gap-0 whitespace-pre hover:bg-raised"
              title={h ? `${h.short_id} — ${h.author}\n${new Date(h.time * 1000).toLocaleString()}\n${h.summary}` : undefined}
            >
              <span className={`w-44 shrink-0 truncate border-r border-edge px-2 ${first ? "text-accent" : "text-transparent"}`}>
                {h ? `${h.short_id} ${h.author}` : ""}
              </span>
              <span className="w-10 shrink-0 select-none px-1 text-right text-muted">{i + 1}</span>
              <span className="px-2 text-strong">{text || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileSection(props: {
  title: string;
  entries: StatusEntry[];
  kind: "staged" | "unstaged";
  repo: string;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  confirmThen: (question: string, action: () => void) => void;
}) {
  const openDiff = useDockStore((s) => s.openDiff);
  if (props.entries.length === 0) return null;
  return (
    <div className="px-2 py-1">
      <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {props.title}
      </div>
      {props.entries.map((e) => {
        const state = (props.kind === "staged" ? e.staged : e.unstaged) as FileState;
        const badge = STATE_BADGE[state];
        const slash = e.path.lastIndexOf("/");
        const fileName = slash >= 0 ? e.path.slice(slash + 1) : e.path;
        const fileDir = slash >= 0 ? e.path.slice(0, slash) : "";
        return (
          <div key={e.path} className="group flex min-w-0 flex-wrap items-center gap-2 rounded px-1 py-0.5 hover:bg-raised">
            <span className={`w-4 text-center font-mono font-bold ${badge.cls}`}>{badge.label}</span>
            <button
              className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-left"
              title={`${e.path} — ${tr("Show diff")}`}
              onClick={() =>
                openDiff({
                  repoPath: props.repo,
                  filePath: e.path,
                  target: props.kind === "staged" ? "index" : "worktree",
                })
              }
            >
              <span className="shrink-0 truncate text-strong group-hover:text-accent">{fileName}</span>
              {fileDir && <span className="min-w-0 truncate text-[11px] text-muted">{fileDir}</span>}
            </button>
                <div className="flex shrink-0 flex-wrap gap-1 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              {props.kind === "unstaged" ? (
                <>
                  <Btn
                    label={tr("Stage")}
                    busy={props.busy}
                    onClick={() => props.run(tr("Stage"), () => ipc.gitStage(props.repo, [e.path]))}
                  />
                  {state !== "untracked" && (
                    <Btn
                      label={tr("Discard")}
                      danger
                      busy={props.busy}
                      onClick={() =>
                        props.confirmThen(`${tr("Discard changes in")} ${e.path}? ${tr("This cannot be undone.")}`, () => {
                          void props.run(tr("Discard"), () => ipc.gitDiscard(props.repo, [e.path]));
                        })
                      }
                    />
                  )}
                </>
              ) : (
                <Btn
                  label={tr("Unstage")}
                  busy={props.busy}
                  onClick={() => props.run(tr("Unstage"), () => ipc.gitUnstage(props.repo, [e.path]))}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "5m ago" / "3d ago" style timestamps for the commit list. */
function relativeTime(unixSecs: number): string {
  const diff = Math.max(0, Date.now() / 1000 - unixSecs);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSecs * 1000).toLocaleDateString();
}

/** Phase 20: Branch graph visualization — renders a lane-based commit DAG. */
function BranchGraphView({ log }: { log: CommitInfo[] }) {
  const graph = useMemo(() => {
    return computeBranchGraph(
      log.map((c) => ({
        id: c.id,
        shortHash: c.id.slice(0, 8),
        message: c.message,
        author: c.author,
        date: new Date(c.time * 1000).toISOString(),
        parents: c.parents,
      })),
    );
  }, [log]);

  if (graph.commits.length === 0) {
    return <Empty text="No commits to graph" />;
  }

  const rowHeight = 28;
  const laneWidth = 24;
  const svgWidth = graph.laneCount * laneWidth + 8;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Graph SVG is absolutely positioned behind the rows so each commit
          node lines up exactly with its commit row (same rowHeight grid). */}
      <div className="relative" style={{ minWidth: svgWidth + 300 }}>
        <svg
          width={svgWidth}
          height={graph.commits.length * rowHeight}
          className="pointer-events-none absolute left-0 top-0"
          aria-hidden="true"
        >
          {/* Edges */}
          {graph.edges.map((edge, i) => (
            <path
              key={i}
              d={edgePath(edge, rowHeight, laneWidth)}
              fill="none"
              stroke={edge.isMerge ? "var(--lx-info)" : "var(--lx-muted, #71717a)"}
              strokeWidth={1.5}
              opacity={0.6}
            />
          ))}
          {/* Commit nodes */}
          {graph.commits.map((c, i) => {
            const cx = c.lane * laneWidth + laneWidth / 2;
            const cy = i * rowHeight + rowHeight / 2;
            return (
              <g key={c.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={c.isMerge ? 5 : 4}
                  fill={c.isMerge ? "var(--lx-info)" : "var(--lx-accent, #e8b059)"}
                  stroke="var(--lx-surface, #101014)"
                  strokeWidth={1.5}
                />
                {c.heads.length > 0 && (
                  <circle cx={cx} cy={cy} r={7} fill="none" stroke="var(--lx-accent, #e8b059)" strokeWidth={1} opacity={0.4} />
                )}
              </g>
            );
          })}
        </svg>
        {graph.commits.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2 py-1 pr-2 text-xs hover:bg-raised"
            style={{ height: rowHeight, paddingLeft: svgWidth + 8 }}
          >
            <span className="shrink-0 font-mono text-muted">{c.shortHash}</span>
            {c.heads.map((h) => (
              <span key={h} className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1 py-px font-mono text-[10px] text-accent">
                {h}
              </span>
            ))}
            <span className="min-w-0 flex-1 truncate text-strong" title={c.message}>{c.message}</span>
            <span className="shrink-0 text-muted">{c.author}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryList({ log, repo }: { log: CommitInfo[]; repo: string }) {
  const openDiff = useDockStore((s) => s.openDiff);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, ChangedFile[]>>({});
  const [stats, setStats] = useState<Record<string, CommitStats>>({});

  const toggle = async (commit: CommitInfo) => {
    if (expanded === commit.id) {
      setExpanded(null);
      return;
    }
    setExpanded(commit.id);
    if (!files[commit.id]) {
      try {
        const changed = await ipc.gitCommitFiles(repo, commit.id);
        setFiles((f) => ({ ...f, [commit.id]: changed }));
      } catch {
        setFiles((f) => ({ ...f, [commit.id]: [] }));
      }
    }
    if (!stats[commit.id]) {
      // Aggregate ± stats load lazily so the history list stays instant.
      void ipc.gitCommitStats(repo, commit.id).then(
        (st) => setStats((m) => ({ ...m, [commit.id]: st })),
        () => undefined,
      );
    }
  };

  if (log.length === 0) return <Empty text={tr("No commits yet.")} />;
  return (
    // Virtualized: histories can be thousands of commits (audit 3.1).
    <VList style={{ height: "100%" }} className="lx-virtual-scroll p-1">
      {log.map((c) => (
        <div key={c.id}>
          <button
            onClick={() => void toggle(c)}
            className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-raised"
            title={`${c.author} <${c.email}>
${new Date(c.time * 1000).toLocaleString()}

${c.message}`}
          >
            <span className="font-mono text-xs text-accent">{c.short_id}</span>
            <span className="flex-1 truncate">{c.summary}</span>
            {stats[c.id] && (
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-success">+{stats[c.id].insertions}</span>{" "}
                <span className="text-danger">−{stats[c.id].deletions}</span>
              </span>
            )}
            <span className="shrink-0 text-xs text-muted">
              {c.author} · {relativeTime(c.time)}
            </span>
          </button>
          {expanded === c.id && (
            <div className="ml-6 border-l border-edge pl-2 text-xs">
              {stats[c.id] && (
                <div className="px-1 py-0.5 text-muted">
                  {stats[c.id].files_changed} file{stats[c.id].files_changed === 1 ? "" : "s"} changed,{" "}
                  <span className="text-success">+{stats[c.id].insertions}</span>{" "}
                  <span className="text-danger">−{stats[c.id].deletions}</span>
                </div>
              )}
              {(files[c.id] ?? []).map((f) => {
                const badge = STATE_BADGE[f.state];
                return (
                  <button
                    key={f.path}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-raised"
                    onClick={() =>
                      openDiff({ repoPath: repo, filePath: f.path, target: "commit", commitId: c.id })
                    }
                  >
                    <span className={`font-mono font-bold ${badge.cls}`}>{badge.label}</span>
                    <span className="truncate">{f.path}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px]">
                      <span className="text-success">+{f.insertions}</span>{" "}
                      <span className="text-danger">−{f.deletions}</span>
                    </span>
                  </button>
                );
              })}
              {files[c.id]?.length === 0 && <div className="px-1 py-0.5 text-muted">no files</div>}
            </div>
          )}
        </div>
      ))}
    </VList>
  );
}

function BranchList(props: {
  branches: BranchInfo[];
  repo: string;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  confirmThen: (question: string, action: () => void) => void;
}) {
  const [newBranch, setNewBranch] = useState("");
  const local = props.branches.filter((b) => !b.is_remote);
  const remote = props.branches.filter((b) => b.is_remote);
  return (
    <div className="p-2">
      <div className="mb-2 flex gap-2">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="new-branch-name"
          className="flex-1 rounded border border-edge bg-raised px-2 py-1 outline-none focus:border-accent"
        />
        <Btn
          label={tr("Create + checkout")}
          primary
          busy={props.busy}
          disabled={!newBranch.trim()}
          onClick={() =>
            props.run(tr("Create branch"), async () => {
              await ipc.gitBranchCreate(props.repo, newBranch.trim(), true);
              setNewBranch("");
            }, tr("Branch created"))
          }
        />
      </div>
      {local.map((b) => (
        <div key={b.name} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-raised">
          <span className={b.is_head ? "font-semibold text-accent" : ""}>
            {b.is_head ? "● " : "○ "}
            {b.name}
          </span>
          {b.upstream && <span className="text-xs text-muted">→ {b.upstream}</span>}
          <div className="ml-auto hidden gap-1 group-hover:flex">
            {!b.is_head && (
              <>
                <Btn
                  label={tr("Checkout")}
                  busy={props.busy}
                  onClick={() =>
                    props.run(
                      "Checkout",
                      async () => {
                        await ipc.gitBranchCheckout(props.repo, b.name);
                        // Record the branch switch so git-flow state / branch
                        // history populate (plan 1.2).
                        emitGitTelemetry({
                          project_path: props.repo,
                          event_type: "branch_switch",
                          branch: b.name,
                        });
                      },
                      `On ${b.name}`,
                    )
                  }
                />
                <Btn
                  label={tr("Delete")}
                  danger
                  busy={props.busy}
                  onClick={() =>
                    props.confirmThen(`${tr("Delete branch")} ${b.name}?`, () => {
                      void props.run(tr("Delete branch"), () => ipc.gitBranchDelete(props.repo, b.name));
                    })
                  }
                />
              </>
            )}
          </div>
        </div>
      ))}
      {remote.length > 0 && (
        <>
          <div className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{tr("Remote")}</div>
          {remote.map((b) => (
            <div key={b.name} className="px-2 py-1 text-muted">
              {b.name}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Btn(props: {
  label: React.ReactNode;
  onClick: () => void;
  busy?: string | null;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={Boolean(props.busy) || props.disabled}
      className={`rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-40 ${
        props.primary
          ? "bg-accent text-on-accent hover:opacity-90"
          : props.danger
            ? "border border-danger-soft-strong text-danger hover:bg-danger-soft"
            : "border border-edge text-strong hover:bg-raised"
      }`}
    >
      {props.label}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-4 text-muted">{text}</div>;
}
