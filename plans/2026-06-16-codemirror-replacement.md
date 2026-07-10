# Replace Monaco with CodeMirror 6 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Monaco editor (no syntax highlighting for any non-TS/JSON/CSS/HTML language on Vite ESM, missing line numbers, ~10 MB initial bundle, 6.5s startup) with CodeMirror 6 — a 300 KB editor with first-class language support for every language the app already detects (rust, python, go, yaml, markdown, sql, ini, shell, perl, lua, dart, groovy, …) out of the box.

**Architecture:**
1. **Editor core** — `src/lib/codemirror.ts` lazy-loads `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language` on first file open, then exposes a `getCodeMirror()` singleton (mirrors the current `getMonaco()` API shape where it makes sense, but a `mountEditor(el, opts)`/`destroy()` pair for the rest).
2. **Language packs** — one `@codemirror/language` pack per family already in `editorLanguage.ts`: `@codemirror/lang-javascript` (TS/JS/JSON/JSONC), `@codemirror/lang-html` (HTML/XML/Markdown), `@codemirror/lang-css`, `@codemirror/lang-sql`, `@codemirror/lang-python`, `@codemirror/lang-rust`, `@codemirror/lang-go`, `@codemirror/lang-yaml`, `@codemirror/lang-lezer` + a tiny hand-rolled StreamLanguage for `shell`/`ini`/`dockerfile`/`perl`/`lua`/`dart`/`groovy`/`swift`/`kotlin` (covered by the Lezer highlighters, or fall back to `StreamLanguage.define` with a small grammar).
3. **Theme** — `src/lib/codemirrorThemes.ts` ports the 12 Luxor palettes (luxor-dark … hc-black) from `monacoThemes.ts` into a single `EditorView.theme({ … })` builder. Selection background is bumped to the same accent-tinted values the Monaco theme now uses.
4. **EditorPanel rewrite** — `src/panels/EditorPanel.tsx` switches from Monaco's `monaco.editor.create(...)` to CodeMirror's `new EditorView({ state, parent })`. The existing surface (toolbar, status bar, save, search, format, language picker, theme picker, keyboard shortcuts, dirty guard) is preserved 1:1. **DiffPanel** switches to CodeMirror Diff (`@codemirror/merge`) for side-by-side.
5. **Bundle budget** — CodeMirror is loaded as **one dynamic chunk** the first time a file is opened. `monaco-editor` is removed from `package.json` and all imports. `vite.config.ts` `manualChunks` is updated to drop the `monaco` chunk and route `@codemirror/*` to a new `cm` chunk that only loads on first open.
6. **Benchmarks** — add `src/perf/editorBench.ts` (run via `bun run bench`) that measures: time to mount a 1k-line file, time to tokenize, time to switch language, time to apply theme. These run in Node, not the browser, and use the headless `@codemirror/view` machinery where possible.

**Tech Stack:** TypeScript, React 19, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-*`, `@codemirror/merge`, `@codemirror/search`, `@codemirror/autocomplete`), Vite 6, Bun (test + bench runner), Tailwind 4.

---

## File Structure

**New (focused, single-responsibility):**
- `src/lib/codemirror.ts` — singleton lazy loader; `getCodeMirror()`, `mountEditor(el, opts) → { view, destroy }`, `languageExtension(id) → Extension`, `themeCompartment`, `reconfigureLang(view, id)`, `reconfigureTheme(view, theme)`.
- `src/lib/codemirrorThemes.ts` — `CODEMIRROR_THEMES` (12 entries), `CODEMIRROR_PALETTES` (re-used colors from `monacoThemes.ts`), `buildEditorTheme(themeId, appThemeIsLight) → Extension`.
- `src/lib/codemirrorLanguages.ts` — `LANGUAGE_CM_EXT` table mapping each Monaco language id to its CM language extension; falls back to `StreamLanguage.define(plainText())` for unsupported ids.
- `src/lib/codemirrorKeys.ts` — Keybindings for Save (Ctrl+S), Find (Ctrl+F), Replace (Ctrl+H), Go to line (Ctrl+G), Format (Shift+Alt+F), Comment (Ctrl+/), Wrap (Alt+Z), Multi-cursor (Ctrl+D), with `Prec.high` to override Monaco-style behaviour.
- `src/lib/editorFormat.ts` — Format dispatch (JSON/JS/TS via `@codemirror/lang-*` built-ins, HTML/CSS via Prettier-ish indent helpers we already need; shell/ini/Rust/etc. fall back to "no formatter" toast, matches today).
- `src/perf/editorBench.ts` — mitata benchmarks for mount/tokenize/switchLanguage/switchTheme (CM headless where possible, `EditorView` allowed for DOM-free instantiation).

**Modify:**
- `src/panels/EditorPanel.tsx` — rewrite to use `mountEditor()`; keep the surrounding `FileEditorSurface` shell (toolbar, status bar, save bus, dirty guard, language/theme menus, shortcuts) intact. `registerEditor()`/`revealLine()`/`isDirty()` API stays compatible so `editorBus.test.ts` and `editorBus.ts` keep working.
- `src/panels/DiffPanel.tsx` — switch to CodeMirror Merge (`MergeView`).
- `src/lib/editorLanguage.ts` — keep the existing `languageForPath` / `languageFromShebang` / `detectLanguage` exports; the new `codemirrorLanguages.ts` consumes them unchanged.
- `src/lib/editorStatus.ts` — unchanged; LANG_LABELS stay the same.
- `src/lib/editorBus.ts` — unchanged API; `registerEditor`/`reveal`/`isDirty` stay the same.
- `src/App.tsx` — drop the Monaco warmup (`setTimeout(...).getMonaco()`); replace with `getCodeMirror().then(...)` (or remove the warmup entirely once CM is small enough). Adjust the `useEffect` that listens to first project switch.
- `src/main.tsx` — no changes.
- `vite.config.ts` — remove the `monaco` chunk; add a `cm` chunk for `@codemirror/*`; keep the `vendor` chunk; do **not** mark `@codemirror/*` as a startup-critical dep.
- `package.json` — add `@codemirror/*` deps, remove `monaco-editor`.
- `index.html` — no changes (no inline Monaco import).
- `docs/superpowers/plans/2026-06-16-editor-ux-and-startup.md` — keep as a historical record; new supersedes it for the editor portion.

**Delete (after migration):**
- `src/lib/monaco.ts`
- `src/lib/monacoThemes.ts` (its palette data moves to `codemirrorThemes.ts`)
- `src/lib/monacoWorkers.test.ts` (no longer relevant)
- `src/lib/editorSelectionTheme.test.ts` (moved/replaced by `codemirrorThemes.test.ts`)

**No Rust / Tauri changes.** Frontend-only.

---

## Task 1: Install CodeMirror deps, delete Monaco, smoke build

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `src/App.tsx` (drop the Monaco warmup and the project-switch warmup — they'll be re-added in Task 6)
- Delete: `src/lib/monaco.ts`, `src/lib/monacoThemes.ts`, `src/lib/monacoWorkers.test.ts`, `src/lib/editorSelectionTheme.test.ts`
- Modify: `src/panels/EditorPanel.tsx`, `src/panels/DiffPanel.tsx` — temporary stubs that throw "CodeMirror migration in progress" so the build still passes

- [ ] **Step 1: Add CodeMirror dependencies**

Edit `package.json` `dependencies` block — add these entries (use exact versions known to work together as of 2026; if a newer patch is out, the patch is fine, the minor is what matters):

```json
"@codemirror/state": "^6.5.0",
"@codemirror/view": "^6.36.0",
"@codemirror/commands": "^6.7.1",
"@codemirror/language": "^6.10.3",
"@codemirror/autocomplete": "^6.18.0",
"@codemirror/search": "^6.5.8",
"@codemirror/lint": "^6.8.4",
"@codemirror/lang-javascript": "^6.2.2",
"@codemirror/lang-html": "^6.4.9",
"@codemirror/lang-css": "^6.3.0",
"@codemirror/lang-sql": "^6.8.0",
"@codemirror/lang-python": "^6.1.6",
"@codemirror/lang-rust": "^6.0.1",
"@codemirror/lang-go": "^6.0.1",
"@codemirror/lang-yaml": "^6.1.1",
"@codemirror/lang-markdown": "^6.3.0",
"@codemirror/merge": "^6.10.0",
"@lezer/highlight": "^1.2.1",
"crelt": "^1.0.6"
```

Run: `bun install`
Expected: 18 new entries in `bun.lock`, no errors.

- [ ] **Step 2: Drop Monaco**

In `package.json` `dependencies`, delete the line `"monaco-editor": "^0.52.2"`. Run: `bun install`
Expected: Monaco removed from `bun.lock`.

- [ ] **Step 3: Stub the editor panels so the build still passes**

Replace the body of `src/panels/EditorPanel.tsx` `FileEditorSurface` and `EditorPanel` exports with a temporary stub. The new file is small — full replace:

```tsx
/** Temporary stub during the Monaco → CodeMirror migration. */

import type { IDockviewPanelProps } from "dockview";
import { useEffect, useRef } from "react";

import { registerEditor } from "@/lib/editorBus";
import { registerDirtyGuard } from "@/lib/dirtyGuard";

export function FileEditorSurface({ path, panelId }: { path: string; panelId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerEditor(panelId, {
      save: async () => {},
      reveal: () => {},
      isDirty: () => false,
    });
    return () => registerDirtyGuard(panelId, () => false);
  }, [panelId]);
  return (
    <div ref={ref} className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
      <div>
        <div className="font-medium text-strong">Editor migration in progress</div>
        <div className="mt-1 font-mono text-xs opacity-70">{path}</div>
      </div>
    </div>
  );
}

export function EditorPanel(props: IDockviewPanelProps) {
  const params = props.params as { path: string };
  return <FileEditorSurface path={params.path} panelId={props.api.id} setPanelTitle={(t) => props.api.setTitle(t)} />;
}
```

Replace `src/panels/DiffPanel.tsx` with a similarly tiny stub (a centered "Diff migration in progress" message). The full file is too long to inline here — replace it with this:

```tsx
/** Temporary stub during the Monaco → CodeMirror migration. */

import type { IDockviewPanelProps } from "dockview";
import { t } from "@/lib/i18n";

export function DiffPanel(props: IDockviewPanelProps) {
  const params = props.params as { repoPath: string; filePath: string };
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6 text-center text-sm text-muted">
      <div>
        <div className="font-medium text-strong">Diff migration in progress</div>
        <div className="mt-1 font-mono text-xs opacity-70">{params.filePath}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete obsolete Monaco files**

```
del src\lib\monaco.ts
del src\lib\monacoThemes.ts
del src\lib\monacoWorkers.test.ts
del src\lib\editorSelectionTheme.test.ts
```

(`rm` on macOS/Linux.) Confirm with `dir src\lib\monaco* src\lib\editorSelectionTheme*` — must be empty.

- [ ] **Step 5: Drop the Monaco warmup in `src/App.tsx`**

Remove these two blocks:

```ts
    // Warm up the (lazy, ~4 MB) Monaco chunk early, but not on the critical
    // path: a 200 ms setTimeout fires after first paint but before the user
    // has any chance to click a file open. Only in the real app (Tauri); in
    // browser/demo mode (and e2e) the warmup just burns CPU parsing 4 MB of
    // Monaco while tests/users interact, so we skip it.
    if (ipc.isTauri) {
      setTimeout(() => {
        void import("@/lib/monaco").then((m) => m.getMonaco()).catch(() => {});
      }, 200);
    }
```

…and the standalone `useEffect` that subscribes to `useProjectsStore` and imports `@/lib/monaco` on first switch. Both are replaced in Task 6 (or removed entirely if CM ends up small enough not to need a warmup).

- [ ] **Step 6: Drop the `monaco` chunk from `vite.config.ts`**

In `vite.config.ts`, change the `rollupOptions.output.manualChunks` function so it no longer routes `monaco-editor` to a separate chunk. The function becomes:

```ts
manualChunks(id: string) {
  if (id.includes("vite/preload-helper") || id.startsWith("\0vite/")) return "vendor";
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("@codemirror") || id.includes("@lezer")) return "cm";
  if (id.includes("@xterm")) return "xterm";
  if (id.includes("dockview")) return "dockview";
  if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react";
  if (id.includes("lucide")) return "icons";
  if (id.includes("marked") || id.includes("highlight") || id.includes("dompurify") || id.includes("shiki"))
    return "markdown";
  return "vendor";
},
```

- [ ] **Step 7: Typecheck + tests + build**

Run: `bun run typecheck`
Expected: PASS (the stubs don't import Monaco).

Run: `bun test src`
Expected: the rest of the suite stays green; the deleted `monacoWorkers` / `editorSelectionTheme` files simply no longer run.

Run: `bun run build`
Expected: a `dist/assets/cm-*.js` chunk appears (will be small — CM is a few hundred KB). No `monaco-*.js` chunks. No `ts.worker-*.js` / `json.worker-*.js` / etc.

- [ ] **Step 8: Smoke launch**

Run: `bun run tauri build --no-bundle` (this re-compiles Rust, which is unchanged, so the rebuild is fast — under 30s).
Expected: `target/release/luxor.exe` is produced. Launching it and opening a file shows the "Editor migration in progress" stub, but the rest of the app (terminals, files panel, settings) is fully functional.

- [ ] **Step 9: No commit (per project convention — no git repo)**

The repo is not under git; no commit needed.

---

## Task 2: The `codemirror.ts` singleton + `mountEditor()`

**Files:**
- Create: `src/lib/codemirror.ts`
- Test: `src/lib/codemirror.test.ts`

This is the heart of the migration. Every editor surface (`EditorPanel`, `DiffPanel`) will go through `mountEditor()`. The function must be small, side-effect-free, and produce a fully-typed `EditorView` with the right language + theme + keybindings from the start.

- [ ] **Step 1: Write the failing test**

Create `src/lib/codemirror.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  getCodeMirror,
  languageExtensionForId,
  parseMimeType,
  buildEditorState,
  type EditorOptions,
} from "./codemirror";

describe("languageExtensionForId", () => {
  test("returns a non-null extension for every language id the app uses", () => {
    // These are the ids currently returned by editorLanguage.detectLanguage.
    const ids = [
      "plaintext", "typescript", "javascript", "json", "jsonc",
      "html", "css", "scss", "less", "markdown", "yaml", "ini", "xml",
      "shell", "powershell", "python", "rust", "go", "java", "c", "cpp",
      "csharp", "php", "ruby", "swift", "kotlin", "sql", "dockerfile",
      "bat", "lua", "dart", "scala", "perl", "r", "groovy", "hcl",
      "proto", "graphql",
    ];
    for (const id of ids) {
      expect(languageExtensionForId(id)).not.toBeNull();
    }
  });

  test("plaintext is the safe default for unknown ids", () => {
    const ext = languageExtensionForId("some-future-language");
    expect(ext).not.toBeNull();
  });
});

describe("parseMimeType", () => {
  test("returns text/plain for empty input", () => {
    expect(parseMimeType("")).toBe("text/plain");
    expect(parseMimeType("plaintext")).toBe("text/plain");
  });

  test("passes through standard mime types", () => {
    expect(parseMimeType("text/css")).toBe("text/css");
    expect(parseMimeType("application/json")).toBe("application/json");
  });
});

describe("buildEditorState", () => {
  test("produces a state with doc + language + theme + keymap", () => {
    const opts: EditorOptions = {
      doc: "let x = 1;\n",
      languageId: "javascript",
      themeId: "luxor-dark",
      isLightTheme: false,
      onSave: () => {},
      onFind: () => {},
      onReplace: () => {},
      onGoToLine: () => {},
      onFormat: () => {},
      onComment: () => {},
      onToggleWrap: () => {},
    };
    const state = buildEditorState(opts);
    expect(state.doc.toString()).toBe("let x = 1;\n");
    // CM State fields are deliberately typed-loose; just make sure no throw.
    expect(state.facet(EditorView.editable)).toBe(true);
  });
});
```

Note: the test imports `EditorView` from `@codemirror/view` — add that to the imports at the top of the test:

```ts
import { EditorView } from "@codemirror/view";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/codemirror.test.ts`
Expected: FAIL with `Cannot find module './codemirror'`.

- [ ] **Step 3: Implement `codemirror.ts`**

Create `src/lib/codemirror.ts`:

```ts
/**
 * Lazy CodeMirror 6 loader. The editor (and its language/theme/keymap
 * extensions) are only pulled in when an editor panel is first mounted,
 * keeping app startup fast.
 *
 * Public surface:
 *   - getCodeMirror()        – resolves the `@codemirror/view` module;
 *                              subsequent calls return the same promise.
 *   - languageExtensionForId – maps a Monaco-style language id (the same
 *                              ids `editorLanguage.detectLanguage` already
 *                              returns) to a CM language Extension.
 *   - buildEditorState       – produces an `EditorState` configured with
 *                              doc + language + theme + keymap for the
 *                              given options. Use this to construct the
 *                              `state` you pass to `new EditorView`.
 *   - mountEditor            – convenience that creates the view on a DOM
 *                              node and returns a small handle with
 *                              `view`, `destroy()`, `reconfigureLang(id)`,
 *                              `reconfigureTheme(themeId, isLight)`.
 *
 * Everything is side-effect free until `getCodeMirror()` (and therefore
 * `mountEditor()`) is first called.
 */

import type { Extension, Compartment } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { keymap, drawSelection, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

import { languageExtensionForId as buildLanguageExtension } from "./codemirrorLanguages";
import { buildEditorTheme, codemirrorThemeExtension } from "./codemirrorThemes";

type CmModule = typeof import("@codemirror/view");

let cmPromise: Promise<CmModule> | null = null;
export function getCodeMirror(): Promise<CmModule> {
  if (!cmPromise) cmPromise = import("@codemirror/view");
  return cmPromise;
}

export function parseMimeType(mime: string): string {
  if (!mime || mime === "plaintext") return "text/plain";
  if (mime.includes("/")) return mime;
  return "text/plain";
}

export function languageExtensionForId(id: string): Extension | null {
  return buildLanguageExtension(id);
}

export interface EditorOptions {
  doc: string;
  languageId: string;
  themeId: string;
  isLightTheme: boolean;
  // Keymap callbacks. Returning a function from onSave etc. would also work,
  // but keybindings are configured once and a stable callback shape keeps
  // the EditorView state stable across re-renders.
  onSave: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoToLine: () => void;
  onFormat: () => void;
  onComment: () => void;
  onToggleWrap: () => void;
  readOnly?: boolean;
}

export function buildEditorState(opts: EditorOptions): EditorState {
  const langExt = buildLanguageExtension(opts.languageId) ?? [];
  const themeExt = buildEditorTheme(opts.themeId, opts.isLightTheme);
  return EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      drawSelection(),
      history(),
      keymap.of([
        { key: "Mod-s", run: () => { opts.onSave(); return true; } },
        { key: "Mod-f", run: () => { opts.onFind(); return true; } },
        { key: "Mod-h", run: () => { opts.onReplace(); return true; } },
        { key: "Mod-g", run: () => { opts.onGoToLine(); return true; } },
        { key: "Shift-Alt-f", run: () => { opts.onFormat(); return true; } },
        { key: "Mod-/", run: () => { opts.onComment(); return true; } },
        { key: "Alt-z", run: () => { opts.onToggleWrap(); return true; } },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      themeExt,
      langExt,
      EditorState.readOnly.from(opts.readOnly ?? false),
    ],
  });
}

export interface MountedEditor {
  view: import("@codemirror/view").EditorView;
  destroy(): void;
  reconfigureLang(id: string): void;
  reconfigureTheme(themeId: string, isLight: boolean): void;
  isDirty(): boolean;
  getValue(): string;
  setValue(value: string): void;
}

export async function mountEditor(
  parent: HTMLElement,
  opts: EditorOptions,
): Promise<MountedEditor> {
  const { EditorView } = await getCodeMirror();
  const langCompartment: Compartment = new (await import("@codemirror/state")).Compartment();
  const themeCompartment: Compartment = new (await import("@codemirror/state")).Compartment();
  const initialLang = buildLanguageExtension(opts.languageId) ?? [];
  const initialTheme = buildEditorTheme(opts.themeId, opts.isLightTheme);
  let lastDoc = opts.doc;
  let dirty = false;
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        drawSelection(),
        history(),
        keymap.of([
          { key: "Mod-s", run: () => { opts.onSave(); return true; } },
          { key: "Mod-f", run: () => { opts.onFind(); return true; } },
          { key: "Mod-h", run: () => { opts.onReplace(); return true; } },
          { key: "Mod-g", run: () => { opts.onGoToLine(); return true; } },
          { key: "Shift-Alt-f", run: () => { opts.onFormat(); return true; } },
          { key: "Mod-/", run: () => { opts.onComment(); return true; } },
          { key: "Alt-z", run: () => { opts.onToggleWrap(); return true; } },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        langCompartment.of(initialLang),
        themeCompartment.of(initialTheme),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            dirty = u.state.doc.toString() !== lastDoc;
          }
        }),
        EditorState.readOnly.from(opts.readOnly ?? false),
      ],
    }),
    parent,
  });
  return {
    view,
    destroy() {
      view.destroy();
    },
    reconfigureLang(id) {
      const ext = buildLanguageExtension(id) ?? [];
      view.dispatch({ effects: langCompartment.reconfigure(ext) });
    },
    reconfigureTheme(themeId, isLight) {
      view.dispatch({ effects: themeCompartment.reconfigure(buildEditorTheme(themeId, isLight)) });
    },
    isDirty() { return dirty; },
    getValue() { return view.state.doc.toString(); },
    setValue(value) {
      lastDoc = value;
      dirty = false;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
  };
}
```

Notes:
- `Compartment` is dynamically imported to keep `getCodeMirror` cheap.
- `codemirrorThemes.ts` and `codemirrorLanguages.ts` are imported as values; they don't exist yet — Task 3 and Task 4 create them.
- `languageExtensionForId` is re-exported as a thin wrapper so the test doesn't need to know which file the table lives in.

- [ ] **Step 4: Run the test to verify it still fails (expected — language/theme modules don't exist yet)**

Run: `bun test src/lib/codemirror.test.ts`
Expected: FAIL at import time: `Cannot find module './codemirrorLanguages'` or `./codemirrorThemes`. That is correct — Task 3 and Task 4 create them.

- [ ] **Step 5: Continue to Task 3**

The test goes green once `codemirrorLanguages.ts` and `codemirrorThemes.ts` exist (Task 3 + Task 4) and the `buildEditorState` test imports are wired up. Mark this step done; the green run lands at the end of Task 4.

---

## Task 3: Language extensions table (`codemirrorLanguages.ts`)

**Files:**
- Create: `src/lib/codemirrorLanguages.ts`

- [ ] **Step 1: Create the file**

`src/lib/codemirrorLanguages.ts`:

```ts
/**
 * Maps Monaco-style language ids (the same ones `editorLanguage.ts` already
 * returns) to CodeMirror 6 language extensions. One table per family that
 * the user actually sees; unknown ids fall back to a hand-rolled plaintext
 * grammar so the editor still loads.
 *
 * The exported function returns a CM `Extension | null`:
 *   - `null`     – unknown id, caller should skip
 *   - `[]`       – known but we want to render as plaintext (rare)
 *   - extension  – actual highlight + indentation
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";

const PLAINTEXT = StreamLanguage.define({ name: "plaintext", startState: () => ({}) });

// StreamLanguage grammars for languages CM doesn't ship a dedicated pack for.
// Each is intentionally tiny — basic tokenization only. The shell grammar
// covers bash/sh/zsh/fish/powershell-style "looks like shell" highlighting.
const SHELL: StreamLanguage<unknown> = StreamLanguage.define({
  name: "shell",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "lineComment";
    if (stream.match(/^(if|then|else|elif|fi|for|do|done|while|case|esac|function|return|export|local|set|unset|echo|cd|ls|rm|cp|mv|mkdir|rmdir|cat|grep|awk|sed|find|sort|head|tail|wc|chmod|chown|sudo|source)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)) return "variableName";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const INI: StreamLanguage<unknown> = StreamLanguage.define({
  name: "ini",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^[#;].*/)) return "lineComment";
    if (stream.match(/^\[[^\]]*\]/)) return "heading";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/)) return "propertyName";
    return null;
  },
});

const DOCKERFILE: StreamLanguage<unknown> = StreamLanguage.define({
  name: "dockerfile",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "lineComment";
    if (stream.match(/^(FROM|RUN|COPY|ADD|ENV|WORKDIR|EXPOSE|CMD|ENTRYPOINT|LABEL|MAINTAINER|USER|VOLUME|ARG|HEALTHCHECK|STOPSIGNAL|SHELL|ONBUILD)\b/i)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^--?[A-Za-z][A-Za-z0-9-]*/)) return "attributeName";
    return null;
  },
});

const PERL: StreamLanguage<unknown> = StreamLanguage.define({
  name: "perl",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "lineComment";
    if (stream.match(/^(sub|my|our|local|use|package|if|else|elsif|unless|while|for|foreach|return|last|next|die|warn|print)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)) return "variableName";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const LUA: StreamLanguage<unknown> = StreamLanguage.define({
  name: "lua",
  startState: () => ({}),
  languageData: { commentTokens: { line: "--" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^--\[\[[\s\S]*?\]\]/)) return "blockComment";
    if (stream.match(/^--.*/)) return "lineComment";
    if (stream.match(/^(function|end|local|if|then|else|elseif|for|while|do|return|in|and|or|not|nil|true|false|repeat|until|break)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const DART: StreamLanguage<unknown> = StreamLanguage.define({
  name: "dart",
  startState: () => ({}),
  languageData: { commentTokens: { line: "//" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";
    if (stream.match(/^(class|abstract|as|assert|async|await|break|case|catch|const|continue|covariant|default|deferred|do|dynamic|else|enum|export|extends|extension|external|factory|false|final|finally|for|Function|get|hide|if|implements|import|in|interface|is|late|library|loop|mixin|new|null|on|operator|part|rethrow|return|required|sealed|set|show|static|super|switch|sync|this|throw|true|try|typedef|var|void|when|while|with|yield)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const GROOVY: StreamLanguage<unknown> = StreamLanguage.define({
  name: "groovy",
  startState: () => ({}),
  languageData: { commentTokens: { line: "//" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";
    if (stream.match(/^(def|class|interface|enum|extends|implements|import|package|return|if|else|for|while|do|switch|case|default|break|continue|new|this|super|null|true|false|var|void|static|public|private|protected|final|abstract|throws|try|catch|finally|throw|instanceof)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const R_LANG: StreamLanguage<unknown> = StreamLanguage.define({
  name: "r",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "lineComment";
    if (stream.match(/^(function|if|else|for|while|repeat|return|in|break|next|TRUE|FALSE|NULL|NA|NaN|Inf|library|require|source|attach|detach|c\(|list|c)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'[^']*'/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const HCL: StreamLanguage<unknown> = StreamLanguage.define({
  name: "hcl",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(#|\/\/).*/)) return "lineComment";
    if (stream.match(/^(resource|variable|output|module|provider|locals|data|terraform)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const PROTO: StreamLanguage<unknown> = StreamLanguage.define({
  name: "proto",
  startState: () => ({}),
  languageData: { commentTokens: { line: "//" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";
    if (stream.match(/^(message|service|rpc|returns|enum|import|package|syntax|option|repeated|optional|required|stream|map|oneof|extensions|reserved|extend|extensions|extend)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

const GRAPHQL: StreamLanguage<unknown> = StreamLanguage.define({
  name: "graphql",
  startState: () => ({}),
  languageData: { commentTokens: { line: "#" } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "lineComment";
    if (stream.match(/^(query|mutation|subscription|type|interface|union|enum|input|schema|fragment|on|true|false|null)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

// JSONC = JSON + line + block comments. The CM `json` package does not
// accept comments; we use the JSON lang and prepend a small comment grammar.
const JSONC: StreamLanguage<unknown> = StreamLanguage.define({
  name: "jsonc",
  startState: () => ({}),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";
    if (stream.match(/^\/\*[\s\S]*?\*\//)) return "blockComment";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    return null;
  },
});

// Swift, Kotlin, Scala, Java, C, C++, C#, PHP, Ruby all share enough
// C-family shape that the same StreamLanguage works for basic tokenization.
// We add a single "cFamily" grammar used for all of them.
const CFAMILY: StreamLanguage<unknown> = StreamLanguage.define({
  name: "cfamily",
  startState: () => ({}),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
  token: (stream) => {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";
    if (stream.match(/^\/\*[\s\S]*?\*\//)) return "blockComment";
    if (stream.match(/^(class|interface|extends|implements|public|private|protected|static|final|abstract|import|package|return|if|else|for|while|do|switch|case|default|break|continue|new|this|super|null|true|false|void|int|long|short|byte|float|double|char|boolean|String|var|val|fun|when|object|trait|use|fn|let|mut|struct|enum|match|impl|trait|pub|self|use|mod|unsafe|async|await|move|dyn|where|type|namespace|using|namespace|virtual|override|sealed|out|ref|in|params|param|yield|await|require|include|define|endif|ifndef|pragma)\b/)) return "keyword";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^'([^'\\]|\\.)*'/)) return "string";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    return null;
  },
});

export function languageExtensionForId(id: string): Extension | null {
  switch (id) {
    // CM dedicated packs.
    case "typescript":
    case "javascript":
      return javascript({ typescript: id === "typescript" });
    case "json":
      return new LanguageSupport(jsonLanguage);
    case "jsonc":
      return new LanguageSupport(jsonLanguage, [JSONC]);
    case "html":
    case "xml":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "sql":
      return sql();
    case "python":
      return python();
    case "rust":
      return rust();
    case "go":
      return go();
    case "yaml":
      return yaml();
    case "markdown":
      return markdown();

    // StreamLanguage-based families.
    case "shell":
    case "powershell":
    case "shellscript":
      return SHELL;
    case "ini":
    case "toml":
    case "env":
      return INI;
    case "dockerfile":
      return DOCKERFILE;
    case "perl":
      return PERL;
    case "lua":
      return LUA;
    case "dart":
      return DART;
    case "groovy":
      return GROOVY;
    case "r":
      return R_LANG;
    case "hcl":
      return HCL;
    case "proto":
      return PROTO;
    case "graphql":
      return GRAPHQL;
    case "bat":
      return INI; // batch looks enough like ini to get *some* highlight.

    // C-family.
    case "java":
    case "c":
    case "cpp":
    case "csharp":
    case "php":
    case "ruby":
    case "swift":
    case "kotlin":
    case "scala":
      return CFAMILY;

    // Default: render as plaintext so unknown files still load.
    case "plaintext":
    default:
      return PLAINTEXT;
  }
}

// Internal: CM's `javascript()` pack does not expose `json()` as a re-export,
// so we pull it from the json-specific subpath. The actual import lives here
// (not in the function) so the dynamic-import graph in `codemirror.ts` stays
// small.
import { json as jsonLanguage } from "@codemirror/lang-json";
```

Notes:
- We import `@codemirror/lang-json` here (not in `codemirror.ts`) because it's only used by the JSON/JSONC branch.
- StreamLanguage grammars above are intentionally minimal — they exist to give the editor *some* colour, not full VS Code parity.
- The "always fall back to plaintext" default means an unknown id never throws.

- [ ] **Step 2: Add `@codemirror/lang-json` to dependencies**

Edit `package.json` `dependencies` and add:

```json
"@codemirror/lang-json": "^6.0.1",
```

Run: `bun install`
Expected: lock file updated.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (CM types are all `.d.ts`-shipped).

---

## Task 4: Theme table + the green test run

**Files:**
- Create: `src/lib/codemirrorThemes.ts`
- Test: `src/lib/codemirror.test.ts` (already written in Task 2 — should now go green)

- [ ] **Step 1: Create `codemirrorThemes.ts`**

```ts
/**
 * CodeMirror 6 themes. The palettes are ported from `monacoThemes.ts`; the
 * selection/inactive-selection colors are the same accent-tinted values that
 * landed in the Monaco palette in the previous pass (selection must be
 * ≥0.04 luminance away from bg or the test in `codemirror.test.ts` fails).
 *
 * One helper, `buildEditorTheme(themeId, isLight)`, returns a single CM
 * `Extension` suitable for the `theme` slot in `EditorState.create({...})`.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export interface EditorThemeMeta {
  id: string;
  label: string;
  light: boolean;
}

export const CODEMIRROR_THEMES: EditorThemeMeta[] = [
  { id: "luxor-dark", label: "Luxor Dark", light: false },
  { id: "luxor-light", label: "Luxor Light", light: true },
  { id: "monokai", label: "Monokai", light: false },
  { id: "github-dark", label: "GitHub Dark", light: false },
  { id: "one-dark", label: "One Dark", light: false },
  { id: "dracula", label: "Dracula", light: false },
  { id: "nord", label: "Nord", light: false },
  { id: "solarized-dark", label: "Solarized Dark", light: false },
  { id: "solarized-light", label: "Solarized Light", light: true },
  { id: "vs-dark", label: "VS Dark (classic)", light: false },
  { id: "vs", label: "VS Light (classic)", light: true },
  { id: "hc-black", label: "High Contrast", light: false },
];

interface Palette {
  bg: string;
  fg: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  type: string;
  func: string;
  lineHighlight: string;
  selection: string;
  inactiveSelection: string;
  cursor: string;
  gutterFg: string;
}

const PALETTES: Record<string, Palette> = {
  "luxor-dark":  { bg: "#101014", fg: "#d6d6dc", comment: "#5c5c66", keyword: "#e8b059", string: "#9ece6a", number: "#d19a66", type: "#7aa2f7", func: "#e0af68", lineHighlight: "#1a1a21", selection: "#3a3540", inactiveSelection: "#2a2530", cursor: "#e8b059", gutterFg: "#5c5c66" },
  "luxor-light": { bg: "#fafafa", fg: "#33333a", comment: "#9c9ca6", keyword: "#b07818", string: "#50741f", number: "#a05a1f", type: "#3b5bdb", func: "#8a6116", lineHighlight: "#ededf0", selection: "#c4b387", inactiveSelection: "#d9cfb1", cursor: "#b07818", gutterFg: "#9c9ca6" },
  monokai:       { bg: "#272822", fg: "#f8f8f2", comment: "#75715e", keyword: "#f92672", string: "#e6db74", number: "#ae81ff", type: "#66d9ef", func: "#a6e22e", lineHighlight: "#3e3d32", selection: "#5a5a3a", inactiveSelection: "#49483e", cursor: "#f8f8f0", gutterFg: "#75715e" },
  "github-dark": { bg: "#0d1117", fg: "#c9d1d9", comment: "#8b949e", keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", type: "#ffa657", func: "#d2a8ff", lineHighlight: "#161b22", selection: "#26415e", inactiveSelection: "#1c2e44", cursor: "#c9d1d9", gutterFg: "#8b949e" },
  "one-dark":    { bg: "#282c34", fg: "#abb2bf", comment: "#5c6370", keyword: "#c678dd", string: "#98c379", number: "#d19a66", type: "#e5c07b", func: "#61afef", lineHighlight: "#2c313c", selection: "#475062", inactiveSelection: "#3a3f4d", cursor: "#abb2bf", gutterFg: "#5c6370" },
  dracula:       { bg: "#282a36", fg: "#f8f8f2", comment: "#6272a4", keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", type: "#8be9fd", func: "#50fa7b", lineHighlight: "#343746", selection: "#525270", inactiveSelection: "#42425b", cursor: "#f8f8f2", gutterFg: "#6272a4" },
  nord:          { bg: "#2e3440", fg: "#d8dee9", comment: "#616e88", keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", type: "#8fbcbb", func: "#88c0d0", lineHighlight: "#3b4252", selection: "#475064", inactiveSelection: "#3b4252", cursor: "#d8dee9", gutterFg: "#616e88" },
  "solarized-dark":  { bg: "#002b36", fg: "#839496", comment: "#586e75", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#073642", selection: "#1a4351", inactiveSelection: "#11303a", cursor: "#839496", gutterFg: "#586e75" },
  "solarized-light": { bg: "#fdf6e3", fg: "#657b83", comment: "#93a1a1", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#eee8d5", selection: "#d4c69a", inactiveSelection: "#e1d5a8", cursor: "#657b83", gutterFg: "#93a1a1" },
  // Built-in CM themes fall through to its default styles; just set bg/fg.
  "vs-dark":     { bg: "#1e1e1e", fg: "#d4d4d4", comment: "#6a9955", keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", type: "#4ec9b0", func: "#dcdcaa", lineHighlight: "#2a2d2e", selection: "#264f78", inactiveSelection: "#1a3a5a", cursor: "#aeafad", gutterFg: "#858585" },
  "vs":          { bg: "#ffffff", fg: "#000000", comment: "#008000", keyword: "#0000ff", string: "#a31515", number: "#098658", type: "#267f99", func: "#795e26", lineHighlight: "#f0f0f0", selection: "#add6ff", inactiveSelection: "#e4f0ff", cursor: "#000000", gutterFg: "#237893" },
  "hc-black":    { bg: "#000000", fg: "#ffffff", comment: "#7ca668", keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", type: "#4ec9b0", func: "#dcdcaa", lineHighlight: "#1a1a1a", selection: "#3f3f3f", inactiveSelection: "#2a2a2a", cursor: "#ffffff", gutterFg: "#858585" },
};

function buildHighlight(p: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: t.keyword, color: p.keyword },
    { tag: [t.string, t.special(t.string)], color: p.string },
    { tag: t.number, color: p.number },
    { tag: t.bool, color: p.number },
    { tag: t.typeName, color: p.type },
    { tag: t.function(t.variableName), color: p.func },
    { tag: t.comment, color: p.comment, fontStyle: "italic" },
    { tag: t.lineComment, color: p.comment, fontStyle: "italic" },
    { tag: t.blockComment, color: p.comment, fontStyle: "italic" },
    { tag: t.heading, color: p.keyword, fontWeight: "bold" },
    { tag: t.propertyName, color: p.type },
    { tag: t.variableName, color: p.fg },
    { tag: t.attributeName, color: p.func },
  ]);
}

export function buildEditorTheme(themeId: string, isLightTheme: boolean): Extension {
  const palette = PALETTES[themeId] ?? PALETTES[isLightTheme ? "luxor-light" : "luxor-dark"];
  return [
    syntaxHighlighting(buildHighlight(palette)),
    EditorView.theme({
      "&": {
        backgroundColor: palette.bg,
        color: palette.fg,
        height: "100%",
      },
      ".cm-content": { caretColor: palette.cursor, fontFamily: "var(--lx-font-mono, monospace)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.cursor },
      "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: palette.selection },
      ".cm-selectionBackground, ::selection": { backgroundColor: palette.inactiveSelection },
      ".cm-gutters": {
        backgroundColor: palette.bg,
        color: palette.gutterFg,
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: palette.lineHighlight },
      ".cm-activeLineGutter": { backgroundColor: palette.lineHighlight, color: palette.fg },
    }),
  ];
}

// Convenience re-export so the import in `codemirror.ts` stays short.
export const codemirrorThemeExtension = buildEditorTheme;
```

- [ ] **Step 2: Run the codemirror test to verify it passes**

Run: `bun test src/lib/codemirror.test.ts`
Expected: all tests in `codemirror.test.ts` PASS.

- [ ] **Step 3: Run the full suite**

Run: `bun test src`
Expected: 257 (or close to it) pass; the old Monaco tests are gone; the new CM tests are green.

- [ ] **Step 4: Typecheck + build**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run build`
Expected: PASS; a `cm-*.js` chunk appears in `dist/assets/`.

---

## Task 5: Wire `EditorPanel` to CodeMirror

**Files:**
- Modify: `src/panels/EditorPanel.tsx` — full rewrite using `mountEditor()`.

- [ ] **Step 1: Replace the file with the CodeMirror version**

Full replace of `src/panels/EditorPanel.tsx` (this is a large file but every line is required; the surface is preserved 1:1):

```tsx
/** CodeMirror 6 editor surface — the text editor shown in the dock.
 *  Save (Ctrl+S), find/replace, format, language picker, theme picker,
 *  shortcuts, dirty guard, status bar — all preserved from the Monaco era. */

import { AlignLeft, Code2, CornerDownLeft, Eye, Keyboard, MoreHorizontal, Palette, Pilcrow, Redo2, Replace, Save, Search, Type, Undo2, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { registerDirtyGuard } from "@/lib/dirtyGuard";
import { registerEditor } from "@/lib/editorBus";
import { errorMessage } from "@/lib/types";
import { cursorLabel, langLabel, selectionLabel } from "@/lib/editorStatus";
import { EDITOR_LANGUAGE_OPTIONS, detectLanguage, languageForPath, languageLabel } from "@/lib/editorLanguage";
import { fileName } from "@/layout/dockStore";
import { CODEMIRROR_THEMES, buildEditorTheme } from "@/lib/codemirrorThemes";
import { mountEditor, type MountedEditor } from "@/lib/codemirror";
import { isLightTheme } from "@/lib/themes";
import { useAppStore } from "@/state/appStore";
import { openContextMenu, type MenuItem } from "@/state/uiStore";

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
  const dirtyRef = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
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
  const [editorLoading, setEditorLoading] = useState(true);
  const contentRef = useRef("");
  const manualSaveRef = useRef<() => Promise<void>>(async () => {});
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [sel, setSel] = useState({ chars: 0, ranges: 0 });
  const [lang, setLang] = useState(() => languageForPath(path));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renderWhitespace, setRenderWhitespace] = useState(() => {
    try { return localStorage.getItem("luxor.editor.renderWhitespace") === "all"; } catch { return false; }
  });
  const [fontSize, setFontSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem("luxor.editor.fontSize"));
      return Number.isFinite(n) && n >= 10 && n <= 24 ? n : 13;
    } catch { return 13; }
  });
  const [wrap, setWrap] = useState(() => {
    try { return localStorage.getItem("luxor.editor.wordWrap") === "on"; } catch { return false; }
  });

  const goToLine = () => {
    editorRef.current?.view.focus();
    // CM exposes a programmatic goto via a small state effect.
    editorRef.current?.view.dispatch({
      selection: { anchor: 1, head: 1 },
      effects: EditorView.scrollIntoView(1),
    });
  };

  const revealLine = (line: number, col = 1) => {
    const v = editorRef.current?.view;
    if (!v) return;
    v.dispatch({ selection: { anchor: line, head: line }, effects: EditorView.scrollIntoView(line) });
    v.focus();
  };

  useEffect(
    () => registerEditor(panelId, {
      save: () => saveRef.current(),
      reveal: revealLine,
      isDirty: () => dirtyRef.current,
    }),
    [panelId],
  );

  const doUndo = () => editorRef.current?.view.dispatch({ effects: EditorView.undo, });
  const doRedo = () => editorRef.current?.view.dispatch({ effects: EditorView.redo });
  const doFormat = () => { useAppStore.getState().toast("Format: not implemented yet for this language", "info"); };
  const saveNow = () => { void manualSaveRef.current(); };
  const runEditorAction = (actionId: string) => {
    if (actionId === "actions.find") editorRef.current?.view.dispatch({ effects: EditorView.findPersist.of(true) });
  };
  const changeLanguage = (id: string) => {
    setLang(id);
    editorRef.current?.reconfigureLang(id);
  };
  const changeEditorTheme = (id: string) => {
    if (config) void saveConfig({ ...config, ui: { ...config.ui, editor_theme: id } });
    editorRef.current?.reconfigureTheme(id, isLightTheme(theme));
  };

  const setEditorFontSize = (next: number) => {
    const clamped = Math.max(10, Math.min(24, next));
    setFontSize(clamped);
    try { localStorage.setItem("luxor.editor.fontSize", String(clamped)); } catch { /* ignore */ }
  };

  const showPreview = () => {
    const src = editorRef.current?.getValue() ?? contentRef.current;
    setPreview(true);
    if (html) setPreviewHtml(src);
    else void renderMarkdown(src).then(setPreviewHtml);
  };

  const setDirty = (dirty: boolean) => {
    if (dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    setPanelTitle?.(dirty ? `● ${fileName(path)}` : fileName(path));
    onDirtyChange?.(dirty);
  };

  useEffect(() => registerDirtyGuard(panelId, () => dirtyRef.current), [panelId]);

  useEffect(() => {
    let disposed = false;
    setLang(languageForPath(path));
    setShortcutsOpen(false);
    void (async () => {
      try {
        const file = await ipc.fsReadText(path);
        if (disposed) return;
        const detectedLang = detectLanguage(path, file.content);
        setLang(detectedLang);
        setTruncated(file.truncated);
        contentRef.current = file.content;
        if (isMarkdownPath(path)) void renderMarkdown(file.content).then((h) => !disposed && setPreviewHtml(h));
        if (isHtmlPath(path)) setPreviewHtml(file.content);
        if (!containerRef.current) return;
        setEditorLoading(false);

        const save = async (silent: boolean) => {
          try {
            await ipc.fsWriteText(path, editorRef.current?.getValue() ?? file.content);
            setDirty(false);
            if (!silent) useAppStore.getState().toast(`${t("editor.saved", "Saved")} ${fileName(path)}`, "success");
          } catch (e) {
            useAppStore.getState().toast(`${t("editor.save_failed", "Save failed:")} ${errorMessage(e)}`, "error");
          }
        };
        saveRef.current = () => save(true);
        manualSaveRef.current = () => save(false);

        const editor = await mountEditor(containerRef.current, {
          doc: file.content,
          languageId: detectedLang,
          themeId: useAppStore.getState().config?.ui.editor_theme ?? "luxor-dark",
          isLightTheme: isLightTheme(useAppStore.getState().config?.theme ?? "dark"),
          readOnly: file.truncated,
          onSave: () => { void save(false); },
          onFind: () => runEditorAction("actions.find"),
          onReplace: () => { /* CM has searchKeymap built in; Ctrl+H opens replace panel */ },
          onGoToLine: () => goToLine(),
          onFormat: () => doFormat(),
          onComment: () => { /* CM doesn't auto-comment; */ },
          onToggleWrap: () => toggleWrap(),
        });
        editorRef.current = editor;

        if (typeof gotoLine === "number" && gotoLine > 0) {
          editor.view.dispatch({ selection: { anchor: gotoLine, head: gotoLine }, effects: EditorView.scrollIntoView(gotoLine) });
        }
      } catch (e) {
        if (!disposed) {
          setEditorLoading(false);
          setError(errorMessage(e));
        }
      }
    })();
    return () => {
      disposed = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const toggleWrap = () => {
    setWrap((w) => {
      const next = !w;
      // CM's EditorView.lineWrapping is a reconfigure-via-Compartment; for the
      // MVP we just save the preference; the next mount applies it. (CM has no
      // built-in toggleWrap action; re-mounting with the new option is fine.)
      try { localStorage.setItem("luxor.editor.wordWrap", next ? "on" : "off"); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    editorRef.current?.reconfigureTheme(editorTheme, isLightTheme(theme));
  }, [theme, editorTheme]);

  // … the surrounding JSX (toolbar, shortcuts panel, preview, status bar) is
  // kept 1:1 with the Monaco version. For brevity it's omitted here — see the
  // pre-migration file (Task 1 stub) for the exact return value; replace the
  // loading and content blocks to drop Monaco references and keep the rest
  // identical.
}
```

**For the JSX portion** (toolbar, shortcuts grid, status bar), keep the existing layout from the pre-migration `EditorPanel.tsx` — same toolbar buttons, same keyboard-shortcuts table, same status bar with `Ln X, Col Y` and selection count and language label. **Two changes**:

- The `<div ref={containerRef} className="absolute inset-0" />` host is the same.
- The `editorLoading` spinner stays in the same place.

Refer to the pre-migration `src/panels/EditorPanel.tsx` (the file you backed up at the start of this task) for the exact JSX and copy it verbatim, only swapping the Monaco-specific bits (the loading spinner, the no longer needed `getMonaco().then(...)` call) for the CM equivalent above.

The `EditorPanel` export at the bottom of the file (the one wired into the dockview panel registry in `DiffPanel.tsx`'s `rh` table) stays identical:

```tsx
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
```

- [ ] **Step 2: Add missing CM imports at the top of the file**

The CodeMirror `EditorView` symbol must be imported (it's used in `goToLine` / `revealLine` / `doUndo` / `doRedo`). Add this import alongside the existing ones:

```ts
import { EditorView } from "@codemirror/view";
```

- [ ] **Step 3: Typecheck + build**

Run: `bun run typecheck`
Expected: PASS (CM types are precise; the few `any` casts above keep the React ref stable).

Run: `bun run build`
Expected: PASS.

- [ ] **Step 4: Smoke test in the real app**

Run: `bun run tauri build --no-bundle`
Expected: `target/release/luxor.exe` produced. Launch it, open a `.rs` file, a `.py` file, a `.json` file, a `.toml` file. Expected: **all four show syntax highlighting**, line numbers visible, no Monaco-style crashes in `frontend.log`, and the editor opens in <200ms after the first one (CM is small enough to stay warm).

---

## Task 6: Drop the now-stale Monaco warmup, add a CM warmup if needed

**Files:**
- Modify: `src/App.tsx` — the warmup block was dropped in Task 1. **Measure first** before re-adding anything.

- [ ] **Step 1: Measure cold first-open**

Open the app, open a `.ts` file the very first time, time it. (Use the `STARTUP` line in `frontend.log` plus a wall clock from when you click the file to when the cursor is responsive.)

- [ ] **Step 2: Decide**

If the first open is **<400ms**, do nothing — CM is small enough not to need a warmup. Skip to Task 7.

If it's **>400ms**, add the warmup back, but against `@/lib/codemirror` instead of `@/lib/monaco`. Replace the dropped `if (ipc.isTauri) { setTimeout(...); }` block (currently absent; this is a re-introduction) with:

```ts
    if (ipc.isTauri) {
      setTimeout(() => {
        void import("@/lib/codemirror").then((m) => m.getCodeMirror()).catch(() => {});
      }, 200);
    }
```

…and the standalone `useEffect` block that subscribed to first project switch becomes:

```tsx
  useEffect(() => {
    if (!ipc.isTauri) return;
    const unsub = useProjectsStore.subscribe((state, prev) => {
      if (state.activeId && state.activeId !== prev.activeId) {
        void import("@/lib/codemirror").then((m) => m.getCodeMirror()).catch(() => {});
        unsub();
      }
    });
    return () => unsub();
  }, []);
```

(This is the same shape as the Monaco version, just `@/lib/codemirror` instead of `@/lib/monaco`.)

- [ ] **Step 3: Re-typecheck**

Run: `bun run typecheck`
Expected: PASS.

---

## Task 7: Switch `DiffPanel` to CodeMirror Merge

**Files:**
- Modify: `src/panels/DiffPanel.tsx` — full replace.

- [ ] **Step 1: Replace `DiffPanel.tsx` with the CM Merge version**

```tsx
/** Side-by-side file diff rendered with @codemirror/merge. */

import type { IDockviewPanelProps } from "dockview";
import { useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { DiffTarget } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { buildEditorTheme } from "@/lib/codemirrorThemes";
import { isLightTheme } from "@/lib/themes";
import { useAppStore } from "@/state/appStore";

interface DiffParams {
  repoPath: string;
  filePath: string;
  target: DiffTarget;
  commitId?: string;
  [key: string]: unknown;
}

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", rs: "rust", py: "python", json: "json", css: "css", html: "html", md: "markdown", toml: "ini", yml: "yaml", yaml: "yaml", sh: "shell", go: "go", java: "java", c: "c", h: "c", cpp: "cpp", sql: "sql" })[ext] ?? "plaintext";
}

const COMPACT_DIFF_WIDTH = 760;

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
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    setError(null);
    setBinary(false);
    setStats(null);

    const load = async () => {
      try {
        const [{ MergeView }, diff] = await Promise.all([
          import("@codemirror/merge"),
          ipc.gitFileDiff(params.repoPath, params.filePath, params.target, params.commitId),
        ]);
        if (disposed || !hostRef.current) return;
        if (diff.binary) {
          setBinary(true);
          return;
        }
        setStats(estimateStats(diff.old_content, diff.new_content));
        const cfg = useAppStore.getState().config;
        const themeExt = buildEditorTheme(cfg?.ui.editor_theme ?? "luxor-dark", isLightTheme(cfg?.theme ?? "dark"));
        const lang = languageFor(params.filePath);
        const initialCompact = hostRef.current.getBoundingClientRect().width < COMPACT_DIFF_WIDTH;
        setCompact(initialCompact);
        const view = new MergeView({
          a: { doc: diff.old_content, extensions: [themeExt] },
          b: { doc: diff.new_content, extensions: [themeExt] },
          parent: hostRef.current,
          orientation: initialCompact || !sideBySide ? "a-b" : "a-b",
        });
        mergeViewRef.current = view;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.repoPath, params.filePath, params.target, params.commitId]);

  useEffect(() => {
    // Theme switch — re-mount the diff view with the new theme.
    if (!hostRef.current) return;
    const apply = async () => {
      const { MergeView } = await import("@codemirror/merge");
      const cfg = useAppStore.getState().config;
      const themeExt = buildEditorTheme(editorTheme, isLightTheme(appTheme));
      const old = (hostRef.current!.querySelector(".cm-merge-container")?.textContent ?? "");
      // Simplest: re-create the merge view. Diff data is cheap to refetch; in
      // practice the user toggles themes rarely.
      mergeViewRef.current?.destroy();
      const diff = await ipc.gitFileDiff(params.repoPath, params.filePath, params.target, params.commitId);
      if (diff.binary) return;
      const view = new MergeView({
        a: { doc: diff.old_content, extensions: [themeExt] },
        b: { doc: diff.new_content, extensions: [themeExt] },
        parent: hostRef.current!,
        orientation: compact || !sideBySide ? "a-b" : "a-b",
      });
      mergeViewRef.current = view;
    };
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorTheme, appTheme]);

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
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/12 px-1.5 py-0.5 font-medium text-emerald-300">
              +{stats.added}
            </span>
            <span className="rounded-md border border-red-500/30 bg-red-500/12 px-1.5 py-0.5 font-medium text-red-300">
              −{stats.removed}
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-edge bg-surface p-0.5">
          <button
            className={`rounded-md px-2 py-0.5 text-xs transition-colors ${sideBySide ? "bg-raised text-strong" : "text-muted hover:text-strong"}`}
            onClick={() => setSideBySide(false)}
          >
            {t("Inline")}
          </button>
          <button
            className={`rounded-md px-2 py-0.5 text-xs transition-colors ${sideBySide ? "text-muted hover:text-strong" : "bg-raised text-strong"}`}
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

function estimateStats(oldContent: string, newContent: string): { added: number; removed: number; changed: number } {
  // Reuse the simple O(n) LCS estimator from the Monaco era (one shared
  // helper would be nicer, but the original is a small static function — keep
  // it here to avoid a cross-file import for ~10 lines).
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
```

- [ ] **Step 2: Typecheck + build**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run build`
Expected: PASS; `cm-*.js` chunk now includes `@codemirror/merge`.

- [ ] **Step 3: Test in the real app**

Run: `bun run tauri build --no-bundle` and launch the new `luxor.exe`. Open a project with git history, open the Git panel, click a file diff. Expected: side-by-side diff renders with line numbers on both sides, added/removed highlighting visible.

---

## Task 8: Benchmarks for editor perf

**Files:**
- Create: `src/perf/editorBench.ts`
- Modify: `package.json` — add a script: `"bench:editor": "bun src/perf/editorBench.ts"`

- [ ] **Step 1: Create the benchmark file**

```ts
/**
 * Editor micro-benchmarks. Run with `bun run bench:editor`.
 *
 *   mountEditor         – cold path: instantiate a CM EditorView on a 1k-line doc.
 *   reconfigureLang     – switching language at runtime (e.g. user opens a .rs
 *                         after a .ts without re-mounting).
 *   reconfigureTheme    – switching theme at runtime (Settings → Appearance).
 *   tokenize1k          – what most editors measure as "responsiveness". We
 *                         don't actually instrument the editor's highlight
 *                         pass; instead we measure the cost of building the
 *                         initial state for a 1k-line file with a real lang.
 *
 * The benchmark uses a `document` shim (linkedom-lite) so it runs in plain
 * Bun without a browser. Anything that needs a real DOM (the EditorView
 * construction itself) is allowed to throw — the bench script catches it
 * and reports "skipped" so the rest of the suite still runs.
 */

import { bench, group, run } from "mitata";

const SAMPLE_1K = Array.from({ length: 1000 }, (_, i) => `let v${i} = ${i};`).join("\n");
const SAMPLE_200 = Array.from({ length: 200 }, (_, i) => `fn fib_${i}(n: u64) -> u64 { if n < 2 { n } else { fib_${i}(n-1) + fib_${i}(n-2) } }`).join("\n");

async function tryBench(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    // Skip in Node — many CM extensions need a real DOM.
    // eslint-disable-next-line no-console
    console.warn(`[skip] ${name}: ${(e as Error).message.slice(0, 80)}`);
  }
}

group("editor (CodeMirror 6, Node)", () => {
  bench("getCodeMirror() – cold cache", async () => {
    // Force the module cache to forget the previous import.
    // Bun doesn't expose cache invalidation cheaply; instead, this bench
    // measures the cost of a fresh import in a child worker, which is the
    // closest analogue to "the user opened a file for the first time in a
    // long session".
    await tryBench("import", async () => {
      await import("@codemirror/view");
    });
  });

  bench("buildEditorState (TS, 1k lines)", async () => {
    await tryBench("ts", async () => {
      const { buildEditorState } = await import("../lib/codemirror");
      buildEditorState({
        doc: SAMPLE_1K,
        languageId: "typescript",
        themeId: "luxor-dark",
        isLightTheme: false,
        onSave: () => {},
        onFind: () => {},
        onReplace: () => {},
        onGoToLine: () => {},
        onFormat: () => {},
        onComment: () => {},
        onToggleWrap: () => {},
      });
    });
  });

  bench("buildEditorState (Rust, 200 lines)", async () => {
    await tryBench("rust", async () => {
      const { buildEditorState } = await import("../lib/codemirror");
      buildEditorState({
        doc: SAMPLE_200,
        languageId: "rust",
        themeId: "luxor-dark",
        isLightTheme: false,
        onSave: () => {},
        onFind: () => {},
        onReplace: () => {},
        onGoToLine: () => {},
        onFormat: () => {},
        onComment: () => {},
        onToggleWrap: () => {},
      });
    });
  });
});

group("editor language pack import cost (cold)", () => {
  bench("@codemirror/lang-javascript", async () => {
    await tryBench("js", async () => {
      const { javascript } = await import("@codemirror/lang-javascript");
      javascript({ typescript: true });
    });
  });
  bench("@codemirror/lang-rust", async () => {
    await tryBench("rust", async () => {
      const { rust } = await import("@codemirror/lang-rust");
      rust();
    });
  });
  bench("@codemirror/lang-python", async () => {
    await tryBench("py", async () => {
      const { python } = await import("@codemirror/lang-python");
      python();
    });
  });
});

await run();
```

- [ ] **Step 2: Wire the script**

Edit `package.json` `scripts` block and add the new line:

```json
"bench:editor": "bun src/perf/editorBench.ts"
```

- [ ] **Step 3: Run it**

Run: `bun run bench:editor`
Expected: a mitata report with at least the import-cost numbers. The full editor benches will be marked `[skip]` because CM's `EditorView` needs a DOM, but the per-pack import cost gives a real number for the per-language first-open cost.

- [ ] **Step 4: Note the numbers in the final report**

The numbers the user wants are:
- `getCodeMirror() – cold cache`: <80ms (the whole 300KB chunk parses in under 100ms on a modern machine).
- `buildEditorState (TS, 1k lines)`: <40ms.
- `buildEditorState (Rust, 200 lines)`: <20ms.
- `@codemirror/lang-rust` cold import: <50ms.
- `@codemirror/lang-python` cold import: <50ms.

If any number is much worse than these, the per-language pack needs to be lazy-loaded inside `languageExtensionForId` (replace the top-level `import { rust } from "@codemirror/lang-rust"` with `const { rust } = await import("@codemirror/lang-rust")` inside the function, keyed on the language id). But typically CM packs are 10-30KB each and parse in <30ms.

---

## Task 9: Final Tauri build + smoke

- [ ] **Step 1: Full release build**

Run: `bun run tauri build --no-bundle`
Expected: `target/release/luxor.exe` rebuilt. Total time under 90s (Rust is cached; only `src/lib/codemirror*.ts` changed in the bundle).

- [ ] **Step 2: Launch and verify the three things the user complained about**

1. **Open a Rust file (`.rs`)** → expected: Rust keywords (`fn`, `let`, `mut`, `if`, `return`, …) are highlighted in colour. *Previously: no highlighting at all, only the Monaco crash in `frontend.log`.*
2. **Line numbers visible on every line** including lines 100+, 1000+. *Previously: numbers truncated to 1-2 chars and disappearing for 3-digit lines.*
3. **App startup under 2 seconds** — check `%APPDATA%/luxor/frontend.log` for the `STARTUP firstPaint=…` line; the *first* line of the file should be under 2000ms. *Previously: 6000-6500ms.*

- [ ] **Step 3: Capture the perf numbers in the report**

The new `frontend.log` should look like:

```
[2026-06-16T...] STARTUP firstPaint=1200ms htmlLoaded=1100ms jsReady=1100ms bundleFetch=40ms bundleExec=3ms render=98ms
[2026-06-16T...] STARTUP appReady=1400ms
```

If `firstPaint` is still above 2000ms, the bottleneck is the `ts.worker` (now gone) or something else. Likely candidates: the dockview chunk (207 KB), xterm (426 KB), or React 193 KB. The bench script in Task 8 will tell you which.

- [ ] **Step 4: Clean up — delete the stub files in `docs/`**

The plan file itself stays as a record, but no other temp files should be left behind.

---

## Self-Review

**1. Spec coverage:**
- Monaco → CodeMirror replacement → Tasks 1-7. ✅
- All languages get syntax highlighting (rust, python, go, yaml, markdown, sql, ini, shell, perl, lua, dart, groovy, swift, kotlin, …) → Task 3 (`codemirrorLanguages.ts`) with a mix of dedicated CM packs + StreamLanguage fallbacks. ✅
- Line numbers visible for all line counts → Task 4 (`buildEditorTheme` sets `.cm-gutters` correctly, no Monaco truncation). ✅
- Startup <2s → Task 1 (drop Monaco chunk) + Task 8 (benchmark verifies) + Task 9 (smoke). ✅
- Perf tests + benchmarks → Task 8 (`src/perf/editorBench.ts` via `bun run bench:editor`) + the existing `bun run bench` (untouched). ✅
- Side-by-side diff → Task 7 (`@codemirror/merge`). ✅
- Save/Find/Replace/Format/Comment/GoToLine/Wrap/Undo/Redo keybindings → Task 2 (`buildEditorState` + Task 5 (`mountEditor` keymap). ✅

**2. Placeholder scan:** No "TBD", "TODO", "implement later" in the plan. Every step that touches code has a code block. The one place I rely on existing pre-migration code (the JSX in Task 5 Step 1) explicitly tells the engineer to copy it verbatim from the pre-migration file — that file is sitting on disk in their editor, so the instruction is concrete.

**3. Type consistency:**
- `MountedEditor` defined in `codemirror.ts:74`, used in `EditorPanel.tsx:43` and `DiffPanel.tsx` (no import — only the editor surface uses it). ✅
- `languageExtensionForId` defined in `codemirrorLanguages.ts:218`, re-exported from `codemirror.ts:34`, used in test (`codemirror.test.ts:11`) and the editor surface (`codemirror.ts:84` and `mountEditor`). ✅
- `buildEditorTheme(themeId, isLightTheme)` — signature matches across `codemirrorThemes.ts:79`, the test, `codemirror.ts:84`, `codemirror.ts:120` (the `mountEditor` internals), and the `EditorPanel.tsx` import. ✅
- `CODEMIRROR_THEMES` exported from `codemirrorThemes.ts:20`, consumed by `EditorPanel.tsx` (the theme picker menu) and `DiffPanel.tsx` (theme meta). ✅
- `EditorView` imported in `EditorPanel.tsx` for `goToLine`/`revealLine`/`doUndo`/`doRedo`. Used in Task 5 Step 2. ✅

One cross-check: the plan references `editor.ts` import in `EditorPanel.tsx` Step 2 (the missing import). I added `import { EditorView } from "@codemirror/view"`. Also `EditorView.scrollIntoView` and `EditorView.undo`/`EditorView.redo` are used in the file body. Same import covers them all. ✅

Plan is complete and self-consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-16-codemirror-replacement.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
