# Luxor 0.6.12 — Viktor pass24

Focus: continue polishing DevTools and make the file editor feel more like a real IDE.

## DevTools / Run tab

- Added an **IDE workspace actions** card at the top of DevTools → Run:
  - open Files panel;
  - open project Search;
  - open Git panel;
  - create an integrated terminal tab in the project root;
  - open an external terminal in the project root;
  - reveal the project folder in the OS file manager;
  - open the project with detected/custom external IDEs.
- The card deduplicates custom and detected IDE entries and adapts the amount of visible IDE chips in compact panel widths.
- Existing executable search/launcher from pass23 remains in place below the workspace actions.

## File editor / IDE feel

- Moved language detection into a shared `editorLanguage` helper and expanded syntax detection for common IDE files:
  - TypeScript/JavaScript variants;
  - Rust, Python, Go, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin;
  - JSON/JSONC, HTML, CSS/SCSS/Less, Markdown, YAML, TOML/INI/ENV, XML/SVG, SQL;
  - Dockerfile variants, Makefile, Justfile, Procfile, CMakeLists.txt, `.env.*`, `.editorconfig`, `.gitignore`, `.dockerignore`, `.npmrc`.
- Added an editor toolbar with:
  - Save button;
  - Find and Replace buttons;
  - editor command button;
  - syntax language picker;
  - theme picker using the configured Monaco theme list;
  - quick font-size cycling;
  - whitespace visibility toggle;
  - shortcuts/help toggle.
- Added Monaco IDE-like editor options:
  - bracket-pair colorization;
  - bracket/indent guides;
  - sticky scroll;
  - smooth scrolling;
  - smoother cursor blinking;
  - persisted whitespace visibility and editor font size.
- Added keyboard affordances/help:
  - `Ctrl+S` save;
  - `Ctrl+F` / `Ctrl+H` find/replace;
  - `Ctrl+/` comment;
  - `Alt+Z` word wrap;
  - `Ctrl+G` go to line;
  - `Shift+Alt+F` format;
  - `F2` rename;
  - `Ctrl+Enter` preview/source toggle for Markdown/HTML.

## Tests / verification

- Added `src/lib/editorLanguage.test.ts` for syntax detection edge cases.
- Updated language status labels for newly exposed language ids.
- Verification completed:
  - `bun run typecheck` ✅
  - `bun test src` ✅ — 235 pass / 0 fail / 526 expect() calls
  - `bun run build` ✅
- Rust/Cargo tests were not needed for this pass because only frontend TypeScript code changed.
