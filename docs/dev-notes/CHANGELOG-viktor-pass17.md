# Luxor — Viktor pass 17 (small-window adaptation, Git/GitHub/browser polish)

Targeted fixes for the reported regressions: Git diff on narrow panes, poor small-window behavior, GitHub actions opening too much in the browser, tab-group discoverability, embedded browser sizing/perf, status-bar centering, and general UI polish.

---

## Fixed / improved

### 1. Git diff adapts to narrow panes
- Replaced the absolute overlay diff toggle with a real responsive toolbar so it no longer floats over Monaco content.
- Added panel-width detection: below `760px` the diff automatically falls back to inline mode even if side-by-side is enabled.
- Added an “Inline on narrow panel” indicator and explicit file-path display.
- Layout calls are now scheduled through `ResizeObserver`/`requestAnimationFrame` instead of repeated direct calls during render changes.

### 2. Embedded web browser fills its panel and paints less when inactive
- Replaced the permanent 60fps native-webview bounds loop with event-driven syncing (`ResizeObserver`, window resize, scroll, visibility changes) plus a light 250ms safety tick for dock animations.
- Native browser child view is hidden when the browser panel is not visible, inactive, or covered by menus/dialogs, reducing unnecessary painting/render work.
- Viewport is now absolute `inset-0` with `overflow-hidden`, and bounds are clamped to at least `1x1`, improving “not full window” behavior.
- Browser toolbar can wrap on small widths instead of squeezing the address bar/buttons into broken layout.

### 3. GitHub integration does more inside Luxor
- Pull requests now open an in-app detail view instead of immediately opening GitHub in the external browser.
- PR conversations use GitHub’s issue-comments API, so comments can be viewed and posted in-app just like issues.
- CI runs now open an in-app summary/detail view with status, conclusion, branch, event, and age; the external link is reserved for logs/artifacts.
- GitHub panel headers, filters, list rows, and detail footer now wrap/truncate cleanly in narrow side panels.

### 4. Tab groups are easier to create
- Added a visible “New group from active tab” action in the plus/add menu.
- Renamed the tab context-menu action to “New group from this tab” and added a success toast.
- This keeps the existing safe behavior where a group is created with an initial tab member, avoiding the empty-group prune bug fixed in pass 16.

### 5. Status bar center alignment is truly centered
- Status segments now live in a full-width absolute layer, so `center` alignment is based on the full status bar rather than the leftover space before version/right-panel controls.
- Version and right-panel buttons are overlaid on the right so they no longer shift the center group.

### 6. Git panel and right panel adapt better to small windows
- Git header and action rows can wrap.
- Git tab strip scrolls horizontally without showing a heavy scrollbar.
- Git file rows wrap, keep paths truncatable, and keep actions reachable on small/touch-sized layouts instead of hover-only.
- Commit actions wrap instead of overflowing.
- Right panel width now caps itself with `min(configuredWidth, max(180px, 32vw))` to reduce crowding in small app windows.

---

## Verification

- `bun run build`: **OK** (`tsc --noEmit` + Vite production build)
- `bun test src`: **231 / 231 pass**

## Not verified in this sandbox

- Tauri/native GUI runtime (`bun tauri dev`) and Rust/core checks: this sandbox has no `rustc`/`cargo` and no native webkit/gtk GUI stack. Please run locally to validate the native child-webview behavior in a real desktop window.
