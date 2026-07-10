# Viktor pass36

Two requests: (1) fix & improve the built-in file-explorer UI/UX ("inconvenient
+ ugly"), and (2) the gradient — remove it OR make the active tab blend nicely
with it at the bottom.

## 1. Editor toolbar gradient / active-tab seam

The pass35 editor toolbar had a top sheen + a lighter `bg-bar` background, so the
active tab (content colour) didn't melt into it — a visible step/seam appeared
right under the selected tab.

- The toolbar now shares the **content (surface) colour**, so the active tab's
  flat bottom melts straight into it — no seam (browser / VS Code style).
- Depth now comes from a **faint shade at the bottom only** (never the top edge)
  plus the existing bottom border, so the tab always sits flush on top.
- `EditorPanel.tsx`: toolbar `bg-bar/45` → `bg-surface`; `styles.css`:
  `.lx-editor-toolbar` gradient flipped from top-light to a subtle bottom shade,
  dropped the backdrop blur.

## 2. File explorer UI/UX (FilesPanel)

- **Denser, tidier rows:** fixed compact row height, removed the loose
  per-row gap, smaller corner radius — far more files visible, easier to scan.
- **Indent guide lines:** thin vertical guides per nesting level so the tree
  hierarchy is easy to follow at a glance.
- **Cleaner states:** folders are bold, files slightly dimmed (brighten on
  hover); selected / open-preview rows use a left accent bar instead of the
  heavy ring outline; calmer hover.

## Files touched

- `src/panels/EditorPanel.tsx`, `src/styles.css` — toolbar colour / gradient.
- `src/panels/FilesPanel.tsx` — explorer rows, indent guides, states.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (240 tests).
- `bun run build` passed.
- Verified in the dev preview: tab→toolbar seam (before/after) and the file
  explorer (before/after, with folders expanded).
- Rust/Tauri not compiled here (`cargo`/`rustc` unavailable in the sandbox).
