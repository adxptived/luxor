# Viktor pass 23 — DevTools EXE launcher + WebBrowser checks

Focused pass on the Dev Tools Run tab and embedded WebBrowser behavior.

## DevTools / Run tab

- Reworked the Run tab header into “Run, build & EXE launcher”.
- Added a dedicated “Find executable” card with inline filter/search and `shown/total` counter.
- Increased executable scan cap to 120 so larger projects can still be filtered in-place.
- Added a “Rescan EXE” action for rebuilding → rescanning without leaving DevTools.
- Improved executable rows with:
  - executable name and relative path;
  - `debug` / `release` profile badges;
  - Windows executable badge for `.exe`, `.cmd`, `.bat`, `.com`;
  - run detached action;
  - open with default app action;
  - run in a new terminal tab;
  - open containing folder;
  - copy full path.
- Kept the UI compact-aware: path / terminal / copy actions are hidden when the panel is very narrow.
- Improved no-results and no-build empty states with clearer instructions.

## Executable discovery backend

- Replaced shallow executable discovery with prioritized scan paths:
  - project root;
  - `target/release`, `target/debug`;
  - `src-tauri/target/release`, `src-tauri/target/debug`;
  - `release`, `debug`, `build`, `bin`, `dist`, `out`.
- Added a shallow recursive fallback to catch nested outputs such as `packages/desktop/target/release/App.exe`.
- Skips noisy/generated folders during fallback scanning: `.git`, `node_modules`, virtualenvs, caches, `.next`, `.turbo`, Cargo `deps` / `incremental`, etc.
- De-duplicates executable paths by canonical path and sorts deterministically.
- Detects Windows-style runnable files (`.exe`, `.bat`, `.cmd`, `.com`, `.appimage`) even when the scan runs on a non-Windows development machine.
- Added a regression test for nested Windows EXE discovery while skipping `node_modules` noise.

## WebBrowser

- Checked URL normalization and fixed local/dev server handling:
  - `localhost:5173` → `http://localhost:5173`;
  - `127.0.0.1:1420/app` → `http://127.0.0.1:1420/app`;
  - `[::1]:3000` → `http://[::1]:3000`;
  - `devbox.local:8080` → `http://devbox.local:8080`.
- This avoids local dev URLs being turned into search queries or invalid HTTPS requests.
- Browser Home now hides the native embedded webview immediately and resets bounds state, instead of waiting for the next bounds tick.
- Iframe fallback toolbar now wraps on small panel widths.
- Added unit coverage for local/dev server URL normalization.

## Verification

- `bun install --frozen-lockfile`: **OK**
- `bun run typecheck`: **OK**
- `bun test src`: **OK** — 232 pass / 0 fail / 513 expect() calls
- `bun run build`: **OK**
- `cargo test -p luxor-core launcher --lib`: not run in sandbox because `cargo` is not installed here.

## Notes

- Native Tauri GUI/runtime checks still need a local machine with Rust/Cargo and webview dependencies.
