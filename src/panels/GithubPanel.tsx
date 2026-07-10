/** GitHub panel: Issues, Pull Requests and Actions (CI) for the active project's origin repo. */

import {
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import * as ipc from "@/lib/ipc";
import type { GhComment, GhIssue, GhPull, GhRun, RepoRef } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useProjectsStore } from "@/state/projectsStore";

type Tab = "issues" | "pulls" | "ci";
type IssueState = "open" | "closed" | "all";
type Detail =
  | { kind: "issue"; item: GhIssue }
  | { kind: "pull"; item: GhPull }
  | { kind: "run"; item: GhRun };

function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(min, 0)}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function GithubPanel() {
  const toast = useAppStore((s) => s.toast);
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useProjectsStore((s) => s.activeId);
  const project = projects.find((p) => p.id === activeId) ?? null;

  const [repo, setRepo] = useState<RepoRef | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("issues");
  const [state, setState] = useState<IssueState>("open");
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [pulls, setPulls] = useState<GhPull[]>([]);
  const [runs, setRuns] = useState<GhRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [comments, setComments] = useState<GhComment[] | null>(null);
  const [commentText, setCommentText] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [creatingPr, setCreatingPr] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prBase, setPrBase] = useState("main");
  const [prDraft, setPrDraft] = useState(false);
  const [prBusy, setPrBusy] = useState(false);

  const slug = repo ? `${repo.owner}/${repo.repo}` : null;

  useEffect(() => {
    setRepo(undefined);
    setDetail(null);
    if (!project) {
      setRepo(null);
      return;
    }
    ipc
      .githubRepo(project.path)
      .then(setRepo)
      .catch(() => setRepo(null));
  }, [project?.path, project]);

  const refresh = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    try {
      if (tab === "issues") setIssues(await ipc.githubIssues(slug, state));
      else if (tab === "pulls") setPulls(await ipc.githubPulls(slug, state === "all" ? "all" : state));
      else setRuns(await ipc.githubRuns(slug));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }, [slug, tab, state, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadConversation = async (next: Detail) => {
    setDetail(next);
    setCommentText("");
    if (next.kind === "run") {
      setComments(null);
      return;
    }
    setComments(null);
    if (!slug) return;
    try {
      // GitHub PR conversations live on the issues comments endpoint too, so
      // issues and PRs can share the same in-app discussion UI.
      setComments(await ipc.githubIssueComments(slug, next.item.number));
    } catch (e) {
      setComments([]);
      toast(errorMessage(e), "error");
    }
  };

  const sendComment = async () => {
    if (!slug || !detail || detail.kind === "run" || !commentText.trim()) return;
    try {
      await ipc.githubCommentAdd(slug, detail.item.number, commentText.trim());
      setCommentText("");
      setComments(await ipc.githubIssueComments(slug, detail.item.number));
      toast(t("common.send", "Comment posted"), "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const openPrForm = async () => {
    setCreatingPr((v) => !v);
    if (creatingPr || !project) return;
    // Prefill head with the repo's current branch for a one-click flow.
    try {
      const root = await ipc.gitDiscoverRoot(project.path);
      if (!root) return;
      const branches = await ipc.gitBranches(root);
      const head = branches.find((b) => b.is_head)?.name;
      if (head) {
        setPrHead(head);
        if (!prTitle) setPrTitle(head.replace(/[-_/]+/g, " ").trim());
      }
      // Prefer main/master as base when present.
      const base = branches.find((b) => !b.is_remote && (b.name === "main" || b.name === "master"))?.name;
      if (base) setPrBase(base);
    } catch {
      // Prefill is best-effort — the form still works with manual input.
    }
  };

  const createPull = async () => {
    if (!slug || !prTitle.trim() || !prHead.trim() || !prBase.trim() || prBusy) return;
    setPrBusy(true);
    try {
      const pr = await ipc.githubPullCreate(slug, prTitle.trim(), prBody, prHead.trim(), prBase.trim(), prDraft);
      setCreatingPr(false);
      setPrTitle("");
      setPrBody("");
      toast(`PR #${pr.number}: ${pr.title}`, "success");
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPrBusy(false);
    }
  };

  const createIssue = async () => {
    if (!slug || !newTitle.trim()) return;
    try {
      const issue = await ipc.githubIssueCreate(slug, newTitle.trim(), newBody);
      setCreating(false);
      setNewTitle("");
      setNewBody("");
      toast(`#${issue.number}: ${issue.title}`, "success");
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const stateBadge = (s: string, draft = false) => (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        draft
          ? "bg-raised text-muted"
          : s === "open"
            ? "bg-success-soft text-success"
            : "bg-info-soft text-info"
      }`}
    >
      {draft ? t("github.draft", "draft") : s}
    </span>
  );

  const runIcon = (r: GhRun) =>
    r.status !== "completed" ? (
      <Loader2 size={14} className="animate-spin text-warning" />
    ) : r.conclusion === "success" ? (
      <CheckCircle2 size={14} className="text-success" />
    ) : r.conclusion === "failure" ? (
      <XCircle size={14} className="text-danger" />
    ) : (
      <Circle size={14} className="text-muted" />
    );

  if (repo === undefined) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">{t("common.loading", "Loading…")}</div>;
  }
  if (!repo || !slug) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-sm text-muted">
        <span>{project ? t("github.noRepo", "This project's origin remote does not point to GitHub.") : t("github.noProject", "Open a project with a GitHub origin remote.")}</span>
      </div>
    );
  }

  // ---- detail view ---------------------------------------------------------
  if (detail?.kind === "run") {
    const run = detail.item;
    return (
      <div className="flex h-full min-w-0 flex-col bg-surface text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-edge p-2">
          <button onClick={() => setDetail(null)} className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong">
            ←
          </button>
          <span className="font-medium text-strong">#{run.run_number}</span>
          <span className="min-w-0 flex-1 truncate text-strong">{run.name}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
            {runIcon(run)} {run.status}{run.conclusion ? ` / ${run.conclusion}` : ""}
          </span>
          <button
            onClick={() => void ipc.openUrl(run.html_url)}
            className="ml-auto text-muted hover:text-strong"
            title={t("common.openInBrowser", "Open in browser")}
          >
            <ExternalLink size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <span className="rounded bg-edge px-1.5 py-0.5">{run.branch || "—"}</span>
              <span className="rounded bg-edge px-1.5 py-0.5">{run.event || "—"}</span>
              <span className="rounded bg-edge px-1.5 py-0.5">{timeAgo(run.created_at)} ago</span>
            </div>
            <div className="rounded border border-edge p-2 text-muted">
              {t("github.runInAppHint", "CI run status is shown in-app. Use the external-link button only when you need GitHub logs/artifacts.")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (detail) {
    const item = detail.item;
    const issue = detail.kind === "issue" ? detail.item : null;
    const pull = detail.kind === "pull" ? detail.item : null;
    return (
      <div className="flex h-full min-w-0 flex-col bg-surface text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-edge p-2">
          <button onClick={() => setDetail(null)} className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong">
            ←
          </button>
          <span className="font-medium text-strong">#{item.number}</span>
          <span className="min-w-0 flex-1 truncate text-strong">{item.title}</span>
          {issue ? stateBadge(issue.state) : pull ? stateBadge(pull.state, pull.draft) : null}
          <button
            onClick={() => void ipc.openUrl(item.html_url)}
            className="ml-auto text-muted hover:text-strong"
            title={t("common.openInBrowser", "Open in browser")}
          >
            <ExternalLink size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-1 text-xs text-muted">
            @{item.user} · {timeAgo(item.created_at)}
            {issue && issue.labels.length > 0 ? ` · ${issue.labels.join(", ")}` : ""}
            {pull ? ` · ${pull.head} → ${pull.base}` : ""}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-strong">{item.body || "—"}</pre>
          <div className="mt-4 border-t border-edge pt-2 text-xs font-medium text-muted">
            {detail.kind === "pull" ? t("github.prConversation", "PR conversation") : t("github.comments", "Comments")}
          </div>
          {comments === null ? (
            <div className="p-2 text-xs text-muted">{t("common.loading", "Loading…")}</div>
          ) : comments.length === 0 ? (
            <div className="p-2 text-xs text-muted">{t("github.noComments", "No comments")}</div>
          ) : (
            comments.map((c, i) => (
              <div key={i} className="mt-2 rounded border border-edge p-2">
                <div className="mb-1 text-xs text-muted">@{c.user} · {timeAgo(c.created_at)}</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-strong">{c.body}</pre>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge p-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void sendComment()}
            placeholder={t("github.commentPlaceholder", "Write a comment… (GitHub token required)")}
            className="min-w-48 flex-1 rounded border border-edge bg-transparent px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => void sendComment()}
            disabled={!commentText.trim()}
            className="rounded border border-edge px-2 py-1 text-xs text-muted hover:text-strong disabled:opacity-40"
          >
            {t("common.send", "Send")}
          </button>
        </div>
      </div>
    );
  }

  // ---- list view -----------------------------------------------------------
  return (
    <div className="flex h-full min-w-0 flex-col bg-surface text-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-edge p-2">
        {(
          [
            ["issues", t("github.issues", "Issues"), CircleDot],
            ["pulls", t("github.pulls", "Pull Requests"), GitPullRequest],
            ["ci", t("github.ci", "CI"), Loader2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${tab === id ? "bg-edge text-strong" : "text-muted hover:text-strong"}`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
        <span className="ml-2 min-w-0 flex-1 truncate text-xs text-muted">{slug}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {tab !== "ci" && (
            <select
              value={state}
              onChange={(e) => setState(e.target.value as IssueState)}
              className="rounded border border-edge bg-surface px-1 py-0.5 text-xs text-muted"
            >
              <option value="open">{t("github.state.open", "Open")}</option>
              <option value="closed">{t("github.state.closed", "Closed")}</option>
              <option value="all">{t("github.state.all", "All")}</option>
            </select>
          )}
          {tab === "issues" && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong"
            >
              <Plus size={12} />
              {t("github.newIssue", "New issue")}
            </button>
          )}
          {tab === "pulls" && (
            <button
              onClick={() => void openPrForm()}
              className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong"
            >
              <Plus size={12} />
              {t("github.newPr", "New PR")}
            </button>
          )}
          <button onClick={() => void refresh()} className="text-muted hover:text-strong" title={t("common.refresh", "Refresh")}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {creatingPr && tab === "pulls" && (
        <div className="flex flex-col gap-1 border-b border-edge p-2">
          <input
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder={t("github.issueTitle", "Title")}
            className="rounded border border-edge bg-transparent px-2 py-1 text-xs outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={prHead}
              onChange={(e) => setPrHead(e.target.value)}
              placeholder={t("github.prHead", "head branch")}
              className="min-w-32 flex-1 rounded border border-edge bg-transparent px-2 py-1 font-mono text-xs outline-none"
            />
            <span className="text-xs text-muted">→</span>
            <input
              value={prBase}
              onChange={(e) => setPrBase(e.target.value)}
              placeholder={t("github.prBase", "base branch")}
              className="min-w-32 flex-1 rounded border border-edge bg-transparent px-2 py-1 font-mono text-xs outline-none"
            />
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={prDraft} onChange={(e) => setPrDraft(e.target.checked)} className="accent-accent" />
              {t("github.draft", "draft")}
            </label>
          </div>
          <textarea
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            placeholder={t("github.issueBody", "Description (optional)")}
            rows={3}
            className="rounded border border-edge bg-transparent px-2 py-1 text-xs outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void createPull()}
              disabled={prBusy || !prTitle.trim() || !prHead.trim() || !prBase.trim()}
              className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong disabled:opacity-40"
            >
              {prBusy ? t("common.loading", "Loading…") : t("common.create", "Create")}
            </button>
            <button onClick={() => setCreatingPr(false)} className="rounded px-2 py-0.5 text-xs text-muted hover:text-strong">
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {creating && tab === "issues" && (
        <div className="flex flex-col gap-1 border-b border-edge p-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("github.issueTitle", "Title")}
            className="rounded border border-edge bg-transparent px-2 py-1 text-xs outline-none"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={t("github.issueBody", "Description (optional)")}
            rows={3}
            className="rounded border border-edge bg-transparent px-2 py-1 text-xs outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void createIssue()}
              disabled={!newTitle.trim()}
              className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong disabled:opacity-40"
            >
              {t("common.create", "Create")}
            </button>
            <button onClick={() => setCreating(false)} className="rounded px-2 py-0.5 text-xs text-muted hover:text-strong">
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "issues" &&
          (issues.length === 0 ? (
            <div className="p-3 text-xs text-muted">{busy ? t("common.loading", "Loading…") : t("common.empty", "Nothing here yet")}</div>
          ) : (
            issues.map((i) => (
              <button
                key={i.number}
                onClick={() => void loadConversation({ kind: "issue", item: i })}
                className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-edge/50 px-3 py-2 text-left hover:bg-edge/30"
              >
                <CircleDot size={14} className={i.state === "open" ? "text-success" : "text-info"} />
                <span className="min-w-48 flex-1 truncate text-strong">
                  <span className="text-muted">#{i.number}</span> {i.title}
                </span>
                {i.labels.slice(0, 3).map((l) => (
                  <span key={l} className="rounded bg-edge px-1 py-0.5 text-[10px] text-muted">{l}</span>
                ))}
                {i.comments > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted">
                    <MessageSquare size={11} />
                    {i.comments}
                  </span>
                )}
                <span className="text-[10px] text-muted">@{i.user} · {timeAgo(i.updated_at)}</span>
              </button>
            ))
          ))}
        {tab === "pulls" &&
          (pulls.length === 0 ? (
            <div className="p-3 text-xs text-muted">{busy ? t("common.loading", "Loading…") : t("common.empty", "Nothing here yet")}</div>
          ) : (
            pulls.map((p) => (
              <button
                key={p.number}
                onClick={() => void loadConversation({ kind: "pull", item: p })}
                className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-edge/50 px-3 py-2 text-left hover:bg-edge/30"
                title={t("github.openPrInApp", "Open PR details in Luxor")}
              >
                <GitPullRequest size={14} className={p.state === "open" ? "text-success" : "text-info"} />
                <span className="min-w-48 flex-1 truncate text-strong">
                  <span className="text-muted">#{p.number}</span> {p.title}
                </span>
                {stateBadge(p.state, p.draft)}
                <span className="text-[10px] text-muted">{p.head} → {p.base}</span>
                <span className="text-[10px] text-muted">@{p.user} · {timeAgo(p.updated_at)}</span>
              </button>
            ))
          ))}
        {tab === "ci" &&
          (runs.length === 0 ? (
            <div className="p-3 text-xs text-muted">{busy ? t("common.loading", "Loading…") : t("github.noRuns", "No CI runs found")}</div>
          ) : (
            runs.map((r) => (
              <button
                key={r.id}
                onClick={() => void loadConversation({ kind: "run", item: r })}
                className="flex w-full min-w-0 flex-wrap items-center gap-2 border-b border-edge/50 px-3 py-2 text-left hover:bg-edge/30"
                title={t("github.openRunInApp", "Open CI run details in Luxor")}
              >
                {runIcon(r)}
                <span className="min-w-40 flex-1 truncate text-strong">
                  {r.name} <span className="text-muted">#{r.run_number}</span>
                </span>
                <span className="rounded bg-edge px-1 py-0.5 text-[10px] text-muted">{r.branch}</span>
                <span className="text-[10px] text-muted">{r.event} · {timeAgo(r.created_at)}</span>
              </button>
            ))
          ))}
      </div>
      <div className="border-t border-edge p-1.5 text-[10px] text-muted">
        {t("github.tokenHint", "Without a GitHub token only public repos work (60 req/h). Add a token for github.com in Git settings.")}
      </div>
    </div>
  );
}
