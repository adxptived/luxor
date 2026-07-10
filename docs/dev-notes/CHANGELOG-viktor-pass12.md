# Luxor — Viktor pass 12

UI/UX overhaul + sidebar/status-bar integration + a real skills.sh search.
Base: `luxor-0.6.12-viktor-pass11`.

## Verification (all green)
- `bun node_modules/typescript/bin/tsc --noEmit` → exit 0 (strict, noUnusedLocals/Parameters).
- `bun test src` → **195 pass / 0 fail** (27 files).
- `bun run build` → built OK.
- `cargo fmt --all --check` → clean.
- `cargo clippy -p luxor-core --all-targets -- -D warnings` → **0 warnings**.
- `cargo test -p luxor-core` → **202 pass / 0 fail**.

> GUI-only behaviour is verified via typecheck + unit tests + a successful production build; the desktop shell (`src-tauri`) can't run here (no webkit/gtk), so visual look-and-feel is best-effort and should be eyeballed on your machine.

---

## 1 — Settings & About redesign
- `SettingsModal.tsx`: rebuilt the **About** tab — hero card with app icon + version badge, three link cards (repo / issues / skills.sh) via a new `AboutLink` component, an "Updates" card and a copyright line. (Uses `Code2` — this lucide build has no `Github` icon.)

## 2 — Agents detection + working **Kill** button
- `procs.rs`: rewrote `kill_process` — `process_alive()` treats Zombie/Dead as gone; SIGKILL → 120 ms → refresh → retry survivors → 80 ms → verify. Returns `NotFound` if the PID never existed and a real `Process` error if the target is still alive (no more silently-failing kills where the row reappears). New `error.rs` `Process` variant. Tests: `kill_unknown_pid_is_not_found`, `kill_terminates_a_real_child`.
- `agents.rs`: widened the interpreter-arg scan (`take(5)` → `take(10)`) so more agent CLIs are detected.
- `AgentsPanel.tsx`: per-row killing spinner + disable, success/real-error toasts, automatic re-poll, and a manual refresh button.

## 3 + 4 — Welcome & blank-workspace tabs
- `WelcomePanel.tsx`: removed the "Your cockpit for AI-assisted coding…" tagline; rewrote into two thoughtful variants (project vs. blank workspace). The blank variant no longer shows a "New blank workspace" button. Wired through `dockStore.ts` + `DockLayout.tsx`.

## 5 — Default left sidebar = Terminal, Git, Files, Settings only
- `lib/navButtons.ts`: `DEFAULT_VISIBLE_NAV` / `DEFAULT_NAV_HIDDEN`; `config.rs` `default_nav_hidden()` + `UiConfig` default; one-time migration in `App.tsx` (`luxor.navDefaultsV2`) so existing users get the new defaults once without losing later customisation.

## 7 — Embedded browser
- `BrowserPanel.tsx`: added real **back / forward / home** history + a loading state (spinner replaces the globe while a page loads). Pure, tested history helpers (`pushHistory`, `stepHistory`, `canGoBack/Forward`) — 5 unit tests. (Full inline rendering is still bounded by site `X-Frame-Options`; blocked sites still promote to a native window, which already worked.)

## 8 — No more blank grey void
- New `EmptyDock.tsx` ("Nothing open" state with quick actions) shown whenever the dock has no panels open.

## 9 + 10 — Right-sidebar animation / jank
- `RightPanel.tsx` **and** `SidePanel.tsx`: rAF-driven open/close with a smooth `transition-[width]` (200 ms ease-out), content fade, and `onTransitionEnd` unmount — no more jerky pop-in. Respects `prefers-reduced-motion`.

## 11 — Focus timer no longer resets when the sidebar is hidden + status-bar integration
- New shared store `state/focusTimerStore.ts` (persisted to `localStorage`, single global 1 s watcher fires the completion toast even with every sidebar closed). The right-panel `TimerWidget` now reads/writes this store, so hiding/showing the sidebar — or reloading the window — keeps the countdown running.
- **Status-bar integration:** new `timer` segment shows the live countdown while a session runs; click to pause/resume. Added the `show_timer` config flag (Rust `StatusBarConfig` + TS types + ipc default + a Settings toggle). Tests: `fmtClock`, `remainingOf`.

## 12 — Skills manager + real skills.sh search & integration
- **Real search.** Previously the "filter" only matched the cached homepage (top featured skills). Now there's a live full-text search against `https://skills.sh/api/search`, which covers the **entire** catalog.
  - `market.rs`: `search_catalog()` + `parse_search_json()` (preserves server relevance order, dedupes). Tests: `parses_search_results_preserving_order_and_dedupes`, `search_json_garbage_yields_no_entries`.
  - New Tauri command `market_search` (`src-tauri/commands/market.rs` + `lib.rs`), `ipc.marketSearch()` + mock.
- **Market UX:** `SkillsPanel.tsx` — debounced (300 ms) search box with a search icon, inline spinner and clear (✕) button; a context line ("N results for … on skills.sh" / "Top skills · type to search the full catalog"); hover-reveal "open on skills.sh"; non-GitHub registry sources (smithery.ai, modelscope.cn, …) now show an **Open** button instead of a broken Install. Helper `isInstallable()` + 3 tests.

## 1 & 6 — General polish
- Status-bar `timer` segment, market cards, About cards, smoother panel transitions and consistent hover affordances across the panels touched above.

## Files touched (highlights)
- Frontend: `panels/WelcomePanel.tsx`, `panels/EmptyDock.tsx`, `panels/BrowserPanel.tsx`, `panels/SkillsPanel.tsx`, `components/RightPanel.tsx`, `components/SidePanel.tsx`, `components/StatusBar.tsx`, `components/SettingsModal.tsx`, `components/AgentsPanel.tsx`, `state/focusTimerStore.ts`, `lib/navButtons.ts`, `lib/statusSegments.ts`, `lib/types.ts`, `lib/ipc.ts`, `layout/dockStore.ts`, `layout/DockLayout.tsx`, `App.tsx`, `TopBar.tsx`.
- Rust: `crates/luxor-core/src/{procs,error,agents,config,market}.rs`, `src-tauri/src/commands/market.rs`, `src-tauri/src/lib.rs`.
- Tests added: focus timer, browser history, skills `isInstallable`, market search parser, kill-process behaviour.
