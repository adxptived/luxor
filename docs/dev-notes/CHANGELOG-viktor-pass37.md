# Luxor — Viktor pass37

Focus: window ACL fix (non-working top-bar/window buttons), single left
sidebar with a smooth close animation, and configurable/de-duplicated
top-bar quick-action buttons.

## 1. Window buttons / dragging now work (ACL fix)
- `src-tauri/capabilities/default.json` previously granted only `core:default`,
  which does **not** include the window commands the custom titlebar uses, so
  every action failed with `plugin:window|… not allowed by ACL`
  (`toggle_maximize`, `start_dragging`, `minimize`, `close`, …).
- Added the missing window permissions:
  `core:window:allow-start-dragging`, `allow-start-resize-dragging`,
  `allow-toggle-maximize`, `allow-minimize`, `allow-maximize`,
  `allow-unmaximize`, `allow-close`, `allow-is-maximized`.
- This makes minimize / maximize-on-double-click / close work, and re-enables
  dragging the window by the title bar. **Config-only change — rebuild the
  native app (`cargo`/`tauri build`) to pick it up; it can't be tested in the
  web dev preview.**
- Cross-platform: Tauri capability files are platform-agnostic, so this applies
  to Windows, macOS and Linux equally.

## 2. One left panel + nice close animation
- In side-tab mode the vertical project/nav rail (`TopBar`) **is** the left
  sidebar, so the optional widget `SidePanel` was rendering as a confusing
  *second* left panel. It's now shown only in top-tab mode (`App.tsx`).
- The main left sidebar is now **closable** and animates its width to 0
  (200 ms ease-out, respects reduced-motion) — `src/components/TopBar.tsx`.
  - New `ui.left_sidebar_open` config flag (default **true**).
  - A collapse button (PanelLeftClose) sits in the sidebar's button cluster.
  - Re-open from the top bar's left-sidebar toggle (always visible).

## 3. Top-bar buttons: no outline, no duplicates, configurable
- Removed the boxed **outline** around the quick-action groups, and the accent
  border ring on the *active* state — selection is shown by background only
  (`src/styles.css` `.lx-square-btn.is-active`).
- `ChromeQuickActions` (`src/components/WindowChrome.tsx`) is now driven by an
  ordered config list `ui.chrome_actions`:
  - **Default is de-duplicated**: only the two layout toggles (left/right
    sidebar) that don't already exist in the nav rail / tab strip.
  - Available actions: `left`, `right`, `terminal`, `new`, `files`, `settings`.
  - **Drag to reorder**; **right-click** any button to hide it, show a hidden
    one, reset to default, or jump to Settings.
- The left toggle now controls the *main* left sidebar in side-tab mode and the
  side panel in top-tab mode, so "the left sidebar button" always matches what
  you see.

## New config fields
`ui.left_sidebar_open: bool = true` and `ui.chrome_actions: string[] = []`
(empty = curated default). Mirrored in Rust (`crates/luxor-core/src/config.rs`,
container-level `#[serde(default)]` → old config files keep working) and TS
(`src/lib/types.ts`, mock in `src/lib/ipc.ts`).

## Validation
- `bun run typecheck` (tsc --noEmit): clean.
- `bun test src`: 240 passed / 0 failed.
- `bun run build`: succeeds.
- Screenshots captured in mock side-tab mode: single left sidebar, flat
  de-duplicated top-bar buttons, and the open→closed→reopen animation.
- Rust changes (capabilities + config struct) are review-only here — no
  `cargo` in this environment; compile on your side.
