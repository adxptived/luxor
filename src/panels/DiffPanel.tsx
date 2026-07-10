/** Side-by-side file diff rendered with @codemirror/merge. */

import type { IDockviewPanelProps } from "dockview";
import { useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { DiffTarget } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { isLightTheme } from "@/lib/themes";
import { useAppStore } from "@/state/appStore";

interface DiffParams {
  repoPath: string;
  filePath: string;
  target: DiffTarget;
  commitId?: string;
  [key: string]: unknown;
}

const COMPACT_DIFF_WIDTH = 760;

function estimateStats(oldContent: string, newContent: string): { added: number; removed: number; changed: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  let o = 0;
  while (o < oldLines.length && o < newLines.length && oldLines[o] === newLines[o]) o++;
  let s = 0;
  while (
    s < oldLines.length - o &&
    s < newLines.length - o &&
    oldLines[oldLines.length - 1 - s] === newLines[newLines.length - 1 - s]
  ) s++;
  const removed = Math.max(0, oldLines.length - o - s);
  const added = Math.max(0, newLines.length - o - s);
  return { added, removed, changed: Math.max(added, removed) };
}

export function DiffPanel(props: IDockviewPanelProps) {
  const params = props.params as DiffParams;
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [stats, setStats] = useState<{ added: number; removed: number; changed: number } | null>(null);
  const [sideBySide, setSideBySide] = useState(
    () => (useAppStore.getState().config?.git.diff_view ?? "side_by_side") === "side_by_side",
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<{ destroy(): void } | null>(null);
  const editorTheme = useAppStore((s) => s.config?.ui.editor_theme ?? "luxor-dark");
  const appTheme = useAppStore((s) => s.config?.theme ?? "dark");

  // Build (or rebuild) the diff view. A single effect handles everything that
  // changes the rendered diff — the file/target, the Inline⇄Split toggle, AND
  // the editor/app theme — so switching theme correctly re-mounts the view
  // (the old code keyed off a `.cm-merge-container` class that never existed,
  // so theme changes silently did nothing).
  //
  // Split  → @codemirror/merge `MergeView` (two columns, a|b).
  // Inline → `unifiedMergeView` (one column, deletions shown inline). The old
  // code passed `orientation: "a-b"` in BOTH branches, so the Inline button was
  // a dead no-op and a user whose config set diff_view="inline" still got a
  // side-by-side view — the "diff is broken" report.
  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    setError(null);
    setBinary(false);
    setStats(null);

    const load = async () => {
      try {
        const diff = await ipc.gitFileDiff(params.repoPath, params.filePath, params.target, params.commitId);
        if (disposed || !hostRef.current) return;
        if (diff.binary) {
          setBinary(true);
          return;
        }
        setStats(estimateStats(diff.old_content, diff.new_content));

        const [{ MergeView, unifiedMergeView }, { buildEditorTheme }, viewMod, { EditorState }, { detectLanguage }, { resolveLanguageExtension }] =
          await Promise.all([
            import("@codemirror/merge"),
            import("@/lib/codemirrorThemes"),
            import("@codemirror/view"),
            import("@codemirror/state"),
            import("@/lib/editorLanguage"),
            import("@/lib/codemirrorLanguages"),
          ]);
        if (disposed || !hostRef.current) return;
        const { EditorView, lineNumbers } = viewMod;

        const themeExt = buildEditorTheme(
          useAppStore.getState().config?.ui.editor_theme ?? "luxor-dark",
          isLightTheme(useAppStore.getState().config?.theme ?? "dark"),
        );
        // Syntax-highlight the diff the same way the editor would — resolved
        // from the file path so a `.rs`/`.ts`/`.toml` diff reads like real code
        // instead of a flat textarea (matches a VS Code-style diff view).
        const langExt = await resolveLanguageExtension(detectLanguage(params.filePath));
        if (disposed || !hostRef.current) return;
        // Diffs are for reading; keep selection/scroll but disallow edits.
        const readOnly = EditorView.editable.of(false);
        // Shared per-pane extensions: theme, read-only, line-number gutter and
        // language highlighting. The line numbers + the merge addon's own change
        // gutter give each side the gutter strip seen in a VS Code diff.
        const baseExt = [themeExt, readOnly, lineNumbers(), langExt];
        // Narrow panels can't fit two columns, so force the inline view there
        // even when Split is selected.
        const narrow = hostRef.current.getBoundingClientRect().width < COMPACT_DIFF_WIDTH;
        const split = sideBySide && !narrow;

        mergeViewRef.current?.destroy();
        hostRef.current.innerHTML = "";

        if (split) {
          mergeViewRef.current = new MergeView({
            a: { doc: diff.old_content, extensions: [...baseExt] },
            b: { doc: diff.new_content, extensions: [...baseExt] },
            parent: hostRef.current,
            orientation: "a-b",
            collapseUnchanged: { margin: 3, minSize: 6 },
          });
        } else {
          mergeViewRef.current = new EditorView({
            parent: hostRef.current,
            state: EditorState.create({
              doc: diff.new_content,
              extensions: [
                ...baseExt,
                unifiedMergeView({
                  original: diff.old_content,
                  mergeControls: false,
                  collapseUnchanged: { margin: 3, minSize: 6 },
                }),
              ],
            }),
          });
        }
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
    };
    void load();
    return () => {
      disposed = true;
      mergeViewRef.current?.destroy();
      mergeViewRef.current = null;
    };
     
  }, [params.repoPath, params.filePath, params.target, params.commitId, sideBySide, editorTheme, appTheme]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
        Diff failed: {error}
      </div>
    );
  }
  if (binary) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6 text-sm text-muted">
        Binary or oversized file — diff not shown.
      </div>
    );
  }
  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden flex-col bg-surface">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-bar/90 px-2 py-1.5 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate font-mono text-strong" title={params.filePath}>
          {params.filePath}
        </span>
        {stats && (
          <div className="flex shrink-0 items-center gap-1.5" aria-label={t("Diff summary")}>
            <span className="rounded-md border border-success/30 bg-success/12 px-1.5 py-0.5 font-medium text-success">
              +{stats.added}
            </span>
            <span className="rounded-md border border-danger/30 bg-danger/12 px-1.5 py-0.5 font-medium text-danger">
              −{stats.removed}
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-edge bg-surface p-0.5">
          <button
            className={`rounded-md px-2 py-0.5 text-xs transition-colors ${!sideBySide ? "bg-raised text-strong" : "text-muted hover:text-strong"}`}
            onClick={() => setSideBySide(false)}
          >
            {t("Inline")}
          </button>
          <button
            className={`rounded-md px-2 py-0.5 text-xs transition-colors ${sideBySide ? "bg-raised text-strong" : "text-muted hover:text-strong"}`}
            onClick={() => setSideBySide(true)}
          >
            {t("Split")}
          </button>
        </div>
      </div>
      <div ref={hostRef} className="lx-diff-codemirror relative min-h-0 min-w-0 flex-1 overflow-hidden" />
    </div>
  );
}
