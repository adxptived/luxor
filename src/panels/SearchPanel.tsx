/** Project-wide search & replace with per-file selection and preview. */

import { CaseSensitive, CheckCircle2, FileText, FolderSearch, History, Loader2, Regex, Replace, Search, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VList } from "virtua";

import { NoFolderCta } from "@/components/NoFolderCta";
import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { previewReplacement } from "@/lib/replacePreview";
import { clearSearchHistory, loadSearchHistory, pushSearchHistory } from "@/lib/searchHistory";
import { announce } from "@/lib/useAriaLive";
import type { SearchHit, SearchReport } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useActiveProject } from "@/state/projectsStore";
import { confirmDestructive } from "@/state/uiStore";

export function SearchPanel() {
  const project = useActiveProject();
  const toast = useAppStore((s) => s.toast);
  const openFile = useDockStore((s) => s.openFile);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [report, setReport] = useState<SearchReport | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory());
  const [showHistory, setShowHistory] = useState(false);
  // Snapshot of file contents captured just before a mass replace, so the
  // operation can be undone in one click (files keyed by absolute path).
  const [undoSnapshot, setUndoSnapshot] = useState<Map<string, string> | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the query box when the panel opens (Ctrl+Shift+F lands ready to type).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const root = project?.path || "";

  const byFile = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of report?.hits ?? []) {
      const list = map.get(hit.path) ?? [];
      list.push(hit);
      map.set(hit.path, list);
    }
    return map;
  }, [report]);

  if (!project || root === "") return <NoFolderCta hint={t("Attach a folder to search across project files.")} />;

  const run = async () => {
    if (!query.trim()) return;
    const id = ++seq.current;
    setBusy(true);
    setShowHistory(false);
    setHistory((h) => pushSearchHistory(h, query));
    try {
      const result = await ipc.searchInProject(root, query, useRegex, caseSensitive);
      if (id === seq.current) {
        setReport(result);
        setExcluded(new Set());
        // Announce the outcome: search updates a live region silently, so SR
        // users otherwise get no feedback that the search completed (P2AX-06).
        const n = result.hits.length;
        announce(n === 0 ? t("No matches found") : `${n} ${t("result(s)")}`);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  const applyReplace = async () => {
    const paths = [...byFile.keys()].filter((p) => !excluded.has(p));
    if (paths.length === 0) return;
    const ok = await confirmDestructive({
      title: t("Replace in files"),
      message: `${t("Replace")} “${query}” → “${replacement}” (${t("files:")} ${paths.length})?`,
      confirmLabel: t("Replace"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Snapshot the affected files BEFORE replacing so the operation can be
      // undone. If snapshotting any file fails we proceed without undo rather
      // than blocking the replace.
      let snapshot: Map<string, string> | null = new Map();
      try {
        for (const p of paths) {
          const file = await ipc.fsReadText(`${root}/${p}`);
          if (file.truncated) {
            // A truncated snapshot would corrupt the file on restore — offer
            // no undo at all rather than a dangerous partial one.
            snapshot = null;
            break;
          }
          snapshot.set(`${root}/${p}`, file.content);
        }
      } catch {
        snapshot = null;
      }
      const result = await ipc.replaceInProject(root, query, replacement, useRegex, caseSensitive, paths);
      setUndoSnapshot(result.files_changed > 0 ? snapshot : null);
      toast(`${t("Replaced occurrences:")} ${result.replacements} (${t("files:")} ${result.files_changed})`, "success");
      await run();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const undoReplace = async () => {
    if (!undoSnapshot) return;
    setBusy(true);
    try {
      for (const [path, content] of undoSnapshot) {
        await ipc.fsWriteText(path, content);
      }
      toast(`${t("Restored files:")} ${undoSnapshot.size}`, "success");
      setUndoSnapshot(null);
      await run();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleFile = (path: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const includedFiles = [...byFile.keys()].filter((p) => !excluded.has(p)).length;
  const hasResults = !!report && report.hits.length > 0;

  return (
    <div className="flex h-full flex-col bg-surface text-sm lx-fade-in">
      <div className="border-b border-edge bg-bar/55 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
              <FolderSearch size={18} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-strong">{t("Search & replace")}</div>
              <div className="truncate text-xs text-muted" title={root}>{project.name} · {root}</div>
            </div>
          </div>
          {report && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
              <Stat>{report.hits.length} result(s)</Stat>
              <Stat>{byFile.size} file(s)</Stat>
              <Stat>{report.files_scanned} scanned</Stat>
              {report.truncated && <Stat tone="warn">truncated</Stat>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void run();
                if (e.key === "Escape") setShowHistory(false);
              }}
              onFocus={() => history.length > 0 && setShowHistory(true)}
              onBlur={() => window.setTimeout(() => setShowHistory(false), 150)}
              placeholder={t("Search in project…")}
              role="combobox"
              aria-expanded={showHistory}
              aria-controls="search-history-list"
              className="w-full rounded-lg border border-edge bg-surface py-2 pl-9 pr-8 text-strong outline-none placeholder:text-muted focus:border-accent/70"
            />
            {query && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-raised hover:text-strong" onClick={() => setQuery("")} aria-label={t("Clear search")} title={t("Clear search")}>
                <X size={13} />
              </button>
            )}
            {showHistory && history.length > 0 && (
              <div
                id="search-history-list"
                role="listbox"
                aria-label={t("Recent searches")}
                className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-edge bg-raised shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-edge/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted">
                  <span className="inline-flex items-center gap-1"><History size={11} /> {t("Recent searches")}</span>
                  <button
                    className="rounded px-1.5 py-0.5 hover:bg-surface hover:text-strong"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setHistory(clearSearchHistory())}
                  >
                    {t("Clear")}
                  </button>
                </div>
                {history.slice(0, 8).map((h) => (
                  <button
                    key={h}
                    role="option"
                    aria-selected={h === query}
                    className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs text-strong hover:bg-surface"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery(h);
                      setShowHistory(false);
                      inputRef.current?.focus();
                    }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface/70 p-1">
            <Toggle active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} title={t("Match case")} label="Aa">
              <CaseSensitive size={14} />
            </Toggle>
            <Toggle active={useRegex} onClick={() => setUseRegex((v) => !v)} title={t("Use regular expression")} label=".*">
              <Regex size={14} />
            </Toggle>
            <Toggle active={showReplace} onClick={() => setShowReplace((v) => !v)} title={t("Toggle replace")} label="Replace">
              <Replace size={14} />
            </Toggle>
          </div>
          <button
            onClick={() => void run()}
            disabled={busy || !query.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent shadow-sm disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t("Search")}
          </button>
        </div>

        {showReplace && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface/60 p-2">
            <div className="relative min-w-48 flex-1">
              <Replace size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder={t("Replace with…")}
                className="w-full rounded-lg border border-edge bg-raised py-2 pl-9 pr-2 text-strong outline-none focus:border-accent/70"
              />
            </div>
            <span className="text-xs text-muted">{includedFiles} file(s) selected</span>
            <button
              onClick={() => void applyReplace()}
              disabled={busy || !hasResults || includedFiles === 0}
              className="rounded-lg border border-danger-soft-strong bg-danger-soft px-3 py-2 text-xs font-medium text-danger hover:bg-danger-soft-strong disabled:opacity-40"
            >
              Replace selected
            </button>
            {undoSnapshot && (
              <button
                onClick={() => void undoReplace()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-xs font-medium text-strong hover:bg-raised disabled:opacity-40"
                title={t("Restore the files changed by the last replace")}
              >
                <Undo2 size={13} />
                {t("Undo replace")} ({undoSnapshot.size})
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {!report && (
          <EmptyState
            icon={<FolderSearch size={28} />}
            title={t("Search across the whole project")}
            text={t("Use Ctrl+Shift+F, regex/match-case toggles, then optionally preview replace by file before applying.")}
          />
        )}
        {report && report.hits.length === 0 && (
          <EmptyState
            icon={<CheckCircle2 size={28} />}
            title={t("No matches found")}
            text={t("Try a shorter query, disable match case, or check whether regex mode is too strict.")}
          />
        )}
        {report && report.hits.length > 0 && (
          // Virtualized: the backend returns up to 5000 hits (audit 3.1).
          <VList style={{ height: "100%" }} className="lx-virtual-scroll">
          {[...byFile.entries()].map(([path, hits]) => (
            <div key={path} className="mb-2 overflow-hidden rounded-lg border border-edge bg-bar/25 shadow-sm">
              {/* Opaque bg instead of translucent + backdrop-blur: a per-group
                  sticky blur inside the scroller forced a re-blur of passing
                  content on EVERY scroll frame (very costly on WebView2). */}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-edge bg-raised px-3 py-2 text-xs">
                {showReplace && (
                  <input
                    type="checkbox"
                    checked={!excluded.has(path)}
                    onChange={() => toggleFile(path)}
                    className="accent-accent"
                    title={excluded.has(path) ? t("Excluded from replace") : t("Included in replace")}
                  />
                )}
                <FileText size={13} className="shrink-0 text-accent" />
                <button
                  className="min-w-0 flex-1 truncate text-left font-medium text-strong hover:text-accent"
                  onClick={() => openFile(`${root}/${path}`, { line: hits[0]?.line })}
                  title={path}
                >
                  {path}
                </button>
                <span className="rounded-full border border-edge bg-surface px-2 py-0.5 font-mono text-[10px] text-muted">{hits.length}</span>
              </div>
              <div className="divide-y divide-edge/50">
                {hits.map((hit, i) => {
                  // When the replace bar is open, show an inline diff preview:
                  // matched text struck through + what it will become.
                  const preview = showReplace && !excluded.has(path)
                    ? previewReplacement(hit.text.slice(hit.start, hit.end), replacement, useRegex, caseSensitive, query)
                    : null;
                  return (
                    <button
                      key={`${hit.line}-${i}`}
                      onClick={() => openFile(`${root}/${path}`, { line: hit.line })}
                      className="flex w-full gap-3 px-3 py-1.5 text-left hover:bg-raised/70"
                    >
                      <span className="w-12 shrink-0 rounded-md bg-surface px-1 py-0.5 text-right font-mono text-[11px] text-muted">{hit.line}</span>
                      <span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-xs leading-5 text-strong">
                        {hit.text.slice(0, hit.start)}
                        {preview?.replaced != null ? (
                          <>
                            <del className="rounded bg-danger-soft px-0.5 text-danger line-through decoration-danger/60">{hit.text.slice(hit.start, hit.end)}</del>
                            <ins className="rounded bg-success-soft px-0.5 text-success no-underline">{preview.replaced}</ins>
                          </>
                        ) : (
                          <mark className="rounded bg-accent/30 px-0.5 text-strong">{hit.text.slice(hit.start, hit.end)}</mark>
                        )}
                        {hit.text.slice(hit.end)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </VList>
        )}
      </div>
    </div>
  );
}

function Stat({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <span className={`rounded-full border px-2 py-1 ${tone === "warn" ? "border-warning-soft-strong bg-warning-soft text-warning" : "border-edge bg-surface text-muted"}`}>
      {children}
    </span>
  );
}

function Toggle({
  active,
  onClick,
  title,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${
        active ? "bg-raised text-strong" : "text-muted hover:bg-raised hover:text-strong"
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-4 lx-fade-in">
      <div className="max-w-md rounded-lg border border-dashed border-edge bg-bar/30 px-6 py-8 text-center text-muted">
        <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">{icon}</div>
        <div className="font-medium text-strong">{title}</div>
        <div className="mt-1 text-xs leading-5">{text}</div>
      </div>
    </div>
  );
}
