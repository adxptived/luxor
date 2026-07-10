# Code audit — v0.4.1

Scope: full pass over `crates/luxor-core`, `src-tauri`, and the React frontend while fixing the v0.4.0 bug reports. Verified with `cargo test -p luxor-core` (85 tests), `bun test src` (36 tests), `tsc --noEmit`, and a production `vite build`.

## Root causes of the reported bugs

1. **`project_add_blank not found`** — the command was implemented in `src-tauri/src/commands/projects.rs` but missing from the `generate_handler![]` list in `lib.rs`. There is no compile-time guarantee that commands are registered.
   *Recommendation:* add a CI grep that every `#[tauri::command]` appears in `lib.rs`, or an e2e smoke test that calls each command once.
2. **Frozen UI when switching tabs** — `DockLayout` hid inactive docks with Tailwind `invisible` (`visibility: hidden`). Dockview re-applies `visibility: visible` to its internal nodes, so an inactive dock's terminal could sit on top of the active dock and swallow keyboard/mouse input. Fixed with `opacity-0 + pointer-events-none + z-index`, which children cannot override.
3. **Broken drag & drop (splitting, kanban, sidebar, status bar)** — Tauri 2 enables its native drag-drop handler by default (`dragDropEnabled`), which consumes HTML5 drag events inside the webview on Windows. Luxor has no native file-drop feature, so it is now disabled in `tauri.conf.json`.

## Other findings (fixed in this release)

- `market::fetch_catalog` hit the network on every Market-tab mount, and `fetch_skill_md` tried up to 8 candidate URLs *sequentially* → multi-second installs. Now: 1-hour on-disk catalog cache (atomic write, stale-cache offline fallback) and a parallel race over the candidate URLs.
- Launcher/file-manager/IDE buttons reported nothing on success; failures of fire-and-forget IPC calls were easy to miss. All quick actions now toast success and error.
- Narrow sidebar clipped button labels: rows lacked `min-w-0` + `truncate` (flexbox refuses to shrink below content size without it). Audited all sidebar/menu rows.
- `closeTab` always confirmed; no fast path. Added Shift+click (tabs and kanban cards) as a consistent "quick action" modifier.

## Findings *not* addressed (candidates for 0.4.2)

- **Bundle size**: the main JS chunk exceeds 500 kB minified. `xterm`, `dockview`, and markdown rendering could be code-split per panel.
- **`expect("registry lock")`** in command handlers will panic (→ webview error) if a previous panic poisoned the mutex. Consider `parking_lot` or mapping poison to a recoverable error.
- **Command-history capture is heuristic** (keystroke reconstruction): arrow-key shell-history recalls are deliberately not recorded (the line is "poisoned"). Real fidelity would require shell integration (OSC 133 prompt marks) — worth doing later; xterm.js supports decorations for it.
- **`recent_projects` table grows unbounded** in theory; `recent_list` limits reads, but a periodic prune (e.g. keep newest 50) would be cleaner.
- **No rate limit / debounce on `stats_sample`** polling when the status bar shows many segments; cheap but measurable on battery.
- e2e suite doesn't cover multi-project tab switching (the frozen-tab regression would have been caught). Suggest a Playwright test that opens two projects and types in a terminal after switching.

## Test inventory after this release

- Rust: 85 unit tests (`cargo test -p luxor-core`) — includes new coverage for the catalog cache, terminal/shell detection, cwd argument planning, and the recent-projects registry.
- Frontend: 36 unit tests (`bun test src`) — includes the command-history parser/store and agent-prompt builders.
- E2E: existing Playwright suite (`bun run e2e`) unchanged.
