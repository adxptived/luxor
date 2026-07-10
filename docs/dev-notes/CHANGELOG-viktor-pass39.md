# Luxor — Viktor pass39

Focus: **startup/performance optimisation** + a **Developer log panel in Settings** for viewing and sharing logs.

## 1. Settings → Developer (new section)

A dedicated **Developer** section in Settings (Bug icon, between Hotkeys and About) that turns "send me your logs" into one click.

- **Live log feed** — shows the persisted `frontend.log` tail (errors, UI freezes, startup timing) merged with this session's events. Updates live as new entries arrive (subscribes to an in-memory log buffer), so you don't need to reopen the panel.
- **Startup timing card** — parses the latest `STARTUP` line and shows *First paint / HTML loaded / JS ready / App ready* as readable numbers, so a slow start is diagnosable at a glance instead of guessing.
- **Share actions** (flat, hover-bg toolbar — matches the no-outline design language):
  - **Copy** — copies the (optionally filtered) log to the clipboard.
  - **Save .log** — writes `luxor-frontend.log` via the native save dialog.
  - **Export diagnostics** — full report (version, OS, config, crashes, log tail).
  - **Open log folder** — reveals the config/log directory in the OS file manager.
  - **Clear** — wipes the persisted log + the live buffer.
- **"Errors & freezes only"** filter to cut to the signal (ERROR / FREEZE / panic / Unhandled).
- Searchable: the section + its actions are indexed in settings search (EN/RU keywords).
- Privacy note in-panel: no secrets are stored in the log/diagnostics (tokens live in the OS keychain).

### How it works
- `src/lib/logBuffer.ts` (new) — a capped (600-line) in-memory ring buffer. `frontendLog()` mirrors every persisted line into it, so the panel has a live feed even in the browser/dev build (which has no Rust log file) and can always be copied/shared.
- New IPC: `frontendLogRead` / `frontendLogClear` / `openLogFolder` (with safe fallbacks to the session buffer when a native command isn't present).

## 2. Startup / performance

- **`appReady` telemetry** — `STARTUP` now also records `appReady=…ms` (config loaded + shell interactive), i.e. real "time to usable", not just first paint. Surfaced in the Developer timing card.
- **Freeze detector moved off the critical path** — the 1s heartbeat now starts after the first idle window (`requestIdleCallback`, 4 s fallback) instead of at module load, so it never competes with the initial mount/paint.
- Frontend startup remains well-optimised (inline splash, lazy Monaco kept out of the entry chunk, deferred gateway probe). **The dominant 10 s cost is native**, not the frontend — see below.

## 3. Native (review-only — needs a Rust rebuild)

I can't compile Rust/Tauri in my sandbox, so these are reviewed edits that apply on your next native build:
- `crates/luxor-core/src/diag.rs`: `frontend_log_clear()` + `log_dir()` helpers.
- `src-tauri/src/commands/extras.rs`: `frontend_log_read`, `frontend_log_clear`, `open_log_folder` commands.
- `src-tauri/src/lib.rs`: registered the three new commands.

### Why startup is ~10 s (still native, by likelihood)
1. **Debug build** — `tauri dev` / non-`--release` starts far slower. Measure a `--release` build.
2. **Antivirus / Windows Defender** scanning the unsigned `.exe` on launch.
3. **WebView2 cold start** — first launch after boot.

The Developer timing card now lets you read exactly where the seconds go: if `appReady` is small but the window still takes seconds to appear, the time is native (process/WebView), not JS.

## Checks
- `bun run typecheck` ✓
- `bun test src` — **250 pass / 0 fail** (+7 new: `logBuffer.test.ts`)
- `bun run build` ✓

## Changed files
- `src/lib/logBuffer.ts` (new) + `src/lib/logBuffer.test.ts` (new)
- `src/lib/ipc.ts` (log buffer hook + new IPC + mock cases)
- `src/components/SettingsModal.tsx` (Developer section + log panel UI)
- `src/lib/settingsSearch.ts` (Developer search entries)
- `src/App.tsx` (`appReady` telemetry)
- `src/main.tsx` (deferred freeze detector)
- `crates/luxor-core/src/diag.rs`, `src-tauri/src/commands/extras.rs`, `src-tauri/src/lib.rs` (native, review-only)
