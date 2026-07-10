# Viktor pass35

Two requests: (1) add a Settings option to choose whether the active tab has an
outline or not, and (2) improve the file-editor UI/UX ("ugly + inconvenient").

## 1. Active tab outline — now a setting

- New toggle **Settings → Interface → "Active tab outline"**.
  - **Off (default):** selection shown by background colour only — the active
    tab melts into the panel below it (the pass34 look).
  - **On:** the active tab gets a visible border on top + sides plus a soft
    upward lift, so it reads as a distinct raised card.
- Wiring: `tab_outline: boolean` added to `UiConfig`; applied as a
  `data-tab-outline="on|off"` attribute on `<html>`; CSS variant in
  `styles.css`. Default `false`.

## 2. File editor UI/UX polish

Monaco editor (`EditorPanel.tsx`):
- Comfortable **line height** (≈1.55×) — the default was cramped. Updates live
  with the font-size button.
- **Padding** top/bottom so the first/last line isn't glued to the toolbar /
  status bar.
- **Current-line highlight** across the whole row incl. the gutter
  (`renderLineHighlight: "all"`), **rounded selections**.
- **Smooth caret animation**, keep 4 lines of context around the cursor.
- Cleaner **scrollbars** (slimmer sliders, subtle shadow), no overview-ruler
  border, tidier line-number column, font ligatures + slight letter spacing.

Editor chrome (`styles.css`):
- Toolbar: subtle top sheen + blur, unified control height, focus-visible
  outlines, press feedback. Status bar tightened with hover affordance.

## Files touched

- `src/lib/types.ts`, `src/lib/ipc.ts`, `src/state/appStore.ts`,
  `src/components/SettingsModal.tsx`, `src/styles.css` — tab outline setting.
- `src/panels/EditorPanel.tsx`, `src/styles.css` — editor UI/UX.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (240 tests).
- `bun run build` passed.
- Verified in the dev preview: tab outline on/off, and editor before/after.
- Rust/Tauri not compiled here (`cargo`/`rustc` unavailable in the sandbox).
