# Luxor Architecture

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ src/  — React + TS UI                                            │
│   dockview (panel layout) · xterm.js (terminals)                 │
│   CodeMirror (editor/diffs) · zustand (state) · Tailwind v4      │
├──────────────────────────────────────────────────────────────────┤
│ src-tauri/  — thin Tauri v2 shell                                │
│   IPC commands (commands/*.rs) · events · AppState               │
├──────────────────────────────────────────────────────────────────┤
│ crates/luxor-core  — ALL the logic (pure Rust lib)               │
│   pty · gitx · projects · layout · config · secrets              │
│   launcher                                                        │
└──────────────────────────────────────────────────────────────────┘
```

**Rule: logic lives in `luxor-core`, never in `src-tauri`.** The core crate has no Tauri
dependency, builds on any machine and carries the unit tests. `src-tauri` only converts
IPC params, calls core, and forwards events. This keeps the app testable without a
display server or webkit toolchain.

## luxor-core modules

| Module | Responsibility | Key deps |
| --- | --- | --- |
| `config` | `AppConfig` (theme, terminal, editors) as TOML in the app config dir | `toml`, `serde` |
| `layout` | `LayoutPreset` JSON persistence, versioned (`PRESET_VERSION`) for forward compatibility | `serde_json` |
| `projects` | Project registry (id, name, path, favorite commands, ordering) | `rusqlite` (bundled) |
| `pty` | `PtyManager`: spawn/write/resize/kill sessions; output is pushed through an `OutputSink` callback from a reader thread; a wait thread reports exit | `portable-pty` |
| `gitx` | Status (+ahead/behind), log, file history, commit, stage/unstage/discard, branches, stash, fetch/pull(ff-only)/push. Diffs return old/new file contents for Monaco (4 MB binary guard). Credentials: stored token → credential helper → ssh-agent | `git2` |
| `launcher` | Spawn plans for external terminal / file manager / IDE; executable discovery; `run_executable` is restricted to the project directory | `which` |
| `secrets` | OS keychain access. Service `luxor`, accounts `git:{host}` and `ai:{provider}` | `keyring` |
| `error` | Single `Error` enum, serialized to the frontend as `{ kind, message }` | `thiserror` |

## IPC

- All commands are registered in `src-tauri/src/lib.rs`; params are snake_case structs.
- Git commands run on `spawn_blocking` (libgit2 is synchronous).
- PTY output: core pushes bytes → shell emits `luxor://pty-output` `{ session_id, data_b64 }`;
  exits emit `luxor://pty-exit`. Base64 keeps arbitrary bytes intact across IPC.
- Frontend wrappers live in `src/lib/ipc.ts` (typed, with a browser mock so `bun run dev`
  works without Tauri).

## Frontend state

- `appStore` — config, gateway status, toasts, palette/settings modals. Theme is applied via
  `data-theme` on `<html>`; Tailwind tokens map to CSS variables.
- `projectsStore` — project list + active tab (active id in `localStorage`).
- `dockStore` — dockview API ref, presets, panel openers, per-project layout persistence
  (`localStorage["luxor.layout.{projectId}"]`).

## Storage map

| Data | Location |
| --- | --- |
| App config | `{config_dir}/luxor/config.toml` |
| Projects | `{data_dir}/luxor/projects.sqlite` |
| Layout presets | `{data_dir}/luxor/presets/*.json` |
| Per-project window layout | `localStorage` |
| Secrets | OS keychain only |

## Security invariants

1. Secrets never touch disk, SQLite, logs or the renderer beyond the moment of entry.
2. Tokens are sent only to the host they belong to (git push/pull) or to the local gateway.
3. No telemetry, no network calls except git remotes and `localhost` gateway endpoints.
4. Changing any of the above requires explicit maintainer approval (see CONTRIBUTING).

## Performance architecture

### Startup optimization
- `perfMark.ts` records the entry module start time; `main.tsx` records module ready.
- `perf/perfMeasure.ts` extends this with TTI measurement, long-task observation, and
  exportable performance diagnostics.
- Heavy panels are code-split via `React.lazy()` — CodeMirror, xterm, and per-language
  packs load only when needed.
- The `dropCmPreload` Vite plugin strips CodeMirror's `<link rel="modulepreload">` from
  `index.html` so the ~770 KB runtime doesn't block first paint.
- `manualChunks` in `vite.config.ts` splits vendor code into logical chunks (cm, xterm,
  dockview, react, icons, markdown).

### Virtual scrolling
- `useVirtualList` (`src/lib/useVirtualList.ts`) renders only visible rows + overscan.
- Supports both fixed-height and variable-height rows.
- Used by Files, Git, Search, and Activity panels for lists with hundreds+ items.

### Debouncing
- `useDebouncedCallback` — fires after a quiet period (search inputs, config saves).
- `useThrottledCallback` — fires at most once per interval (scroll, resize).
- `useDebouncedValue` — debounced state for derived computations.

## Accessibility (a11y)

- **Focus traps**: `useFocusTrap` (`src/lib/useFocusTrap.ts`) keeps Tab/Shift+Tab
  cycling within modal dialogs (CommandPalette, SettingsModal, ProjectSwitcher).
- **ARIA**: All interactive elements have `role`, `aria-label`, `aria-selected`,
  `aria-modal` attributes as appropriate.
- **Screen reader announcements**: `announce()` and `announceAssertive()` push
  messages to an `aria-live` region for state changes (panel switches, errors).
- **Keyboard navigation**: Arrow keys, Tab, Esc, Enter work in all overlays and lists.

## Theme system

- Themes are CSS custom properties in `styles.css` under `:root[data-theme="..."]`.
- 15 built-in themes (dark, light, system, tokyo_night, catppuccin, dracula, nord, etc.).
- `applyTheme()` in `appStore.ts` applies the theme with a smooth 300ms crossfade
  (`themeCrossfade.ts`) that interpolates color values via requestAnimationFrame.
- Custom accent colors override `--lx-accent` at runtime.
- `prefers-reduced-motion` disables the crossfade for users who prefer instant switches.

## Error handling and reliability

- **AppErrorBoundary**: Top-level boundary with recovery UI, error count tracking,
  reload button, and clipboard copy for bug reports.
- **PanelBoundary**: Per-panel boundary in DockLayout — a crashing panel shows an
  error message and retry button instead of a blank tab.
- **Retry**: `retryable()` (`src/lib/retry.ts`) wraps IPC calls with exponential backoff.
- **Backend status**: `backendStatus.ts` tracks consecutive failures and transitions
  to degraded/unavailable states with user-facing messages.
- **Global error handlers**: `main.tsx` catches uncaught errors and unhandled rejections,
  surfacing them as toasts (throttled per message).

## Plugin / extensibility architecture

- `src/lib/plugins.ts` defines the `PluginManifest` interface and `PluginManager`.
- Plugins contribute panels, commands, and status bar items.
- Content is verified via FNV-1a hash (`skillsHash.ts`) before loading.
- Trusted hashes are maintained in a local allowlist (future: signed registry).
- `PluginManager` singleton tracks loaded/disabled/error/untrusted status.

## Internationalization (i18n)

- `src/lib/i18n.ts` — lightweight i18n with `t(key, english)` pattern.
- English strings are inline fallbacks; Russian translations in the `RU` map.
- `src/lib/localeDetect.ts` — auto-detects locale from `navigator.language` / `navigator.languages`.
- Supported languages: English (`en`), Russian (`ru`).

## CI/CD

- **CI** (`ci.yml`): Rust fmt/clippy/test, frontend typecheck/unit test/build, Tauri build.
- **Visual regression** (`visual-regression.yml`): `shot.mjs` screenshots + Playwright E2E.
- **Release** (`release.yml`): Signed builds for Windows/Linux/macOS, auto-updater JSON.
- Code signing via GitHub secrets (`TAURI_PRIVATE_KEY`, `APPLE_CERTIFICATE`, etc.).
- Auto-updater checks `releases/latest/download/latest.json` for new versions.

## Plugin direction (post-1.0)

The command palette and panel registry are the integration points: a future plugin API will
let plugins contribute panels (webview), commands and status bar items. The `PluginManager`
in `src/lib/plugins.ts` defines the interface; runtime loading from the app data directory
is tracked for the roadmap.