# Luxor 0.6.12 — Viktor pass29

Focused follow-up pass for the requested Git diff readability, top bar/sidebar layout polish, and extra startup/runtime optimization.

## Git diff viewer

- Strengthened the diff editor colors across Luxor Monaco themes:
  - green inserted text/line/gutter/overview regions;
  - red removed text/line/gutter/overview regions;
  - clearer inline character highlights.
- Added a compact diff summary in the header with `+added` and `−removed` badges.
- Reworked the diff toolbar into a small segmented `Inline` / `Split` control.
- Enabled Monaco diff overview ruler and indicators so additions/removals are visible on the scrollbar/overview.
- Enabled unchanged-region hiding for large diffs with preserved context, making real changes easier to see.
- Added Luxor CSS accents plus explicit editor decorations for inserted/removed lines and signs so the view remains readable on custom themes and screenshots clearly show red/green regions.

## Top bar / sidebar UI

- Replaced arrow/chevron-style chrome controls with square reference-style buttons.
- Grouped top chrome actions more logically:
  - terminal / new panel;
  - left/right sidebar toggles;
  - files/settings;
  - native minimize/maximize/close.
- Added active square states for enabled left/right panels.
- Converted nav buttons, add-tab button, quick actions, and collapsed side-rail icons to the same square-button language.
- Reduced duplicated controls in the horizontal top bar: external quick launchers now live in the sidebar/vertical rail path instead of crowding the top bar.
- Replaced tab-group chevrons with compact square +/− indicators.

## Optimization

- Deferred IDE detection in QuickActions until an actual project path exists, and then scheduled it during idle time instead of startup-critical render.
- Skipped Git/recent-project side-panel polling while the left panel is collapsed to icon rail mode.
- Filtered a known benign hidden-terminal resize exception from user-facing global error toasts, reducing UI noise without hiding real failures.
- Kept previous pass startup deferrals for presets, Monaco warmup, and gateway status.

## Validation

- `bun run typecheck` ✅
- `bun test src` ✅ — 238 tests passing
- `bun run build` ✅
- Rust/Tauri compile check was not run in this sandbox because `cargo`/`rustc` are unavailable.
