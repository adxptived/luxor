# Viktor pass34

Two requests: (1) remove the active-tab outline so selection is shown by the
background alone, and (2) improve the built-in web browser.

## Tabs — no outline

- Removed the border/outline and the lift shadow from the active tab. Selection
  is now conveyed purely by the **background colour**: the active tab takes the
  exact content colour and melts into the panel below it, with rounded top
  corners only. No border, no box-shadow.

## Web browser improvements

- **Live site favicon in the address bar.** The leading icon now shows the
  current site's real favicon (via the privacy-friendly DuckDuckGo icon
  service), with a graceful fallback to a generic globe if it can't load, and a
  spinner while the page is loading. New pure helper `faviconUrl()` (unit
  tested). Applies to both the native-webview browser and the dev iframe
  fallback.
- **Ctrl/Cmd+L address-bar shortcut.** Pressing Ctrl/Cmd+L inside the Browser
  panel focuses and selects the address bar, like a real browser. Scoped to the
  panel so it doesn't clash with global shortcuts.

## Files touched

- `src/styles.css` — active tab: removed border + shadow.
- `src/panels/BrowserPanel.tsx` — `faviconUrl()`, `SiteIcon`, Ctrl/Cmd+L.
- `src/panels/BrowserPanel.test.ts` — tests for `faviconUrl()`.

## Validation

- `bun run typecheck` passed.
- `bun test src` passed (240 tests, +2 new).
- `bun run build` passed.
- Verified the tab in the dev preview (dark theme).
- Rust/Tauri not compiled here (`cargo`/`rustc` unavailable in the sandbox), so
  the native-webview path is code-reviewed, not run.

## Note

"Optimize the program — it doesn't work correctly": need a concrete repro
(which action, what happens vs. expected) to fix the right thing rather than
guess. Typecheck, the full test suite and the production build are all green.
