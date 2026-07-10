# Luxor — Viktor pass 19 (hidden / secondary UI polish)

This pass focuses on the less obvious UI surfaces that users still touch often: context menus, global dialogs, toasts, the project switcher, settings search/layout, and secondary side-panel empty states. The goal is to make hidden interactions feel deliberate, consistent, and usable in smaller windows.

---

## Improved

### 1. Global context menus
- Reworked custom context menus into rounded, blurred popovers with better padding, focus/hover states, stronger danger-item treatment, and more readable shortcut hints.
- Kept viewport clamping behavior so menus near edges/status bar remain visible.
- Improved touch/small-window resilience with a viewport-limited max width.

### 2. Prompt / confirm overlays
- Rebuilt prompt/confirm dialogs as polished modal cards with backdrop blur, visual icons, danger styling, clearer message hierarchy, and responsive width.
- Confirm and cancel actions now wrap safely instead of cramping in narrow windows.
- Prompt inputs now use the same rounded/surface visual language as the rest of the app.

### 3. Toasts
- Toast stack now has a viewport-aware width, rounded cards, backdrop blur, better line-height, and improved close-button hover state.
- Long toast messages wrap more cleanly without overflowing small windows.

### 4. Project switcher
- Upgraded the Ctrl+P project switcher into a larger command-style surface with a header, shortcut hints, search icon, result counter, richer rows, path subtitles, active badge, and Enter affordance.
- Added a proper no-results card with guidance instead of a plain `No projects` line.
- Preserved keyboard navigation and fast project cycling behavior.

### 5. Settings modal
- Polished the settings shell with a blurred backdrop, rounded container, sidebar helper copy, stronger active section styling, richer section header card, and clearer footer.
- Settings search now shows a helpful no-match card.
- Rows are more responsive: they collapse from two columns into one column on narrow widths and get subtle hover grouping.

### 6. Side panel hidden states
- Converted side-panel widgets into card-style sections with icon badges.
- Improved empty states for blank workspace, no project, no open tasks, and no recent projects so the left panel does not look unfinished.

---

## Verification

- `bun run build`: **OK** (`tsc --noEmit` + Vite production build)
- `bun test src`: **231 / 231 pass**

## Not verified in this sandbox

- Native Tauri GUI/runtime and Rust/core checks remain unavailable here because the sandbox has no `rustc`/`cargo` and no native webkit/gtk GUI stack. Please run `bun tauri dev` locally to validate real desktop window visuals and native webview behavior.
