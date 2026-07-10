# Luxor 0.6.12 — Viktor pass 27

Focused pass for the “app is closed but folder still locked” shutdown complaint, plus a new OS login autostart setting.

## Fixed shutdown / lingering-process cleanup

- Added a shared Tauri shutdown cleanup path (`cleanup_before_exit`) that runs on explicit tray quit and final app exit.
- Cleanup now kills all managed embedded terminal/PTTY sessions before the process exits.
- Cleanup now stops the managed OmniRoute child process when Luxor spawned it, instead of only stopping it from the AI panel.
- Cleanup removes Luxor’s CLI single-instance `app.pid` file on clean shutdown.
- Closing the last real Luxor window when “Keep running in the background” is disabled now performs the same cleanup and exits the app, rather than only destroying the window.
- Tray “Quit Luxor” now performs cleanup before calling `app.exit(0)`.

## Added app autostart setting

- Added `Settings → Interface → Launch on startup`.
- Default is off for fresh and old configs.
- Saving the setting now mirrors it to the OS user startup location:
  - Windows: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` value `Luxor`.
  - macOS: `~/Library/LaunchAgents/com.luxor.app.plist`.
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/autostart/luxor.desktop`.
- On app startup Luxor re-syncs the OS startup entry with the stored config so the OS entry does not drift after upgrades/moves.
- The settings search now finds this row by `autostart`, `startup`, `login`, `boot`, and `автозагрузка`.

## Config / typing

- Added `ui.launch_on_startup` to Rust config, frontend types, and browser IPC mock defaults.
- Added config regression coverage for default/off, legacy config migration, and round-trip true values.

## Validation

- `bun run typecheck` — passed.
- `bun test src` — passed: 238 tests, 0 failures.
- `bun run build` — passed.
- Rust tests/checks could not be run in this sandbox because `cargo`/`rustc` are not installed.
