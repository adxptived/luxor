# Luxor Architecture

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ src/  — React + TS UI                                            │
│   dockview (panel layout) · xterm.js (terminals)                 │
│   CodeMirror 6 (editor/diffs) · zustand (state) · Tailwind v4    │
├──────────────────────────────────────────────────────────────────┤
│ src-tauri/  — thin Tauri v2 shell                                │
│   IPC commands (commands/*.rs) · events · tray · AppState        │
├──────────────────────────────────────────────────────────────────┤
│ crates/luxor-core  — ALL the logic (pure Rust lib)               │
└──────────────────────────────────────────────────────────────────┘
```

**Rule: logic lives in `luxor-core`, never in `src-tauri`.** The core crate has no Tauri
dependency, builds on any machine and carries the unit tests. `src-tauri` only converts
IPC params, calls core, and forwards events. `cargo test -p luxor-core` needs no display
server or webkit.

## luxor-core modules

| Area | Modules | Notes |
| --- | --- | --- |
| Terminals | `pty`, `procs`, `agents` | `portable-pty` sessions with an output callback; process-tree stats; detection of AI CLI agents |
| Git & GitHub | `gitx`, `github` | libgit2 via `git2` (no git CLI); GitHub issues/PRs/Actions over REST |
| Projects & layout | `projects`, `layout`, `notes`, `cli` | SQLite project registry; versioned layout presets (`PRESET_VERSION`); notes/snippets/bookmarks; `luxor <path>` hand-off |
| Files & search | `fsx`, `search`, `skills` | PathGuard-confined filesystem, encodings, SQLite viewer; project find & replace; agent-skill folders |
| Config & secrets | `config`, `secrets`, `redact`, `error` | `config.toml`; OS keychain (`luxor` service, `git:{host}`); secret redaction for logs; one `Error` enum serialised as `{kind, message}` |
| Launcher & tools | `launcher`, `devtools`, `dockerx`, `httpx`, `colors`, `updatex` | external terminals/IDEs; `.env`/logs/disk/deps; Docker CLI wrapper; REST scratch pad; colour tools; update check against GitHub Releases |
| Local analytics | `telemetry`, `insights`, `cards`, `audit`, `metricprovider`, `activity_os`, `active_window`, `stats` | WakaTime-style tracker in `local_stats.db`, rule-based insights, shareable SVG cards, static project audit, OS idle/active-window probes, system stats |
| Diagnostics | `diag`, `crashlog` | frontend event log, panic-hook crash reports |

## IPC

- All commands are registered in `src-tauri/src/lib.rs`; `src-tauri/tests/commands_registered.rs`
  fails if a command exists but is not in the handler list.
- Params are snake_case structs mirrored in `src/lib/types.ts` / `src/lib/ipc.ts`; the browser
  mock backend lives in `src/lib/ipcMock.ts` so `bun run dev` works without Tauri.
- Git commands run on `spawn_blocking` (libgit2 is synchronous).
- PTY output: core pushes bytes → shell emits `luxor://pty-output` `{ session_id, data_b64 }`;
  exits emit `luxor://pty-exit`. Base64 keeps arbitrary bytes intact across IPC. The frontend
  `ptyBus` registers its listeners before any spawn and replays buffered output on attach.
- Quit guard: `close_guard_set` tells the backend the UI can veto an exit; closing the window
  (with "keep running in the tray" off) or choosing Quit in the tray then emits
  `app:close-requested` and the UI calls `quit_app` once the user agrees. A UI that is not
  loaded (or has crashed) never blocks exit.

## Frontend state

- `appStore` — config, toasts (with optional action button), palette/settings modals. Theme is
  applied via `data-theme` on `<html>`; Tailwind tokens map to CSS variables.
- `projectsStore` — project list + active tab (`localStorage["luxor.activeProject"]`).
- `dockStore` — dockview API per project, presets, panel openers, per-project layout
  persistence (`localStorage["luxor.layout.{projectId}"]`).
- `uiStore` — context menus and the single-slot confirm/prompt dialogs (use these instead of
  `window.confirm`).
- Every localStorage key is registered in `src/lib/storageKeys.ts`; a test fails on
  unregistered keys.

## Storage map

| Data | Location |
| --- | --- |
| App config | `{config_dir}/luxor/config.toml` |
| Projects | `{data_dir}/luxor/projects.sqlite` |
| Layout presets | `{data_dir}/luxor/presets/*.json` |
| Activity analytics | `{config_dir}/luxor/local_stats.db` (never leaves the machine) |
| Per-project window layout | `localStorage["luxor.layout.*"]` |
| Terminal restore state | `localStorage["luxor.term.<dockKey>:<panelId>"]` (scrollback, unsent input, cwd; ≤1.5 MB total; opt-out in Settings → Terminal) |
| Secrets | OS keychain only |

### Terminal restore

A PTY cannot outlive the app, so a "restored" terminal is a fresh shell below the saved screen.
`src/lib/terminalState.ts` owns the storage format and budget; `TerminalPanel` serialises the
xterm buffer (`@xterm/addon-serialize`), throttled to one save per ~2.5 s and flushed on
`pagehide` / `visibilitychange`. The unsent input line is typed back (without Enter) once the
new shell is quiet. Keystrokes at no-echo prompts (`Password:`, `[sudo] password for …:`) are
neither saved nor added to command history. Snapshots are keyed by dock **and** panel id
because layout presets reuse panel ids. Closing a tab deletes its snapshot; orphans are
pruned at startup.

## Security invariants

1. Secrets never touch disk, SQLite, logs or the renderer beyond the moment of entry.
2. Tokens are sent only to the host they belong to (a git remote, `api.github.com`).
3. **No telemetry leaves the machine.** Network access happens only for user-initiated
   features: git remotes, the GitHub panel, one update check per start against GitHub
   Releases (switchable), the HTTP client panel and the optional built-in browser. The full
   list is in the README ("Privacy and network"); adding a destination requires maintainer
   approval and a README update.
4. Mutating filesystem/database commands are confined to project roots by PathGuard
   (`src-tauri/src/pathguard.rs`). Read-only commands are deliberately unrestricted so a new
   project can be browsed before it is opened.
5. Changing any of the above requires explicit maintainer approval (see CONTRIBUTING).

## Performance architecture

- `perfMark.ts` records the entry module start; `main.tsx` records module ready;
  `perf/perfMeasure.ts` adds TTI, long-task observation and exportable diagnostics.
- Heavy panels are code-split via `React.lazy()` — CodeMirror (per-language packs), xterm,
  dockview. `manualChunks` in `vite.config.ts` groups vendor code; the `dropCmPreload` plugin
  keeps the ~770 KB CodeMirror runtime off the first-paint path.
- Long lists use `virtua`; the global hotkey handler resolves a chord with one map lookup.
- The activity driver samples every 30 s on a chained timer (never overlapping) and does
  nothing while collection is off.

## Accessibility

Focus traps in modals (`useFocusTrap`), `aria-live` announcements (`announce()`), keyboard
navigation in overlays, and a reduced-motion mode that disables the animations.

## Theme system

15 built-in themes as CSS custom properties under `:root[data-theme="…"]` (`styles.css`,
metadata in `src/lib/themes.ts`), a custom accent colour and a 300 ms crossfade on change.

## Error handling

- `AppErrorBoundary` wraps the app; `PanelErrorBoundary` wraps every dock panel, so one
  crashing panel shows a report with Retry / Copy instead of a blank tab.
- Failed user actions surface as toasts (`reportError()`); background polling stays quiet.
- `backendStatus.ts` tracks backend availability; `main.tsx` turns uncaught errors into
  throttled toasts and writes them to the frontend log.

## Internationalization

`src/lib/i18n.ts` — `t(key, englishFallback)`; the Russian dictionary (`i18n.ru.ts`) loads
lazily on first switch. Settings rows translate their `label` / `help`. A unit test fails when
a static `t("…")` string has no Russian entry. Components wrapped in `memo` must use `useT()`
so they re-render on a language switch.

## CI/CD

- **CI** (`ci.yml`): Rust fmt/clippy/test on Linux/Windows/macOS, frontend typecheck/lint/unit
  tests/build, Playwright E2E, `cargo audit` / `cargo deny` / `bun audit`.
- **Visual regression** (`visual-regression.yml`): `shot.mjs` screenshots on UI changes.
- **Release** (`release.yml`): builds installers for Windows/Linux/macOS on `v*` tags; Apple
  signing is skipped unless a certificate is configured.
- The Tauri auto-updater is **disabled** (`plugins.updater.active = false`) until signing keys
  exist; the in-app update check only links to the release page.
