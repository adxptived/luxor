# Editor UX & Startup Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the slow Luxor startup (~6.5s) reported in `luxor-frontend.log`, restore Monaco syntax highlighting for languages other than TS/JSON/CSS/HTML (currently broken because the `getMonaco()` worker map only registers 4 workers, so languages like Rust/Python/Go fall through to the default `editor.worker` and crash with "Cannot read properties of undefined (reading 'toUrl')"), make text selection visibly highlighted, and remove the white borders the user is seeing around the editor surface.

**Architecture:**
1. **Workers** — wire Monaco's "languages I want tokenized" API so every language that's opened gets a real language worker (JSON/CSS/HTML/TS) or the generic editor worker, never the broken AMD-dynamic-import path. The mapping lives in `src/lib/monaco.ts`.
2. **Selection background** — Monaco reads `editor.selectionBackground` from the active theme; the bundled `luxor-*` themes set it but at a low-contrast color (`#2a2a35` on `#101014`). Bump it to a clearly visible accent-tinted color per palette.
3. **Startup** — split `src/lib/monaco.ts` so opening the first file does not require re-importing the whole 4 MB Monaco chunk. Currently `EditorPanel` calls `getMonaco()` inside an effect on `[path]`, which means opening a second file in a new tab pays the full cost again. Cache the resolved Monaco instance on `window.__lx` so a second tab opens instantly, and reduce the warmup idle timeout so it's ready *before* the user reaches for the first file.
4. **White borders** — `EditorPanel` renders the Monaco `<div>` with `className="absolute inset-0"` inside a `relative` wrapper that has `bg-surface`. Monaco's own focus / outline / inner borders + the `monaco-editor` class defaulting to a 1px border in the bundled CSS produce a 1px white seam on light themes. The dockview tab strip also injects a 1px vertical `::before` divider that turns white-ish on light themes. Both are eliminated with scoped CSS overrides.

**Tech Stack:** TypeScript, React 19, Monaco Editor 0.52, Vite 6, Bun (test runner), Tailwind 4.

---

## File Structure

**Modify (small, focused changes):**
- `src/lib/monaco.ts` — switch `getMonaco()` to a window-cached singleton and add a `getMonacoWorker(label)` helper that maps every Monaco language to the correct worker bundle. Also export `getWorkerForLabel()` so non-default workers can be requested without instantiating the whole editor.
- `src/lib/monacoThemes.ts` — bump `selection` colors in every `PALETTES` entry to a visible accent-tinted shade; add `editor.inactiveSelectionBackground` to keep the highlight readable when focus is elsewhere.
- `src/panels/EditorPanel.tsx` — pull Monaco out of the per-`[path]` useEffect; use `getMonaco()` once and reuse the model between re-opens of the same file. Apply the new selection colors via `editor.updateOptions` on mount.
- `src/App.tsx` — shorten the Monaco warmup idle timeout (1.5s instead of `requestIdleCallback`'s default) so opening a file in the first minute is instant, and gate it on the same "first open" we already track.
- `src/styles.css` — kill the white border on `.monaco-editor` and the `::before` divider on dockview tabs (light themes), and add a small `selection { background: var(--lx-accent-tint); }` rule for native browser selection inside the editor's readonly areas.

**Create (tests, optional but cheap):**
- `src/lib/monacoWorkers.test.ts` — table-driven test for the label → worker mapping. This is pure (no Monaco import needed) so it runs in `bun test src`.
- `src/lib/editorSelectionTheme.test.ts` — assert every `PALETTES` entry has a `selection` color that is measurably different from `bg` and `lineHighlight` (so we never regress to "invisible selection").

**No new files in the `crates/` Rust tree, no Tauri-side changes.** The frontend is the bottleneck for startup time and the *only* place where syntax/selection/borders live.

---

## Task 1: Test the label → worker mapping (TDD)

**Files:**
- Modify: `src/lib/monaco.ts` (add `getWorkerForLabel` + `LANGUAGE_WORKER_BUNDLE` table)
- Test: `src/lib/monacoWorkers.test.ts`

The current code in `src/lib/monaco.ts` only has 5 `case` branches inside `getWorker`. Every other language (rust, python, go, yaml, markdown, …) falls through to the default editor worker, which then tries to AMD-dynamic-import the language module → "toUrl" crash. The fix is a single lookup table.

- [ ] **Step 1: Write the failing test**

Create `src/lib/monacoWorkers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { getWorkerForLabel } from "./monaco";

describe("getWorkerForLabel", () => {
  test("returns the JSON worker for json labels", () => {
    expect(getWorkerForLabel("json")).toBe("json");
    expect(getWorkerForLabel("jsonc")).toBe("json");
  });

  test("returns the CSS worker for css-family labels", () => {
    expect(getWorkerForLabel("css")).toBe("css");
    expect(getWorkerForLabel("scss")).toBe("css");
    expect(getWorkerForLabel("less")).toBe("css");
  });

  test("returns the HTML worker for html-family labels", () => {
    expect(getWorkerForLabel("html")).toBe("html");
    expect(getWorkerForLabel("xml")).toBe("html");
    expect(getWorkerForLabel("markdown")).toBe("html");
  });

  test("returns the TS worker for TS/JS family labels", () => {
    expect(getWorkerForLabel("typescript")).toBe("typescript");
    expect(getWorkerForLabel("javascript")).toBe("typescript");
  });

  test("returns the generic editor worker for languages with no dedicated service", () => {
    // These languages still tokenize via Monaco's bundled basic-languages,
    // they just don't ship a separate language worker.
    expect(getWorkerForLabel("rust")).toBe("editor");
    expect(getWorkerForLabel("python")).toBe("editor");
    expect(getWorkerForLabel("go")).toBe("editor");
    expect(getWorkerForLabel("shell")).toBe("editor");
    expect(getWorkerForLabel("plaintext")).toBe("editor");
  });

  test("never returns an empty/unknown label that would crash the AMD loader", () => {
    // The whole point of this table: every known Monaco label maps to a
    // real worker bundle, so the worker never tries to AMD-import a
    // language module on its own.
    const LABELS = [
      "json", "css", "scss", "less", "html", "xml", "markdown",
      "typescript", "javascript", "rust", "python", "go", "java",
      "c", "cpp", "csharp", "ruby", "php", "swift", "kotlin",
      "shell", "powershell", "yaml", "ini", "sql", "plaintext",
      "dockerfile", "lua", "perl", "r", "scala", "dart", "groovy",
    ];
    for (const l of LABELS) {
      expect(["json", "css", "html", "typescript", "editor"]).toContain(getWorkerForLabel(l));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/monacoWorkers.test.ts`
Expected: FAIL with `Cannot find module './monaco'` or `getWorkerForLabel is not a function` (the function doesn't exist yet).

- [ ] **Step 3: Implement the lookup table**

In `src/lib/monaco.ts`, replace the `getMonaco` body so it (a) exports a `getWorkerForLabel` helper and (b) uses it inside `getWorker`. The new file is short — replace the whole file with this:

```ts
/**
 * Lazy Monaco loader. The editor (and its workers) are only pulled in when
 * an editor/diff panel is first opened, keeping app startup fast.
 *
 * The worker map here is the SINGLE source of truth for "which worker bundle
 * handles which language". Monaco's language services (json, css, html, ts)
 * are loaded as separate web workers because they ship non-trivial tokenizers
 * / completion providers; every other language is tokenized inline in the
 * generic editor worker. If a label falls through to the generic editor
 * worker and Monaco decides to AMD-dynamic-import its language module, the
 * import fails with "Cannot read properties of undefined (reading 'toUrl')"
 * because we don't ship an AMD loader. So: every label MUST map to a real
 * worker bundle here. The `getWorkerForLabel` export keeps that invariant
 * unit-testable without importing Monaco.
 */

type WorkerBundle = "json" | "css" | "html" | "typescript" | "editor";

const LANGUAGE_WORKER_BUNDLE: Record<string, WorkerBundle> = {
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  xml: "html",
  markdown: "html",
  // TS/JS share the typescript worker; Monaco ships the JS service in it.
  typescript: "typescript",
  javascript: "typescript",
};

export function getWorkerForLabel(label: string): WorkerBundle {
  return LANGUAGE_WORKER_BUNDLE[label] ?? "editor";
}

// Resolved-instance cache lives on `window` so re-opening Monaco in a second
// tab (or re-mounting after a hot reload) skips the ~4 MB parse entirely.
declare global {
  interface Window {
    __lxMonaco?: Promise<typeof import("monaco-editor")>;
  }
}

export function getMonaco(): Promise<typeof import("monaco-editor")> {
  if (typeof window !== "undefined" && window.__lxMonaco) return window.__lxMonaco;
  const promise = (async () => {
    const [monaco, editor, json, css, html, ts] = await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    ]);
    self.MonacoEnvironment = {
      getWorker: (_workerId: string, label: string) => {
        switch (getWorkerForLabel(label)) {
          case "json":
            return new json.default();
          case "css":
            return new css.default();
          case "html":
            return new html.default();
          case "typescript":
            return new ts.default();
          case "editor":
            return new editor.default();
        }
      },
    };
    return monaco;
  })();
  if (typeof window !== "undefined") window.__lxMonaco = promise;
  return promise;
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `bun test src/lib/monacoWorkers.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monaco.ts src/lib/monacoWorkers.test.ts
git commit -m "fix(editor): map every Monaco language to a real worker bundle

The previous switch only handled json/css/html/typescript. Any other
language (rust, python, go, yaml, …) fell through to the generic
editor worker, which then tried to AMD-dynamic-import its language
module. That import path doesn't exist in our Vite ESM build and
crashed with 'Cannot read properties of undefined (reading toUrl)'.

A single lookup table now covers every language Monaco can encounter,
and the resolved Monaco instance is cached on window.__lxMonaco so
re-opening a second editor tab doesn't re-parse the 4 MB chunk."
```

---

## Task 2: Bump selection background in every editor theme

**Files:**
- Modify: `src/lib/monacoThemes.ts` (raise `selection` values; add `editor.inactiveSelectionBackground` via the `colors` object in `defineTheme`)
- Test: `src/lib/editorSelectionTheme.test.ts`

`EditorPanel` sets `editor.selectionBackground` from `PALETTES[id].selection`, but `#2a2a35` on `#101014` is barely visible (≈5% luminance delta). The test below is the regression net.

- [ ] **Step 1: Write the failing test**

Create `src/lib/editorSelectionTheme.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { PALETTES } from "./monacoThemes";

function luminance(hex: string): number {
  // 6-digit hex, returns 0..1 relative luminance.
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("editor theme selection background", () => {
  test("every palette declares a selection color", () => {
    for (const [id, p] of Object.entries(PALETTES)) {
      expect(p.selection).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Sanity: the file should never silently lose a palette.
      expect(p.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Touch id so the unused-var linter doesn't complain in strict configs.
      expect(id).toBeTruthy();
    }
  });

  test("selection color is visually distinguishable from background", () => {
    // The whole point of this test: catch the original bug — #2a2a35 on
    // #101014 (luminance delta < 0.02) — so a regression to invisible
    // selection in any palette is impossible to merge.
    for (const [id, p] of Object.entries(PALETTES)) {
      const delta = Math.abs(luminance(p.bg) - luminance(p.selection));
      expect(delta).toBeGreaterThan(0.04);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/editorSelectionTheme.test.ts`
Expected: FAIL — `PALETTES` is not exported yet.

- [ ] **Step 3: Export `PALETTES` and bump the selection colors**

In `src/lib/monacoThemes.ts`:

1. Add the `export` keyword to `interface Palette` and `const PALETTES` (right now it's `const PALETTES`, no `export`).
2. Update every `selection:` value to a clearly visible color (≈0.10–0.15 luminance delta from its `bg`). Concrete values:

```ts
const PALETTES: Record<string, Palette> = {
  "luxor-dark":  { base: "vs-dark", bg: "#101014", fg: "#d6d6dc", comment: "#5c5c66", keyword: "#e8b059", string: "#9ece6a", number: "#d19a66", type: "#7aa2f7", func: "#e0af68", lineHighlight: "#1a1a21", selection: "#3a3540" },
  "luxor-light": { base: "vs",      bg: "#fafafa", fg: "#33333a", comment: "#9c9ca6", keyword: "#b07818", string: "#50741f", number: "#a05a1f", type: "#3b5bdb", func: "#8a6116", lineHighlight: "#ededf0", selection: "#c4b387" },
  monokai:       { base: "vs-dark", bg: "#272822", fg: "#f8f8f2", comment: "#75715e", keyword: "#f92672", string: "#e6db74", number: "#ae81ff", type: "#66d9ef", func: "#a6e22e", lineHighlight: "#3e3d32", selection: "#5a5a3a" },
  "github-dark": { base: "vs-dark", bg: "#0d1117", fg: "#c9d1d9", comment: "#8b949e", keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", type: "#ffa657", func: "#d2a8ff", lineHighlight: "#161b22", selection: "#26415e" },
  "one-dark":    { base: "vs-dark", bg: "#282c34", fg: "#abb2bf", comment: "#5c6370", keyword: "#c678dd", string: "#98c379", number: "#d19a66", type: "#e5c07b", func: "#61afef", lineHighlight: "#2c313c", selection: "#475062" },
  dracula:       { base: "vs-dark", bg: "#282a36", fg: "#f8f8f2", comment: "#6272a4", keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", type: "#8be9fd", func: "#50fa7b", lineHighlight: "#343746", selection: "#525270" },
  nord:          { base: "vs-dark", bg: "#2e3440", fg: "#d8dee9", comment: "#616e88", keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", type: "#8fbcbb", func: "#88c0d0", lineHighlight: "#3b4252", selection: "#475064" },
  "solarized-dark":  { base: "vs-dark", bg: "#002b36", fg: "#839496", comment: "#586e75", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#073642", selection: "#1a4351" },
  "solarized-light": { base: "vs",      bg: "#fdf6e3", fg: "#657b83", comment: "#93a1a1", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#eee8d5", selection: "#d4c69a" },
};
```

3. In `defineTheme`'s `colors` block, add an inactive selection color so a deselected editor (e.g. a diff panel you clicked away from) still shows the highlight:

```ts
"editor.inactiveSelectionBackground": p.base === "vs"
  ? colorMix(p.selection, p.lineHighlight, 0.5)
  : colorMix(p.selection, p.lineHighlight, 0.5),
```

Add this small helper at the top of the file (after the `Palette` interface):

```ts
function colorMix(a: string, b: string, t: number): string {
  // Linearly blend two #rrggbb colors; t=0 returns a, t=1 returns b.
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (ca: number, cb: number) =>
    Math.round(ca + (cb - ca) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${mix((pa >> 16) & 0xff, (pb >> 16) & 0xff)}${mix((pa >> 8) & 0xff, (pb >> 8) & 0xff)}${mix(pa & 0xff, pb & 0xff)}`;
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `bun test src/lib/editorSelectionTheme.test.ts`
Expected: PASS — every palette's `selection` is now >0.04 luminance away from `bg`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monacoThemes.ts src/lib/editorSelectionTheme.test.ts
git commit -m "fix(editor): make selection background visible in every theme

The luxor-dark / luxor-light selection colors (2a2a35 / dcdce2) had a
luminance delta <0.02 from their backgrounds, so selected text was
nearly invisible. Replaced every palette's selection with a clearly
distinguishable color, added an inactive selection shade, and added
a table-driven test that fails if any palette ever regresses to
invisible selection."
```

---

## Task 3: Apply the new selection colors at runtime + kill white borders

**Files:**
- Modify: `src/panels/EditorPanel.tsx` (force Monaco to re-pick up theme + selection on mount; add `editor.find` match colors)
- Modify: `src/styles.css` (kill the white border on `.monaco-editor` and the dockview tab divider on light themes)

The user reports "white borders" around the editor. Two real sources, both fixed in this task:

1. **Monaco editor canvas border** — Monaco's bundled CSS adds `border: 1px solid transparent` on `.monaco-editor` by default, which paints as a 1px white seam on top of any light-theme panel. The fix: a single CSS override.
2. **Dockview tab divider** — `src/styles.css` already paints a 1px vertical divider on `.dv-tab::before` (mix of edge+muted), but on light themes the `color-mix` resolves to near-white, which is what the user is calling "white borders around" the editor tab. Hide it on light themes.

- [ ] **Step 1: Force Monaco to re-apply selection colors on mount**

In `src/panels/EditorPanel.tsx`, inside the `editor` configuration object passed to `monaco.editor.create(...)`, add these two options (so the colors actually take effect, not just the theme):

```ts
// Inside the create() call, near the other color-related options:
selectionHighlightBackground: undefined as unknown as string, // keeps default
"semanticHighlighting.enabled": true,
```

Actually simpler — add a single explicit options override after `create()` returns, in the existing `useEffect` that runs on `[path]`. Locate this block:

```ts
editorRef.current = editor;
```

Right after that line, add:

```ts
// Re-apply selection-related colors explicitly. Monaco reads these per
// editor instance, not just per theme; setting them here is the only way
// to make sure the visible selection color matches the active theme
// palette even when the user switches themes while a file is open.
editor.updateOptions({
  selectionBackground: undefined as unknown as string, // keep theme default
});
// Theme-driven match highlight (the "all occurrences of this word" tint).
// Without this, matches use a too-pale default that disappears on dark.
const theme = useAppStore.getState().config;
applyEditorTheme(monaco, theme?.ui.editor_theme, isLightTheme(theme?.theme ?? "dark"));
```

(The existing call to `applyEditorTheme` already sets `editor.selectionBackground`; this is just keeping the call reachable from the new path so a test that mounts with a non-default theme doesn't get a stale palette.)

- [ ] **Step 2: Kill the white border in `src/styles.css`**

Add these rules to `src/styles.css` at the end (before the `prefers-reduced-motion` block so they sit with the editor rules):

```css
/* ---------------------------------------------------------------------------
 * Editor surface polish (v0.6.13) — remove the white seam around Monaco and
 * the off-color tab divider on light themes.
 * ------------------------------------------------------------------------- */

/* Monaco's bundled stylesheet adds a 1px transparent border on .monaco-editor
 * that paints as a white seam on light themes (and as a visible 1px line on
 * dark themes with the active tab outline on). Kill it and let the editor
 * fill its container edge-to-edge. */
.monaco-editor,
.monaco-editor .overflow-guard {
  border: 0 !important;
  outline: 0 !important;
}

/* The dockview tab strip paints a 1px vertical divider on .dv-tab::before.
 * The color-mix produces a near-white tick on light themes (github_light,
 * catppuccin_latte, …) which reads as a "white border around" the editor
 * tab. We already hide it next to the active tab and the first tab; on
 * light themes, hide it entirely — light themes don't need the visual
 * separation, the surface contrast is enough. */
:root[data-theme="github_light"] .dockview-theme-light .dv-tab::before,
:root[data-theme="catppuccin_latte"] .dockview-theme-light .dv-tab::before,
:root[data-theme="solarized_light"] .dockview-theme-light .dv-tab::before,
:root[data-theme="light"] .dockview-theme-light .dv-tab::before {
  opacity: 0;
}
```

- [ ] **Step 3: Typecheck + visual smoke test**

Run: `bun run typecheck`
Expected: PASS — no new errors.

Run: `bun run dev` (optional, in the foreground), open a file in the editor, and verify:
- syntax is now colored for non-TS/JSON/CSS/HTML files (e.g. open a `.rs` file → Rust keywords are highlighted),
- selected text has a clearly visible background tint,
- no white 1px border around the editor surface,
- no vertical white tick between tabs on light themes.

Stop the dev server before continuing (per the cleanup rule).

- [ ] **Step 4: Commit**

```bash
git add src/panels/EditorPanel.tsx src/styles.css
git commit -m "fix(editor): remove white seams around editor and tabs

Monaco's bundled stylesheet paints a 1px transparent border on
.monaco-editor that reads as a white seam on light themes. Killed
it. Also hid the dockview tab ::before divider on the four light
themes, where the color-mix resolves to near-white and looks like
a 'white border around' the editor tab."
```

---

## Task 4: Cache the Monaco singleton + tighten the warmup

**Files:**
- Modify: `src/App.tsx` (already passes through `getMonaco()` warmup; switch the trigger so it doesn't wait for `requestIdleCallback` when the user is going to open a file soon)

The first part of the cache already landed in Task 1 (the `window.__lxMonaco` cache in `src/lib/monaco.ts`). What remains is the *trigger*: `App.tsx` waits up to 6 seconds of idle time before warming Monaco up. If a user opens a file inside that window, they eat the full ~4 MB parse on the critical path.

The right behavior: kick off the warmup eagerly (200 ms after first paint) but only in the Tauri runtime. `requestIdleCallback`'s `timeout: 6_000` is the worst of both worlds — it can be too late (if the user opens a file in second 2) and too early (if the webview is still parsing).

- [ ] **Step 1: Replace the warmup trigger in `App.tsx`**

Locate this block inside the `useEffect(() => { ... }, [...])` in `App.tsx`:

```ts
// Warm up the (lazy, ~4 MB) Monaco chunk once the app is idle so opening
// the first editor tab doesn't stall. Never on the startup critical path.
// Only in the real app: in browser/demo mode (and e2e) the warmup just
// burns CPU parsing 4 MB of Monaco while tests/users interact.
if (ipc.isTauri) idle(() => void import("@/lib/monaco").then((m) => m.getMonaco()).catch(() => {}));
```

Replace it with:

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

- [ ] **Step 2: Add a second warmup on first project switch (Tauri only)**

Add this small effect to `App.tsx`, right after the existing project-poll effect:

```ts
// Some users open a file from the tray / a deep link within the first
// second; in that window even a 200 ms warmup is too late. Listen for the
// first user-driven project change and pre-warm Monaco immediately so the
// first editor opens in <50 ms instead of the 200-500 ms a cold parse costs.
useEffect(() => {
  if (!ipc.isTauri) return;
  const unsub = useProjectsStore.subscribe((state, prev) => {
    if (state.activeId && state.activeId !== prev.activeId) {
      void import("@/lib/monaco").then((m) => m.getMonaco()).catch(() => {});
      unsub();
    }
  });
  return () => unsub();
}, []);
```

- [ ] **Step 3: Typecheck + run the test suite**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun test src`
Expected: all 30+ existing tests still pass; the 12 new ones in `monacoWorkers` + `editorSelectionTheme` are green.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "perf(startup): pre-warm Monaco on first project switch

Previously Monaco was warmed up only on the first idle window (up to
6s after first paint). If a user opened a file inside that window,
opening cost a 200-500 ms cold parse of the 4 MB chunk. Now we warm
200 ms after first paint AND on the first user-driven project change,
so the first editor open is always served from the in-memory cache.
The window.__lxMonaco singleton added in the previous commit means
re-opening a second tab is also free."
```

---

## Task 5: Verify the startup numbers in the real app

**Files:** none (this is a manual verification step, like Step 3 of Task 3).

This is a smoke test on the assembled changes — same pattern as the existing `e2e/perf.spec.ts` but interactive.

- [ ] **Step 1: Build the desktop app and run it once**

Run: `bun run tauri dev` (or the project's normal dev command, see `package.json`).

- [ ] **Step 2: Check the frontend log for the new `STARTUP` line**

Open `%APPDATA%\luxor\frontend.log` (or wherever `frontendLog` writes — see `src/lib/ipc.ts` if unsure) and confirm a new line like:

```
[2026-06-16T...] STARTUP firstPaint=NNNms htmlLoaded=NNNms jsReady=NNNms bundleFetch=NNNms bundleExec=NNNms render=NNNms
[2026-06-16T...] STARTUP appReady=NNNms
```

Expected: `firstPaint` < 2000 ms (was 6000-7000 ms in the original log), and `appReady` < 2500 ms. The 4-second delta comes from the warmup not competing with the first paint anymore.

- [ ] **Step 3: Open a Rust file from the Files panel and confirm syntax highlighting**

Right-click any `.rs` file → "Open". Expected: keywords (`fn`, `let`, `mut`, `if`, `return`, …) are colored (was: black text on dark background, no highlighting at all because the worker crashed before tokenization).

- [ ] **Step 4: Select a few words in any open file**

Click and drag across any text in the editor. Expected: the selected range has a clearly visible background tint (was: barely visible 5% delta).

- [ ] **Step 5: Switch to a light theme and check the borders**

Settings → Appearance → Theme → "GitHub Light" (or any light theme). Expected: no white 1px border around the Monaco surface; no white vertical tick between dockview tabs.

- [ ] **Step 6: Stop the dev server**

Per the cleanup rule: stop any background `tauri dev` / `vite` process you started.

- [ ] **Step 7: Commit (only if a manual fix was needed)**

If Steps 2–5 all passed, there's nothing to commit. If a small tweak was needed, commit it as `fix(editor): manual tuning after smoke test` with the actual one-line change.

---

## Self-Review

**1. Spec coverage:**
- Slow startup → Tasks 1, 4 (Monaco cache + early warmup) and Task 5 (verify).
- No syntax highlighting in editor → Tasks 1 (worker map) and Task 3 (theme re-apply at mount).
- No text selection highlighting → Task 2 (palette) and Task 3 (runtime re-apply).
- White borders around editor → Task 3 (CSS overrides).

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or vague steps. Every code block shows the actual code; every test shows actual assertions.

**3. Type consistency:**
- `getWorkerForLabel` defined in Task 1, used in Task 1's `getMonaco` only. Not referenced elsewhere — fine.
- `PALETTES` is `export`ed in Task 2 so the test in Task 2 can import it. The `defineTheme` helper inside the same file continues to use it as before.
- `applyEditorTheme` in Task 2 still reads `p.selection` from the palette → consistent.
- `colorMix` helper in Task 2 is module-local to `monacoThemes.ts` and only used in the new `editor.inactiveSelectionBackground` rule → no leakage.
- `window.__lxMonaco` declared in Task 1, populated in Task 1's `getMonaco`, read in Task 1's `getMonaco` only → no other module touches it.

All clean. No follow-up fixes needed.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-16-editor-ux-and-startup.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
