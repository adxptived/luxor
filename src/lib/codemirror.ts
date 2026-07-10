/**
 * Lazy CodeMirror 6 loader. The editor (and its language/theme/keymap
 * extensions) are only pulled in when an editor panel is first mounted,
 * keeping app startup fast.
 *
 * Public surface:
 *   - getCodeMirror()        – returns the already-resolved `@codemirror/view`
 *                              module (kept for tests/benchmarks).
 *   - languageExtensionForId – maps an editor language id to a CM
 *                              language Extension (async, returns a Promise).
 *   - mountEditor            – convenience that creates the view on a DOM
 *                              node and returns a small handle with
 *                              view, destroy, reconfigureLang, etc.
 *
 * Everything is side-effect free until `getCodeMirror()` (and therefore
 * `mountEditor()`) is first called.
 */

import type { Extension } from "@codemirror/state";
import { EditorState, Compartment } from "@codemirror/state";
import * as codeMirrorView from "@codemirror/view";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  highlightTrailingWhitespace,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";

import { resolveLanguageExtension } from "./codemirrorLanguages";
import { buildEditorTheme } from "./codemirrorThemes";
import { pushStructured } from "./logBuffer";

type CmModule = typeof codeMirrorView;

// CodeMirror is bundled into this lazily-loaded module through the static
// imports above, so it is already resolved by the time `mountEditor` runs. We
// return a resolved Promise (instead of a fresh `import()`) so the editor never
// pulls a *second* copy of `@codemirror/view` / `@codemirror/state` into the
// page. Duplicate module instances break CodeMirror's `instanceof` checks and
// throw "Unrecognized extension value ([object Promise]) … multiple instances
// of @codemirror/state" the moment a file is opened.
export function getCodeMirror(): Promise<CmModule> {
  return Promise.resolve(codeMirrorView);
}

/**
 * Async language extension lookup. Always returns a real `Extension` (or
 * `[]` for unknown ids) once the Promise resolves — never a Promise
 * itself, since CodeMirror's `ExtensionSet` does not accept Promises.
 */
export function languageExtensionForId(id: string): Promise<Extension> {
  return resolveLanguageExtension(id);
}

export interface EditorOptions {
  doc: string;
  languageId: string;
  themeId: string;
  isLightTheme: boolean;
  onSave: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoToLine: () => void;
  onFormat: () => void;
  onComment: () => void;
  onToggleWrap: () => void;
  onSelectionChange?: (cursor: { line: number; col: number }, sel: { chars: number; ranges: number }) => void;
  /** Fired whenever the editor transitions between clean and dirty (unsaved
   *  changes). The EditorPanel uses this to update the tab title dot, the
   *  dirty-guard, and the editor-bus isDirty flag. */
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
}

export interface MountedEditor {
  view: import("@codemirror/view").EditorView;
  destroy(): void;
  reconfigureLang(id: string): Promise<void>;
  reconfigureTheme(themeId: string, isLight: boolean): void;
  /** Toggle soft line wrapping. Reconfigures a Compartment so it can flip
   *  on/off without rebuilding the whole editor state. */
  reconfigureWrap(enabled: boolean): void;
  /** Toggle visible whitespace dots/markers. "trailing" only flags trailing
   *  spaces, "all" highlights every whitespace char. */
  reconfigureWhitespace(mode: "off" | "trailing" | "all"): void;
  revealLine(line: number): void;
  /** Force CodeMirror to re-measure its viewport. CM only lays out the visible
   *  range, computed from the scroller's geometry. When the editor is mounted
   *  (or lives) inside a `display:none` / zero-size container — e.g. the
   *  Markdown *preview* wrapper, or an inactive dockview tab — that geometry is
   *  0, so the gutter (cheap, line-count based) paints but the text layer stays
   *  blank. Chromium's ResizeObserver usually re-measures on show, but Tauri's
   *  WebView2 / WKWebView frequently do not — leaving "line numbers but no
   *  text". Calling this when the container becomes visible fixes that. */
  refresh(): void;
  isDirty(): boolean;
  getValue(): string;
  setValue(value: string): void;
}

export async function mountEditor(
  parent: HTMLElement,
  opts: EditorOptions,
): Promise<MountedEditor> {
  const t0 = performance.now();
  pushStructured("DEBUG", "editor", "mountEditor called", {
    parentW: parent.getBoundingClientRect().width,
    parentH: parent.getBoundingClientRect().height,
    parentOffsetW: parent.offsetWidth,
    parentOffsetH: parent.offsetHeight,
    docLen: opts.doc.length,
    docLines: opts.doc.split("\n").length,
    languageId: opts.languageId,
    themeId: opts.themeId,
    readOnly: opts.readOnly ?? false,
  });

  const langCompartment: Compartment = new Compartment();
  const themeCompartment: Compartment = new Compartment();
  // Word-wrap and whitespace visibility are user toggles that flip without
  // rebuilding the whole editor. Keeping them in Compartments means
  // `view.dispatch({ effects: ... })` is enough — no new EditorState, no
  // lost undo history, no cursor jump. (Earlier versions tracked these as
  // React state only, so the buttons updated their colour but the editor
  // never actually wrapped lines — fixed here.)
  const wrapCompartment: Compartment = new Compartment();
  const whitespaceCompartment: Compartment = new Compartment();
  // Resolve the language *before* constructing the state — CodeMirror's
  // `ExtensionSet` does not accept a Promise.
  const langStart = performance.now();
  const initialLang = (await resolveLanguageExtension(opts.languageId)) ?? [];
  const langMs = Math.round(performance.now() - langStart);
  pushStructured("DEBUG", "editor", "language resolved", { id: opts.languageId, ms: langMs, extCount: Array.isArray(initialLang) ? initialLang.length : 1 });

  const initialTheme = buildEditorTheme(opts.themeId, opts.isLightTheme);
  let lastDoc = opts.doc;
  let dirty = false;
  let lastDirty = false;
  const viewStart = performance.now();
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        highlightSelectionMatches(),
        drawSelection(),
        history(),
        // IDE-grade editing: auto-reindent on input, match/close brackets,
        // fold code blocks, and offer completions from the open document and
        // the active language grammar. All language-aware features key off the
        // grammar in `langCompartment`, so they light up the moment a language
        // pack resolves.
        indentOnInput(),
        indentUnit.of("  "),
        bracketMatching(),
        closeBrackets(),
        codeFolding(),
        foldGutter(),
        autocompletion(),
        keymap.of([
          { key: "Mod-s", run: () => { opts.onSave(); return true; } },
          { key: "Mod-f", run: () => { opts.onFind(); return true; } },
          { key: "Mod-h", run: () => { opts.onReplace(); return true; } },
          { key: "Mod-g", run: () => { opts.onGoToLine(); return true; } },
          { key: "Shift-Alt-f", run: () => { opts.onFormat(); return true; } },
          // Toggle line/block comment using the active language's comment
          // tokens (provided by the language pack in `langCompartment`). CM's
          // `toggleComment` IS native — the earlier "no native comment" note
          // was wrong. We still notify `onComment` so the panel can react.
          { key: "Mod-/", run: (v) => { opts.onComment(); return toggleComment(v); } },
          { key: "Alt-z", run: () => { opts.onToggleWrap(); return true; } },
          indentWithTab,
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        langCompartment.of(initialLang),
        themeCompartment.of(initialTheme),
        // Default OFF — the EditorPanel calls `reconfigureWrap` from its
        // `useEffect` right after mount with the user's saved preference.
        wrapCompartment.of([]),
        whitespaceCompartment.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            dirty = u.state.doc.toString() !== lastDoc;
            if (dirty !== lastDirty) { lastDirty = dirty; opts.onDirtyChange?.(dirty); }
          }
          if (u.selectionSet || u.docChanged) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            const cursor = { line: line.number, col: pos - line.from + 1 };
            let chars = 0;
            let ranges = 0;
            for (const r of u.state.selection.ranges) {
              const text = u.state.sliceDoc(r.from, r.to);
              if (text.length > 0) {
                chars += text.length;
                ranges += 1;
              }
            }
            opts.onSelectionChange?.(cursor, { chars, ranges });
          }
        }),
        ...(opts.readOnly ? [EditorState.readOnly.of(true)] : []),
      ],
    }),
    parent,
  });
  const viewMs = Math.round(performance.now() - viewStart);
  const totalMs = Math.round(performance.now() - t0);

  // Inspect the DOM that CodeMirror just created
  const cmEditor = parent.querySelector(".cm-editor");
  const cmScroller = parent.querySelector(".cm-scroller");
  const cmContent = parent.querySelector(".cm-content");
  const cmGutters = parent.querySelector(".cm-gutters");
  pushStructured("DEBUG", "editor", "EditorView created", {
    id: opts.languageId,
    viewMs,
    langMs,
    totalMs,
    cmEditorExists: !!cmEditor,
    cmScrollerExists: !!cmScroller,
    cmContentExists: !!cmContent,
    cmGuttersExists: !!cmGutters,
    cmEditorH: cmEditor?.getBoundingClientRect().height ?? -1,
    cmEditorW: cmEditor?.getBoundingClientRect().width ?? -1,
    cmScrollerH: cmScroller?.getBoundingClientRect().height ?? -1,
    cmScrollerW: cmScroller?.getBoundingClientRect().width ?? -1,
    cmScrollerOverflow: cmScroller ? getComputedStyle(cmScroller).overflow : "null",
    cmScrollerFlex: cmScroller ? getComputedStyle(cmScroller).flex : "null",
    cmContentH: cmContent?.scrollHeight ?? -1,
    cmContentW: cmContent?.scrollWidth ?? -1,
    cmContentChildren: cmContent?.childElementCount ?? -1,
    cmGuttersW: cmGutters?.getBoundingClientRect().width ?? -1,
    parentH: parent.getBoundingClientRect().height,
    parentW: parent.getBoundingClientRect().width,
  });

  // ResizeObserver inside mountEditor: re-measure whenever the parent resizes.
  let resizeObs: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => {
      view.requestMeasure();
    });
    resizeObs.observe(parent);
  }

  return {
    view,
    destroy() {
      resizeObs?.disconnect();
      resizeObs = null;
      view.destroy();
    },
    async reconfigureLang(id) {
      const ext = await resolveLanguageExtension(id);
      view.dispatch({ effects: langCompartment.reconfigure(ext) });
    },
    reconfigureTheme(themeId, isLight) {
      view.dispatch({ effects: themeCompartment.reconfigure(buildEditorTheme(themeId, isLight)) });
    },
    reconfigureWrap(enabled) {
      view.dispatch({
        effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },
    reconfigureWhitespace(mode) {
      const ext: Extension =
        mode === "all" ? highlightWhitespace() : mode === "trailing" ? highlightTrailingWhitespace() : [];
      view.dispatch({ effects: whitespaceCompartment.reconfigure(ext) });
    },
    revealLine(line) {
      const n = Math.min(Math.max(1, line), view.state.doc.lines);
      const pos = view.state.doc.line(n).from;
      view.dispatch({
        selection: { anchor: pos, head: pos },
        effects: EditorView.scrollIntoView(pos),
      });
      view.focus();
    },
    refresh() {
      const cmContent = view.dom.querySelector(".cm-content");
      const cmScroller = view.dom.querySelector(".cm-scroller");
      pushStructured("DEBUG", "editor", "refresh() called", {
        cmContentH: cmContent?.scrollHeight ?? -1,
        cmScrollerH: cmScroller?.getBoundingClientRect().height ?? -1,
        cmScrollerW: cmScroller?.getBoundingClientRect().width ?? -1,
        viewH: view.dom.getBoundingClientRect().height,
        viewW: view.dom.getBoundingClientRect().width,
      });
      view.requestMeasure();
    },
    isDirty() { return dirty; },
    getValue() { return view.state.doc.toString(); },
    setValue(value) {
      lastDoc = value;
      dirty = false;
      lastDirty = false;
      opts.onDirtyChange?.(false);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
  };
}
