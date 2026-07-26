# Luxor — Developer Guide

This document covers the development workflow, architecture decisions, and
contribution guidelines for Luxor.

## Setup

1. Install [Rust](https://rustup.rs) (stable), [Bun](https://bun.sh) and the
   [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
2. `bun install`
3. `bun tauri dev` — full app. `bun run dev` — UI only with a mocked backend.

## Architecture Overview

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the full layering diagram.

```
crates/luxor-core   # all logic: pty, git, projects, layouts, config, secrets
src-tauri           # thin Tauri v2 shell: IPC commands + events
src                 # React + TypeScript UI: dockview, xterm.js, CodeMirror 6, zustand, Tailwind
```

## Key Design Decisions

### Logic in `luxor-core`, not `src-tauri`
All business logic lives in the pure Rust `luxor-core` crate. `src-tauri` is a
thin IPC shell that converts params, calls core, and forwards events. This
keeps the app testable without a display server or webkit toolchain.

### Code-splitting and lazy loading
Heavy panels (Editor, Terminal, Browser, DB, Docker, PDF, Image) are loaded
via `React.lazy()` with `Suspense` fallbacks. The CodeMirror runtime (~770 KB)
is split into per-language chunks so it only loads when a file of that language
is opened. See `vite.config.ts` for the manual chunk configuration.

### Virtual scrolling
Long lists (Files, Git, Search, Activity) use the `useVirtualList` hook
(`src/lib/useVirtualList.ts`) to render only visible rows plus an overscan
buffer, keeping the DOM light even with thousands of entries.

### Debounced operations
Expensive operations (search, layout persistence, config saves) use the
`useDebouncedCallback` and `useThrottledCallback` hooks
(`src/lib/useDebounce.ts`) to avoid excessive recomputation or IPC calls.

### Accessibility
- Focus traps on all modal dialogs (`useFocusTrap`).
- ARIA roles and labels on interactive elements.
- Screen reader announcements via `announce()` / `announceAssertive()`.
- Full keyboard navigation (arrow keys, Tab, Esc) in all overlays.

### Theme system
Themes are defined as CSS custom properties in `styles.css`. The `applyTheme`
function in `appStore.ts` applies the theme with a smooth crossfade animation
(`themeCrossfade.ts`). Custom accent colors override `--lx-accent` at runtime.

### Error handling
- `AppErrorBoundary` wraps the entire app — fatal errors show a recovery UI.
- `PanelBoundary` wraps each dock panel — a crashing panel shows an error
  instead of a blank tab.
- `retryable()` wraps IPC calls with exponential backoff.
- `backendStatus.ts` tracks backend availability and degrades gracefully.

### Security
- Secrets (git tokens, AI provider keys) are stored only in the OS keychain.
- CSP is configured in `tauri.conf.json` — `default-src 'self'` with
  carefully scoped exceptions for styles, images, fonts, workers, and frames.
- Input validation utilities in `src/lib/validation.ts` sanitize all
  user-provided paths, names, and commands.

### Plugin architecture
Plugins are defined via manifests (`src/lib/plugins.ts`) that declare panels,
commands, and status bar items. Plugin content is verified via FNV-1a hash
(`skillsHash.ts`) before loading. Untrusted plugins are rejected.

### Internationalization
- `src/lib/i18n.ts` — lightweight i18n with inline English fallbacks.
- `src/lib/localeDetect.ts` — auto-detects locale from `navigator.language`.
- Supported languages: English (`en`), Russian (`ru`).

## Checks (CI runs these)

```bash
cargo fmt --all --check
cargo clippy -p luxor-core --all-targets -- -D warnings
cargo test -p luxor-core
bunx tsc --noEmit
bun test src          # unit tests
bun run build         # production build
bun run e2e           # Playwright E2E tests
node shot.mjs         # visual regression snapshots
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on every push/PR. Checks Rust
  (fmt, clippy, tests), frontend (typecheck, unit tests, build), and Tauri
  builds (Windows, Linux).
- **Visual Regression** (`.github/workflows/visual-regression.yml`): Runs
  `shot.mjs` and Playwright E2E tests on PRs that touch UI files.
- **Release** (`.github/workflows/release.yml`): Triggered by `v*` tags.
  Builds signed installers for Windows, Linux, and macOS. Publishes the
  auto-updater JSON manifest to the GitHub release.

### Code signing
Set these GitHub secrets for signed releases:
- `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` — updater signing key.
- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — Windows EV/OV cert.
- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` — macOS cert.
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` — Apple notarization.

### Auto-updater
The Tauri updater is configured in `tauri.conf.json` under `plugins.updater`.
It checks `releases/latest/download/latest.json` for new versions. The
`tauri-action` generates this manifest automatically on release.

## Ground rules

- **Logic goes in `crates/luxor-core`**, with unit tests. `src-tauri` stays a thin IPC shell.
- Keep IPC params snake_case and mirrored in `src/lib/types.ts` / `src/lib/ipc.ts`.
- Bump `PRESET_VERSION` and add a migration if you change the layout preset schema —
  existing user presets must keep working.

## Changes that need a maintainer discussion *first*

Open an issue before starting work on:

- Replacing key libraries (PTY, git2, dockview, xterm, CodeMirror).
- IPC or process architecture changes.
- New top-level modules / features outside the roadmap.
- Storage model changes (SQLite schema, config/preset formats).

## Changes that are not accepted without explicit maintainer approval

- Anything touching **security**: the keychain scheme, where tokens are sent,
  adding telemetry or any external network calls.
- Removing approved features or breaking preset compatibility.
- License changes or adding dependencies with MIT-incompatible licenses.

## Commit style

Conventional-ish: `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`, `ci: …`.