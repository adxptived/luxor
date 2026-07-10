# Viktor pass32

Follow-up to pass31 after reference feedback: the Dockview tabs now read as
real browser / VS Code tabs.

## Tabs (Dockview tab strip)

- **Favicon per tab:** each tab now shows an icon in front of the title,
  picked from the panel type (Git → branch, Files → folder tree, Welcome →
  sparkles, terminal, editor, diff, etc.). New helper `tabIcon()` +
  `TAB_ICONS` map in `src/layout/DockLayout.tsx`.
- **Wider, contiguous tabs:** tabs got a `min-width` and sit flush against each
  other (no gaps) so the strip looks like a browser tab bar; the title fills the
  middle with the close ✕ pinned to the right edge of each tab.
- **Rounded corners + merge with the panel:** the active tab now takes the
  content-area colour (`--lx-surface`) and merges seamlessly into the panel
  below it — rounded top corners, a thin top/side outline, and no bottom edge
  or seam (VS Code / browser style). Bumped `--lx-tab-radius` to 9px.
- Visible thin vertical dividers between neighbouring inactive tabs, auto-hidden
  around the active/hovered tab.
- Close ✕ stays visible on every tab.

## Files touched

- `src/layout/DockLayout.tsx` — tab favicons + browser-tab layout (icon, flex,
  close button).
- `src/styles.css` — tab strip styling (widths, dividers, active tab merge,
  radius).

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (238 tests).
- `bun run build` passed.
- Verified visually in the browser dev preview (mock IPC) against the reference
  screenshot, dark theme.
- Rust/Tauri compile not run in this sandbox (`cargo`/`rustc` unavailable).
