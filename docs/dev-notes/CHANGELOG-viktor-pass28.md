# Viktor pass 28 — custom chrome, sidebar rail, browser/diff polish

## What changed
- Replaced the native Windows titlebar for Luxor windows with frameless Tauri windows and a custom in-app chrome inspired by the reference screenshot.
- Added top chrome quick actions near the window controls: new terminal, panel menu, left sidebar collapse/expand, right sidebar show/hide, files/settings shortcuts.
- Added minimize / maximize / close controls in the custom chrome and kept a drag region in the top bar.
- Added animated left sidebar icon-rail mode: the left side panel can collapse to clickable icons instead of disappearing; double-click/expand returns it to full width.
- Kept the right sidebar behavior as a true hide/show panel with smooth disappearance and exposed it in the top controls.
- Added a configurable tab rounding setting (`Interface → Tab rounding (px)`) with a subtle default of 7px, applied to project tabs and Dockview tabs.
- Fixed the embedded browser viewport sizing path to avoid shifted/white bottom seams on fractional DPI/zoom/dock animation frames.
- Hardened Git diff layout: explicit Monaco layout sizing, overflow clipping, split-view resizing, delayed relayouts after Dockview settles, and automatic inline fallback on narrow panels.
- Deferred non-critical startup work (layout presets, Monaco warmup, gateway status probe) off the first paint path.

## Validation
- `bun run typecheck` ✅
- `bun test src` ✅ — 238 tests passed
- `bun run build` ✅
- Rust/Cargo checks were not run in this sandbox because `cargo`/`rustc` are not installed here.
