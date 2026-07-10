# Luxor — Viktor pass 18 (UI/UX polish sweep)

Another UI/UX pass focused on making the app feel more deliberate and less like a set of raw utility panels. This pass avoids risky logic rewrites and targets the most visible surfaces: welcome/onboarding, blank dock recovery, folder-less project CTAs, launcher, and command palette.

---

## Improved

### 1. Welcome / blank workspace screen
- Rebuilt the welcome surface into a more polished two-column layout with a stronger hero, version chip, contextual description, feature pills, recent-project card, and tips card.
- Added an empty recent-project state so the screen does not feel unfinished on first launch.
- Action cards now have clearer primary emphasis, better icon treatment, hover affordances, and truncation behavior.
- Blank workspace mode keeps its folder-less copy, but now looks like an intentional workspace instead of a temporary placeholder.

### 2. Empty dock state
- Reworked the "Nothing open" screen into a centered recovery card instead of a plain grey void.
- Common actions are now card-style buttons with labels + hints, not a flat row of small buttons.
- The layout adapts from one column to four columns and remains usable in small split panes.
- The "More panels" action is still available, and the helper tip now points to right-click customization.

### 3. Folder-less workspace CTA
- Upgraded `NoFolderCta` from a basic message into a focused attach-folder card.
- Added clearer primary browse action, an explanation badge for what a folder unlocks, and a path input with an explicit submit button.
- The state now uses the same visual language as the rest of the polished empty/onboarding surfaces.

### 4. Launcher panel
- Rebuilt Launcher into card-based sections with a project header and path chip.
- "Open in…" actions are now proper responsive cards with icons and hints.
- Executable scan state is clearer, with an animated scan icon and stronger empty state.
- Favorite commands are shown as responsive command cards; delete is reachable on small/touch layouts, not only hover-only desktop.
- Duplicate favorite commands are rejected with an info toast instead of silently adding repeated entries.

### 5. Command palette
- Restyled the palette as a larger command surface with backdrop blur, header, shortcut hints, search icon, result counter, and footer summary.
- Command rows now separate the command category from the action title, improving scanability.
- Selected rows have stronger focus treatment and an Enter affordance.
- Empty search results now provide actionable guidance instead of a plain text line.
- Arrow navigation now guards the empty-result case so selection cannot move to `-1`.

---

## Verification

- `bun run build`: **OK** (`tsc --noEmit` + Vite production build)
- `bun test src`: **231 / 231 pass**

## Not verified in this sandbox

- Native Tauri GUI/runtime and Rust/core checks remain unavailable here because the sandbox has no `rustc`/`cargo` and no native webkit/gtk GUI stack. Please run `bun tauri dev` locally to validate the real desktop window visuals and native webview behavior.
