# Viktor pass31

Visual polish follow-up to pass30, driven by reference screenshots:
make the Dockview tabs look like a modern browser tab strip, and remove the
vertical green/red bars next to the +/- markers in the Git diff viewer.

## Tabs (Dockview tab strip)

- Reworked the active tab from a coloured accent underline into a lighter,
  raised "card" fill — it now reads as a clearly selected tab the way browser
  tabs do, instead of a flat row with a thin amber line.
- Inactive tabs are fully transparent against the bar; on hover they get a soft
  raised tint.
- Added thin vertical dividers in the gap before each tab (chrome-style),
  automatically hidden on the first tab and on both sides of the active/hovered
  tab so the selected card floats cleanly.
- Themed Dockview's tab colours to the Luxor palette
  (`--lx-bar` / `--lx-raised` / `--lx-edge` / `--lx-strong` / `--lx-muted`)
  so the strip matches every theme, light and dark.
- The close (✕) button is now visible on every tab (muted by default, full on
  hover/active) instead of only appearing on hover.
- Light theme uses the surface colour for the active tab so it stays lighter
  than the bar there too.

## Git diff viewer

- Removed the vertical green/red edge stripes that sat right next to the
  `+` / `-` signs:
  - dropped the `box-shadow: inset 2px 0 0` left bar on `.line-insert` /
    `.line-delete`;
  - dropped the `border-left: 2px solid` stripe on the changed-line gutter
    decorations (`.lx-diff-gutter-added` / `.lx-diff-gutter-removed`).
- Kept the soft full-row background tint and the native `+` / `-` signs, so
  added/removed lines stay easy to read — just without the harsh coloured bars.

## Files touched

- `src/styles.css` — tab strip styling + diff stripe removal.
- `src/layout/DockLayout.tsx` — always-visible tab close button.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (238 tests).
- `bun run build` passed.
- Changes verified visually in the browser dev preview (mock IPC) with
  before/after screenshots of the tab strip and the inline Git diff.
- Rust/Tauri compile was not run in this sandbox because `cargo`/`rustc` are
  unavailable.
