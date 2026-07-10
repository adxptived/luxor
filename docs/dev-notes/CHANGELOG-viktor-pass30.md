# Viktor pass30

Focused follow-up to pass29: make Git diff clean like the reference screenshot, remove duplicated chrome actions, and add deeper UI customization.

## Git diff viewer

- Reworked diff visuals back toward a clean Monaco-style view:
  - much softer red/green line backgrounds;
  - quieter gutter/change markers;
  - no heavy custom inline/full-pane decoration layer;
  - native Monaco token-level diff coloring is allowed to stay readable.
- Reduced overview-ruler intensity and disabled noisy move highlighting.
- Kept side-by-side/inline controls and compact changed-line counters.

## Top bar / sidebar customization

- Removed the duplicated gear/settings button from the horizontal top chrome.
- Added a dedicated left nav/action rail for buttons moved out of the top bar.
- Added per-button placement controls:
  - Top bar;
  - Sidebar;
  - Hidden.
- Added right-click actions to move nav buttons between the top bar and sidebar rail.
- Added reset/show/hide behavior that preserves at least one visible nav button.

## Sidebar icon placement

- Added `left_sidebar_icon_position` setting: top / middle / bottom.
- Applied it both to the collapsed left side panel and the new left nav rail.
- Added Settings UI for the placement.

## Tabs and visual polish

- Fixed active project-tab underline to be inset/rounded instead of full-width.
- Fixed Dockview active tab indicator to respect the configured tab radius with an inset rounded accent pill.
- Expanded accent color presets from 6 to 14 options.
- Kept custom accent color input and theme selection working together.

## Config / dev-preview support

- Added matching TypeScript and Rust config fields for:
  - `left_sidebar_icon_position`;
  - `nav_sidebar`.
- Extended browser/mock IPC Git data so UI screenshots and browser dev preview can exercise the Git diff panel without a native Tauri backend.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed.
- `bun run build` passed.
- Rust/Tauri compile was not run in this sandbox because `cargo`/`rustc` are unavailable.
