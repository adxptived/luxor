/** CodeMirror 6 editor surface — the text editor shown in the dock.
 *  Save (Ctrl+S), find/replace, format, language picker, theme picker,
 *  shortcuts, dirty guard, status bar — all preserved across the migration from
 *  Monaco to CodeMirror. */

import type { IDockviewPanelProps } from "dockview";
import { AlignLeft, CheckSquare, ChevronRight, ClipboardPaste, Code2, Copy, CornerDownLeft, Eye, Keyboard, MoreHorizontal, Palette, Pilcrow, Redo2, Replace, Save, Scissors, Search, Type, Undo2, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { pushStructured } from "@/lib/logBuffer";
import { t } from "@/lib/i18n";
import { registerDirtyGuard } from "@/lib/dirtyGuard";
import { registerEditor } from "@/lib/editorBus";
import { HexView } from "@/components/HexView";
import { errorMessage } from "@/lib/types";
import { cursorLabel, langLabel, selectionLabel } from "@/lib/editorStatus";
import { EDITOR_LANGUAGE_OPTIONS, detectLanguage, languageForPath, languageLabel } from "@/lib/editorLanguage";
import { fileName } from "@/layout/dockStore";
import { CODEMIRROR_THEMES } from "@/lib/codemirrorThemeMeta";
import type { MountedEditor } from "@/lib/codemirror";
import { isLightTheme } from "@/lib/themes";
import { useAppStore } from "@/state/appStore";
import { openContextMenu, type MenuItem, useUiStore } from "@/state/uiStore";

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "markdown";
}

function isHtmlPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "html" || ext === "htm";
}

async function renderMarkdown(src: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import("marked"),
    import("dompurify"),
  ]);
  return DOMPurify.sanitize(marked.parse(src, { async: false, gfm: true }));
}

function editorLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.55);
}

/**
 * Resolve once the element has a real, paintable size (width AND height > 0).
 *
 * Why this exists: CodeMirror builds its internal line-height map from the
 * container's geometry at the moment it mounts. Dockview creates a tab's DOM
 * before it is shown, so a freshly-opened (or background) editor tab can be
 * 0×0 when our mount effect runs. Mounting then makes CM estimate line heights
 * and lay the gutter out against that wrong map — the line numbers end up
 * detached from the text (gutter shows lines 60+ at the top while the text
 * sits far below). Chromium self-heals via ResizeObserver, but Tauri's
 * WebView2 / WKWebView frequently do NOT re-measure, so the breakage sticks.
 *
 * Waiting for a non-zero size before mounting guarantees CM measures correct
 * geometry from the very first layout. A timeout fallback means we never hang
 * if the element somehow stays collapsed (e.g. a genuinely hidden preview).
 */
function waitForContainerSize(el: HTMLElement, timeoutMs = 4000): Promise<void> {
  const hasSize = () => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().width > 0;
  if (hasSize()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      ro?.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (hasSize()) done();
          })
        : null;
    ro?.observe(el);
    // Safety net for environments without ResizeObserver (and a hard cap so a
    // permanently-hidden container can't block the editor forever).
    const timer = setTimeout(done, timeoutMs);
    if (!ro) {
      const poll = () => {
        if (settled) return;
        if (hasSize()) done();
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
  });
}

type FileEditorSurfaceProps = {
  path: string;
  panelId: string;
  gotoLine?: number;
  embedded?: boolean;
  setPanelTitle?: (title: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function FileEditorSurface({ path, panelId, gotoLine, embedded = false, setPanelTitle, onDirtyChange }: FileEditorSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MountedEditor | null>(null);
  const visibilityObsRef = useRef<IntersectionObserver | null>(null);
  const dirtyRef = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const [dirty, setDirtyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const theme = useAppStore((s) => s.config?.theme ?? "dark");
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const editorTheme = useAppStore((s) => s.config?.ui.editor_theme ?? "luxor-dark");
  const markdown = isMarkdownPath(path);
  const html = isHtmlPath(path);
  const previewable = markdown || html;
  const [preview, setPreview] = useState(previewable);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [editorLoading, setEditorLoading] = useState(true);
  const contentRef = useRef("");
  const manualSaveRef = useRef<() => Promise<void>>(async () => {});
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [sel, setSel] = useState({ chars: 0, ranges: 0 });
  const [lang, setLang] = useState(() => languageForPath(path));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderWhitespace, setRenderWhitespace] = useState(() => {
    try {
      return localStorage.getItem("luxor.editor.renderWhitespace") === "all";
    } catch {
      return false;
    }
  });
  const [fontSize, setFontSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem("luxor.editor.fontSize"));
      return Number.isFinite(n) && n >= 10 && n <= 24 ? n : 13;
    } catch {
      return 13;
    }
  });
  const [wrap, setWrap] = useState(() => {
    try {
      return localStorage.getItem("luxor.editor.wordWrap") === "on";
    } catch {
      return false;
    }
  });

  const goToLine = async () => {
    const v = editorRef.current?.view;
    if (!v) return;
    // Use the app's custom prompt dialog (not window.prompt, which is
    // unreliable in Tauri WebView2 / WKWebView). Pre-fill with the current
    // line number so the user can just tweak it.
    const input = await useUiStore.getState().prompt({
      title: t("editor.go_to_line", "Go to line"),
      message: `${t("editor.line_of", "Line (of")} ${v.state.doc.lines})`,
      initial: String(cursor.line),
      confirmLabel: t("Go"),
    });
    if (input === null) return;
    const n = parseInt(input, 10);
    if (!Number.isFinite(n) || n < 1) return;
    revealLine(n);
  };

  const revealLine = (line: number) => {
    editorRef.current?.revealLine(line);
  };

  useEffect(
    () =>
      registerEditor(panelId, {
        save: () => saveRef.current(),
        reveal: revealLine,
        isDirty: () => dirtyRef.current,
      }),
    [panelId],
  );

  const doUndo = () => {
    import("@codemirror/commands").then(({ undo: undoCmd }) => {
      const v = editorRef.current?.view;
      if (v) undoCmd({ state: v.state, dispatch: v.dispatch });
    });
  };
  const doRedo = () => {
    import("@codemirror/commands").then(({ redo: redoCmd }) => {
      const v = editorRef.current?.view;
      if (v) redoCmd({ state: v.state, dispatch: v.dispatch });
    });
  };
  const doFormat = () => {
    const v = editorRef.current?.view;
    if (!v) return;
    // JSON is the one language we can format reliably and safely in-process
    // (no external formatter / no risk of corrupting code). Re-indent via a
    // normal dispatch so undo history and dirty-tracking both work. Other
    // languages would need a real formatter (prettier/rustfmt/…) which the
    // app intentionally leaves to the user's IDE.
    if (lang === "json") {
      const src = v.state.doc.toString();
      try {
        const formatted = JSON.stringify(JSON.parse(src), null, 2);
        if (formatted !== src) {
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: formatted } });
        }
        useAppStore.getState().toast(t("editor.formatted", "Formatted document"), "success");
      } catch (e) {
        useAppStore.getState().toast(`${t("editor.format_invalid_json", "Cannot format: invalid JSON")} — ${errorMessage(e)}`, "error");
      }
      return;
    }
    useAppStore.getState().toast(
      t("editor.format_unsupported", `Formatting for ${languageLabel(lang)} isn't built in — use your IDE's formatter`),
      "info",
    );
  };
  const saveNow = () => {
    void manualSaveRef.current();
  };
  const selectedText = () => {
    const v = editorRef.current?.view;
    if (!v) return "";
    return v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to)).join("\n");
  };
  const copySelection = () => {
    const text = selectedText();
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {});
  };
  const cutSelection = () => {
    const v = editorRef.current?.view;
    if (!v || truncated) return;
    const text = selectedText();
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {});
    v.dispatch(v.state.replaceSelection(""));
    v.focus();
  };
  const pasteClipboard = () => {
    const v = editorRef.current?.view;
    if (!v || truncated) return;
    void navigator.clipboard?.readText().then((text) => {
      if (!text) return;
      v.dispatch(v.state.replaceSelection(text));
      v.focus();
    }).catch(() => {});
  };
  const selectAllEditor = () => {
    const v = editorRef.current?.view;
    if (!v) return;
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
    v.focus();
  };
  const runEditorAction = (actionId: string) => {
    if (actionId === "actions.find") {
      import("@codemirror/search").then(({ openSearchPanel }) => {
        const v = editorRef.current?.view;
        if (v) openSearchPanel(v);
      });
    }
  };
  const changeLanguage = (id: string) => {
    setLang(id);
    void editorRef.current?.reconfigureLang(id);
  };
  const changeEditorTheme = (id: string) => {
    if (config) void saveConfig({ ...config, ui: { ...config.ui, editor_theme: id } });
    editorRef.current?.reconfigureTheme(id, isLightTheme(theme));
  };

  const setEditorFontSize = (next: number) => {
    const clamped = Math.max(10, Math.min(24, next));
    setFontSize(clamped);
    try {
      localStorage.setItem("luxor.editor.fontSize", String(clamped));
    } catch {
      /* ignore */
    }
  };

  const showPreview = () => {
    const src = editorRef.current?.getValue() ?? contentRef.current;
    setPreview(true);
    if (html) {
      setPreviewHtml(src);
      void ipc.fileSrc(path).then(setPreviewSrc, () => setPreviewSrc(null));
    } else {
      void renderMarkdown(src).then(setPreviewHtml);
    }
  };

  const setDirty = (dirty: boolean) => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    setDirtyState(dirty);
    setPanelTitle?.(dirty ? `● ${fileName(path)}` : fileName(path));
    onDirtyChange?.(dirty);
    // Trigger autosave when the file becomes dirty (debounced 2s).
    if (dirty) {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        void saveRef.current().then(() => {
          setAutosaveStatus("saved");
          setLastSaved(Date.now());
          setTimeout(() => setAutosaveStatus("idle"), 2000);
        });
      }, 2000);
    } else {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    }
  };

  useEffect(() => {
    return registerDirtyGuard(panelId, () => dirtyRef.current);
  }, [panelId]);

  // Cleanup autosave timer on unmount.
  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    // Declared in the effect scope (not inside the async IIFE) so the cleanup
    // callback below can actually see them. Assigned from within the async
    // mount once the editor is created.
    let refreshTimers: ReturnType<typeof setTimeout>[] = [];
    let resizeObs: ResizeObserver | null = null;
    const mountStart = performance.now();
    setLang(languageForPath(path));
    setShortcutsOpen(false);

    // Log mount start with container dimensions for debugging blank-editor issues
    const containerEl = containerRef.current;
    const containerRect = containerEl?.getBoundingClientRect();
    pushStructured("DEBUG", "editor", "mount start", {
      path,
      panelId,
      embedded,
      gotoLine: gotoLine ?? null,
      containerW: containerRect?.width ?? -1,
      containerH: containerRect?.height ?? -1,
      containerDisplay: containerEl ? getComputedStyle(containerEl).display : "null",
      fontSize,
      lineHeight: editorLineHeight(fontSize),
    });

    void (async () => {
      try {
        const readStart = performance.now();
        const file = await ipc.fsReadText(path);
        const readMs = Math.round(performance.now() - readStart);
        if (disposed) {
          pushStructured("DEBUG", "editor", "ipc read returned after dispose, skipping", { path, readMs });
          return;
        }
        const detectedLang = detectLanguage(path, file.content);
        setLang(detectedLang);
        setTruncated(file.truncated);
        contentRef.current = file.content;
        pushStructured("INFO", "editor", "file loaded", { path, bytes: file.content.length, truncated: file.truncated, readMs, lang: detectedLang });
        if (isMarkdownPath(path)) void renderMarkdown(file.content).then((h) => !disposed && setPreviewHtml(h));
        if (isHtmlPath(path)) {
          setPreviewHtml(file.content);
          void ipc.fileSrc(path).then(
            (src) => { if (!disposed) setPreviewSrc(src); },
            () => { if (!disposed) setPreviewSrc(null); },
          );
        }
        if (!containerRef.current) {
          pushStructured("WARN", "editor", "container ref null after file read — cannot mount", { path });
          return;
        }
        setEditorLoading(false);

        // Last known on-disk mtime — sent with every save so the backend can
        // detect external modifications (git checkout, formatter, another
        // editor) and refuse to silently overwrite them (audit 8.1).
        let knownMtimeMs: number | null = file.mtime_ms ?? null;

        const save = async (silent: boolean) => {
          const saveStart = performance.now();
          try {
            const content = editorRef.current?.getValue() ?? file.content;
            let newMtimeMs: number | null;
            try {
              newMtimeMs = await ipc.fsWriteText(path, content, knownMtimeMs);
            } catch (e) {
              const kind = (e as { kind?: string } | null)?.kind;
              if (kind !== "conflict") throw e;
              pushStructured("WARN", "editor", "save conflict: file changed on disk", { path, silent });
              if (silent) {
                // Never let autosave clobber external changes — surface it
                // and wait for an explicit user decision via manual save.
                useAppStore
                  .getState()
                  .toast(
                    t(
                      "editor.conflict_autosave",
                      "File changed on disk — autosave paused. Ctrl+S to overwrite.",
                    ),
                    "error",
                  );
                return;
              }
              const overwrite = window.confirm(
                t(
                  "editor.conflict_prompt",
                  "This file was modified on disk since you opened it.\n\nOK — overwrite with your version\nCancel — keep the file on disk (reopen the file to reload)",
                ),
              );
              if (!overwrite) return;
              newMtimeMs = await ipc.fsWriteText(path, content, null);
            }
            knownMtimeMs = newMtimeMs ?? null;
            if (isHtmlPath(path)) {
              setPreviewHtml(content);
              setPreviewReloadKey((k) => k + 1);
              void ipc.fileSrc(path).then(setPreviewSrc, () => setPreviewSrc(null));
            }
            setDirty(false);
            pushStructured("DEBUG", "editor", "save ok", { path, silent, bytes: content.length, ms: Math.round(performance.now() - saveStart) });
            if (!silent) useAppStore.getState().toast(`${t("editor.saved", "Saved")} ${fileName(path)}`, "success");
          } catch (e) {
            pushStructured("ERROR", "editor", "save failed", { path, silent, error: errorMessage(e) });
            useAppStore.getState().toast(`${t("editor.save_failed", "Save failed:")} ${errorMessage(e)}`, "error");
          }
        };
        saveRef.current = () => save(true);
        manualSaveRef.current = () => save(false);

        // Log container dimensions right before mount
        const preMountRect = containerRef.current.getBoundingClientRect();
        pushStructured("DEBUG", "editor", "pre-mount container dims", {
          path,
          w: preMountRect.width,
          h: preMountRect.height,
          offsetW: containerRef.current.offsetWidth,
          offsetH: containerRef.current.offsetHeight,
        });

        // WebView2/WKWebView fix: never mount CodeMirror into a 0-size
        // container. Wait for the dock tab to actually have a paintable size so
        // CM measures correct line geometry up front (otherwise the gutter and
        // text desync and Tauri's WebView won't re-measure to recover).
        await waitForContainerSize(containerRef.current);
        if (disposed || !containerRef.current) {
          pushStructured("DEBUG", "editor", "disposed while waiting for container size", { path });
          return;
        }

        const mountInnerStart = performance.now();
        const { mountEditor } = await import("@/lib/codemirror");
        if (disposed || !containerRef.current) return;
        const editor = await mountEditor(containerRef.current, {
          doc: file.content,
          languageId: detectedLang,
          themeId: useAppStore.getState().config?.ui.editor_theme ?? "luxor-dark",
          isLightTheme: isLightTheme(useAppStore.getState().config?.theme ?? "dark"),
          readOnly: file.truncated,
          onSave: () => { void save(false); },
          onFind: () => runEditorAction("actions.find"),
          onReplace: () => { /* built-in searchKeymap handles Ctrl+H */ },
          onGoToLine: () => goToLine(),
          onFormat: () => doFormat(),
          onComment: () => { /* Ctrl+/ comment toggle is handled natively by CodeMirror's toggleComment in the keymap */ },
          onToggleWrap: () => toggleWrap(),
          onSelectionChange: (c, s) => {
            setCursor(c);
            setSel(s);
          },
          onDirtyChange: (d) => setDirty(d),
        });
        // Race guard: if the user switched tabs while `mountEditor` was awaiting
        // a lazy language pack, the cleanup callback below has already run and
        // `disposed` is true — keeping the freshly-mounted editor would leak it
        // and overwrite the (already-null) ref of the next file. Tear it down
        // immediately and bail out.
        if (disposed) {
          editor.destroy();
          pushStructured("WARN", "editor", "mount completed after dispose — destroying", { path });
          return;
        }
        editorRef.current = editor;
        const mountMs = Math.round(performance.now() - mountInnerStart);
        const totalMs = Math.round(performance.now() - mountStart);

        // Log post-mount dimensions and CodeMirror DOM state
        const postMountRect = containerRef.current?.getBoundingClientRect();
        const cmEditor = containerRef.current?.querySelector(".cm-editor");
        const cmScroller = containerRef.current?.querySelector(".cm-scroller");
        const cmContent = containerRef.current?.querySelector(".cm-content");
        const cmGutters = containerRef.current?.querySelector(".cm-gutters");
        pushStructured("INFO", "editor", "editor mounted", {
          path,
          lang: detectedLang,
          mountMs,
          totalMs,
          containerW: postMountRect?.width ?? -1,
          containerH: postMountRect?.height ?? -1,
          cmEditorH: cmEditor?.getBoundingClientRect().height ?? -1,
          cmScrollerH: cmScroller?.getBoundingClientRect().height ?? -1,
          cmScrollerW: cmScroller?.getBoundingClientRect().width ?? -1,
          cmContentH: cmContent?.scrollHeight ?? -1,
          cmContentW: cmContent?.scrollWidth ?? -1,
          cmGuttersW: cmGutters?.getBoundingClientRect().width ?? -1,
          cmContentChildren: cmContent?.childElementCount ?? -1,
          docLines: file.content.split("\n").length,
        });
        // The editor may have mounted into a hidden / zero-size container (the
        // Markdown preview wrapper uses `display:none`; dockview hides inactive
        // tabs). CodeMirror only lays out the visible viewport, so in that case
        // the gutter paints but the text stays blank ("line numbers but no
        // text"). Re-measure once now, and again whenever the container becomes
        // visible. Chromium self-heals via ResizeObserver, but Tauri's
        // WebView2 / WKWebView often do not — so this observer is what actually
        // makes the text appear after a tab switch or preview→source toggle.
        requestAnimationFrame(() => {
          editorRef.current?.refresh();
          const cmContent2 = containerRef.current?.querySelector(".cm-content");
          const cmScroller2 = containerRef.current?.querySelector(".cm-scroller");
          pushStructured("DEBUG", "editor", "post-refresh state", {
            path,
            cmContentH: cmContent2?.scrollHeight ?? -1,
            cmContentChildren: cmContent2?.childElementCount ?? -1,
            cmScrollerH: cmScroller2?.getBoundingClientRect().height ?? -1,
            cmScrollerW: cmScroller2?.getBoundingClientRect().width ?? -1,
          });
        });

        // Delayed refreshes: dockview panels may resize after the editor mounts.
        // Each delayed refresh re-measures the editor so the text layer fills the
        // now-correct container size. Belt-and-suspenders fix for blank-editor.
        const refreshDelays = [100, 500, 1000];
        refreshTimers = refreshDelays.map((ms) =>
          setTimeout(() => {
            if (!disposed && editorRef.current) {
              editorRef.current.refresh();
              pushStructured("DEBUG", "editor", `delayed refresh (${ms}ms)`, {
                path,
                cmContentH: containerRef.current?.querySelector(".cm-content")?.scrollHeight ?? -1,
                cmScrollerH: containerRef.current?.querySelector(".cm-scroller")?.getBoundingClientRect().height ?? -1,
              });
            }
          }, ms),
        );

        // ResizeObserver: re-measure the editor whenever the container resizes.
        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
          resizeObs = new ResizeObserver(() => {
            if (!disposed && editorRef.current) editorRef.current.refresh();
          });
          resizeObs.observe(containerRef.current);
        }

        if (typeof IntersectionObserver !== "undefined" && containerRef.current) {
          const obs = new IntersectionObserver((entries) => {
            for (const e of entries) {
              if (e.isIntersecting && e.boundingClientRect.height > 0) {
                editorRef.current?.refresh();
              }
            }
          });
          obs.observe(containerRef.current);
          visibilityObsRef.current = obs;
        }
        // Apply persisted toggles to the freshly-mounted view. Previously these
        // lived only in React state, so the buttons looked active but the
        // editor never actually wrapped or showed whitespace — fixed by going
        // through the Compartments exposed by `mountEditor`.
        editor.reconfigureWrap(wrap);
        editor.reconfigureWhitespace(renderWhitespace ? "all" : "trailing");

        if (typeof gotoLine === "number" && gotoLine > 0) {
          editor.revealLine(gotoLine);
        }
      } catch (e) {
        if (!disposed) {
          setEditorLoading(false);
          setError(errorMessage(e));
          pushStructured("ERROR", "editor", "mount failed", {
            path,
            error: errorMessage(e),
            stack: e instanceof Error ? e.stack : undefined,
            elapsedMs: Math.round(performance.now() - mountStart),
          });
        }
      }
    })();
    return () => {
      disposed = true;
      visibilityObsRef.current?.disconnect();
      visibilityObsRef.current = null;
      resizeObs?.disconnect();
      resizeObs = null;
      refreshTimers.forEach(clearTimeout);
      const hadEditor = !!editorRef.current;
      editorRef.current?.destroy();
      editorRef.current = null;
      pushStructured("DEBUG", "editor", "unmount", { path, hadEditor });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const toggleWrap = () => {
    setWrap((w) => {
      const next = !w;
      try {
        localStorage.setItem("luxor.editor.wordWrap", next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleWhitespace = () => {
    setRenderWhitespace((shown) => {
      const next = !shown;
      try {
        localStorage.setItem("luxor.editor.renderWhitespace", next ? "all" : "selection");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    editorRef.current?.reconfigureTheme(editorTheme, isLightTheme(theme));
  }, [theme, editorTheme]);

  // Drive the CodeMirror compartments from React state so the toolbar /
  // context-menu toggles actually update the live editor (not just the
  // localStorage flag). Safe to call before the editor is mounted — the
  // optional chaining no-ops, and the initial values are applied right
  // after `mountEditor` resolves above.
  useEffect(() => {
    editorRef.current?.reconfigureWrap(wrap);
  }, [wrap]);
  useEffect(() => {
    editorRef.current?.reconfigureWhitespace(renderWhitespace ? "all" : "trailing");
  }, [renderWhitespace]);

  // When the user switches a Markdown/HTML file from preview back to source,
  // the editor wrapper flips from `display:none` to visible. Re-measure so the
  // text layer renders (otherwise CM shows the gutter over a blank body until
  // the next interaction).
  useEffect(() => {
    if (!preview) requestAnimationFrame(() => editorRef.current?.refresh());
  }, [preview]);

  // Open a context menu at (x, y) without a real DOM event.
  const menuAt = (x: number, y: number, items: MenuItem[]) =>
    openContextMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }, items);

  const openLanguageMenu = (x: number, y: number) =>
    menuAt(
      x,
      y,
      EDITOR_LANGUAGE_OPTIONS.map((l) => ({
        label: l.label,
        swatch: l.id === lang ? "var(--lx-accent)" : undefined,
        onClick: () => changeLanguage(l.id),
      })),
    );

  const openThemeMenu = (x: number, y: number) =>
    menuAt(
      x,
      y,
      CODEMIRROR_THEMES.map((th) => ({
        label: th.label,
        swatch: th.id === editorTheme ? "var(--lx-accent)" : undefined,
        onClick: () => changeEditorTheme(th.id),
      })),
    );

  const openEditorMenu = (e: React.MouseEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    const items: MenuItem[] = [];
    if (previewable) {
      items.push({
        label: preview ? t("Edit source") : html ? t("Preview as a web page") : t("Preview rendered Markdown"),
        icon: preview ? Code2 : Eye,
        hint: "Ctrl+↵",
        onClick: () => (preview ? setPreview(false) : showPreview()),
      });
      items.push({ separator: true });
    }
    if (!preview) {
      const hasSelection = selectedText().length > 0;
      items.push({ label: t("Undo"), icon: Undo2, hint: "Ctrl+Z", disabled: truncated, onClick: doUndo });
      items.push({ label: t("Redo"), icon: Redo2, hint: "Ctrl+Y", disabled: truncated, onClick: doRedo });
      items.push({ separator: true });
      items.push({ label: t("Cut"), icon: Scissors, hint: "Ctrl+X", disabled: truncated || !hasSelection, onClick: cutSelection });
      items.push({ label: t("Copy"), icon: Copy, hint: "Ctrl+C", disabled: !hasSelection, onClick: copySelection });
      items.push({ label: t("Paste"), icon: ClipboardPaste, hint: "Ctrl+V", disabled: truncated, onClick: pasteClipboard });
      items.push({ label: t("Select all"), icon: CheckSquare, hint: "Ctrl+A", onClick: selectAllEditor });
      items.push({ separator: true });
    }
    if (!preview && !truncated) {
      items.push({ label: t("Save"), icon: Save, hint: "Ctrl+S", onClick: saveNow });
      items.push({ label: t("Find"), icon: Search, hint: "Ctrl+F", onClick: () => runEditorAction("actions.find") });
      items.push({ label: t("Replace"), icon: Replace, hint: "Ctrl+H", onClick: () => runEditorAction("editor.action.startFindReplaceAction") });
      items.push({ label: t("Format document"), icon: AlignLeft, hint: "⇧⌥F", onClick: doFormat });
      items.push({ label: t("Command palette"), icon: Keyboard, hint: "F1", onClick: () => runEditorAction("editor.action.quickCommand") });
      items.push({ label: t("Go to line"), icon: CornerDownLeft, hint: "Ctrl+G", onClick: goToLine });
      items.push({ separator: true });
      items.push({ label: `${t("Word wrap")}: ${wrap ? t("On") : t("Off")}`, icon: WrapText, hint: "Alt+Z", onClick: toggleWrap });
      items.push({ label: `${t("Show whitespace")}: ${renderWhitespace ? t("On") : t("Off")}`, icon: Pilcrow, onClick: toggleWhitespace });
      items.push({ label: t("Increase font size"), icon: ZoomIn, onClick: () => setEditorFontSize(fontSize + 1) });
      items.push({ label: t("Decrease font size"), icon: ZoomOut, onClick: () => setEditorFontSize(fontSize - 1) });
      items.push({ separator: true });
      items.push({ label: `${t("Syntax")}: ${languageLabel(lang)}`, icon: Type, onClick: () => openLanguageMenu(x, y) });
      items.push({ label: `${t("Editor theme")}: ${CODEMIRROR_THEMES.find((th) => th.id === editorTheme)?.label ?? editorTheme}`, icon: Palette, onClick: () => openThemeMenu(x, y) });
      items.push({ separator: true });
    }
    items.push({ label: t("Keyboard shortcuts"), icon: Keyboard, onClick: () => setShortcutsOpen((v) => !v) });
    openContextMenu(e, items);
  };

  if (error) {
    // Binary files get a read-only hex dump instead of a bare error message.
    if (error.includes("not a text file")) {
      return (
        <div className="flex h-full flex-col bg-surface">
          <div className="border-b border-edge/50 bg-raised px-3 py-1.5 text-xs text-muted">
            {t("Binary file — hex view (read-only)")}
          </div>
          <HexView path={path} />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
        {error}
      </div>
    );
  }

  return (
    <div className={`@container flex h-full flex-col bg-surface ${embedded ? "min-w-0" : ""}`}>
      {truncated && (
        <div className="border-b border-warning-soft-strong bg-warning-soft px-3 py-1 text-xs text-warning">
          {t("File is too large — opened read-only (truncated preview).")}
        </div>
      )}
      <div className="lx-editor-toolbar flex items-center gap-1 border-b border-edge/50 bg-surface px-2.5 py-1.5 text-xs text-muted">
        {/* Breadcrumbs */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {path.split("/").filter(Boolean).map((seg, i, arr) => (
            <span key={i} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={10} className="shrink-0 text-muted/50" />}
              <span
                className={`truncate ${i === arr.length - 1 ? "font-medium text-strong" : "text-muted hover:text-strong cursor-pointer"}`}
                title={seg}
                onClick={() => {
                  // Navigate to parent directory segments (best-effort)
                  if (i < arr.length - 1) {
                    const dirPath = arr.slice(0, i + 1).join("/");
                    void import("@/lib/ipc").then(({ isTauri }) => {
                      if (isTauri) {
                        void import("@tauri-apps/plugin-opener").then(({ openPath }) => openPath(dirPath));
                      }
                    });
                  }
                }}
              >
                {seg}
              </span>
            </span>
          ))}
        </div>
        {/* Autosave indicator */}
        {!preview && !truncated && autosaveStatus !== "idle" && (
          <span className="shrink-0 text-[10px] text-muted/70" data-testid="autosave-indicator">
            {autosaveStatus === "saving" && <span className="animate-pulse">{t("editor.autosaving", "Saving…")}</span>}
            {autosaveStatus === "saved" && <span className="text-success/80">{t("editor.autosaved", "Saved")}</span>}
          </span>
        )}
        {!preview && !truncated && (
          <span className="hidden shrink-0 items-center gap-1 font-mono text-[10px] text-muted/70 @sm:flex" title={t("Syntax highlighting language")}>
            <Type size={11} className="text-muted/60" />
            {languageLabel(lang)}
          </span>
        )}
        {previewable && (
          <button
            className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-raised ${preview ? "text-accent" : "text-muted hover:text-strong"}`}
            data-testid="md-toggle-top"
            title={preview ? t("Edit source") : html ? t("Preview as a web page") : t("Preview rendered Markdown")}
            onClick={() => (preview ? setPreview(false) : showPreview())}
          >
            {preview ? <Code2 size={13} /> : <Eye size={13} />}
            <span className="hidden @md:inline">{preview ? t("Source") : t("Preview")}</span>
          </button>
        )}
        <button
          className="flex items-center justify-center rounded-lg p-1.5 text-muted transition-colors hover:bg-raised hover:text-strong"
          title={t("Editor menu")}
          aria-label={t("Editor menu")}
          data-testid="editor-menu"
          onClick={openEditorMenu}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {shortcutsOpen && (
        <div className="grid grid-cols-2 gap-1 border-b border-edge bg-raised/45 px-3 py-2 text-[11px] text-muted @md:grid-cols-4">
          <span><b className="text-strong">Ctrl+S</b> save</span>
          <span><b className="text-strong">Ctrl+F / Ctrl+H</b> find/replace</span>
          <span><b className="text-strong">Ctrl+/</b> comment</span>
          <span><b className="text-strong">Alt+Z</b> wrap</span>
          <span><b className="text-strong">Ctrl+G</b> go to line</span>
          <span><b className="text-strong">Shift+Alt+F</b> format</span>
          <span><b className="text-strong">F2</b> rename</span>
          <span><b className="text-strong">Ctrl+Enter</b> preview/source</span>
        </div>
      )}
      <div className={`relative min-h-0 flex-1 ${previewable && preview ? "hidden" : ""}`} onContextMenu={openEditorMenu}>
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden"
          // Only the font SIZE is set on the container (both the gutter and the
          // text inherit it, so their metrics stay in sync). The line-height is
          // owned entirely by the CodeMirror theme — setting a px line-height
          // here leaked into the gutter only and pulled the line numbers out of
          // alignment with their text rows.
          style={{ fontSize: `${fontSize}px` }}
        />
        {editorLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-surface text-xs text-muted lx-fade-in">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-edge border-t-accent" />
            {t("editor.loading", "Loading editor…")}
          </div>
        )}
      </div>
      {html && preview && (
        <iframe
          key={`${path}:${previewSrc ?? "srcdoc"}:${dirty ? "dirty" : "saved"}:${previewReloadKey}`}
          // SECURITY: never combine allow-scripts with allow-same-origin here.
          // A srcDoc iframe inherits the app's tauri.localhost origin, so that
          // pair would let any previewed HTML file's scripts reach the Tauri
          // IPC bridge (read arbitrary files, write inside project roots) —
          // the exact webview-XSS threat model PathGuard defends against.
          // Without allow-same-origin the preview runs in an opaque origin:
          // scripts still execute, but they cannot touch the parent app.
          sandbox="allow-scripts allow-modals allow-popups allow-forms"
          src={!dirty && previewSrc ? previewSrc : undefined}
          srcDoc={!dirty && previewSrc ? undefined : previewHtml}
          title={path}
          data-testid="html-preview"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
      {markdown && preview && (
        <div
          className="lx-markdown min-h-0 flex-1 overflow-auto px-6 py-4"
          data-testid="md-preview"
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest("a");
            if (!a?.href) return;
            e.preventDefault();
            const href = a.href;
            // tauri.localhost asset URLs → open the file in the editor/viewer
            // e.g. http://tauri.localhost/Assets/Scripts/Foo.cs
            const tauriAsset = href.match(/^https?:\/\/(?:asset\.localhost|tauri\.localhost)\/(.+)$/i);
            if (tauriAsset) {
              // Decode the path and prefix with the project separator
              const rel = decodeURIComponent(tauriAsset[1]);
              // Try to resolve against the current file's directory
              const currentDir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : path.includes("\\") ? path.substring(0, path.lastIndexOf("\\")) : "";
              const resolved = currentDir ? `${currentDir}/${rel}` : rel;
              import("@/layout/dockStore").then(({ useDockStore }) => {
                useDockStore.getState().openFile(resolved);
              });
              return;
            }
            // Relative or local file links (no scheme or file://)
            if (!href.startsWith("http://") && !href.startsWith("https://")) {
              const rel = decodeURIComponent(href.replace(/^file:\/\//, ""));
              const currentDir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
              const resolved = currentDir ? `${currentDir}/${rel}` : rel;
              import("@/layout/dockStore").then(({ useDockStore }) => {
                useDockStore.getState().openFile(resolved);
              });
              return;
            }
            // External https links → open in system browser
            if (/^https?:/i.test(href)) {
              if (ipc.isTauri) {
                void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href));
              } else {
                window.open(href, "_blank", "noopener");
              }
            }
          }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      )}
      <div className="lx-editor-statusbar flex items-center justify-between gap-2 border-t border-edge px-3 py-[3px] text-[11px] text-muted">
        <span className="min-w-0 truncate" title={path}>
          {path}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {previewable && (
            <button
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised ${
                preview ? "text-accent" : "hover:text-strong"
              }`}
              data-testid="md-toggle"
              title={preview ? t("Edit source") : html ? t("Preview as a web page") : t("Preview rendered Markdown")}
              onClick={() => (preview ? setPreview(false) : showPreview())}
            >
              {preview ? <Code2 size={12} /> : <Eye size={12} />}
              {preview ? t("Source") : t("Preview")}
            </button>
          )}
          {!preview && !truncated && (
            <>
              <button
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong"
                title={t("Undo (Ctrl+Z)")}
                onClick={doUndo}
              >
                <Undo2 size={12} />
              </button>
              <button
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong"
                title={t("Redo (Ctrl+Y)")}
                onClick={doRedo}
              >
                <Redo2 size={12} />
              </button>
              <button
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong"
                title={t("Format document (Shift+Alt+F)")}
                onClick={doFormat}
              >
                <AlignLeft size={12} />
                {t("Format")}
              </button>
            </>
          )}
          {!preview && (
            <button
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised ${
                wrap ? "text-accent" : "hover:text-strong"
              }`}
              title={t("Toggle word wrap (Alt+Z)")}
              onClick={toggleWrap}
            >
              <WrapText size={12} />
              {t("Wrap")}
            </button>
          )}
          {!preview && (
            <button
              className="rounded px-1.5 py-0.5 tabular-nums hover:bg-raised hover:text-strong"
              title={t("Go to line (Ctrl+G)")}
              onClick={goToLine}
            >
              {cursorLabel(cursor.line, cursor.col)}
              {selectionLabel(sel.chars, sel.ranges)}
            </button>
          )}
          {!preview && <span title={t("Language")}>{langLabel(lang)}</span>}
          {!preview && (
            <span className="opacity-70">
              {dirtyRef.current ? t("Ctrl+S to save") : lastSaved ? `${t("editor.saved_at", "Saved")} ${new Date(lastSaved).toLocaleTimeString()}` : t("Ctrl+S to save")}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function EditorPanel(props: IDockviewPanelProps) {
  const params = props.params as { path: string; gotoLine?: number };
  return (
    <FileEditorSurface
      path={params.path}
      gotoLine={params.gotoLine}
      panelId={props.api.id}
      setPanelTitle={(title) => props.api.setTitle(title)}
    />
  );
}

