# Viktor pass33

Polish round on the Dockview tabs after feedback: "taller + the selected tab
must really merge with the colour below, beautifully."

## Tabs

- **Taller tab strip:** `--dv-tabs-and-actions-container-height` 35px → 42px,
  and tabs now fill the full strip height (`.dv-tab { height: 100%; margin: 0 }`,
  removed `align-items: flex-end`). Previously the strip got taller but the tabs
  stayed short and bottom-aligned, which left a thin bar gap under the active
  tab — that gap is gone.
- **Active tab really merges with the content below:** the selected tab uses the
  exact content-area colour (`--lx-surface`), has no bottom border, and its
  bottom edge lands precisely on the panel's top edge — so the tab melts
  seamlessly into the content with no seam or colour step.
- **More beautiful:** rounded top corners (9px), a crisp 1px top highlight, a
  hairline top/side border, and a soft upward shadow that lifts the active tab
  off the strip. Smooth transitions on hover/active. Refined favicon opacity
  (muted when inactive, near-full when active), `font-medium` title on the
  active tab, and a circular close ✕ with a clean hover state.

## Files touched

- `src/styles.css` — strip height, full-height tabs, active-tab merge + polish.
- `src/layout/DockLayout.tsx` — favicon/title/close-button refinements.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (238 tests).
- `bun run build` passed.
- Verified visually in the dev preview (mock IPC), dark theme, against the
  reference.
- Rust/Tauri compile not run in this sandbox (`cargo`/`rustc` unavailable).
