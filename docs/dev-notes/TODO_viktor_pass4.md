# Viktor pass 4 — QoL (Stephanie request: "ctrl+z в редакторе и тд, чтобы было удобно")

## Editor undo/redo (already built into Monaco — verify + expose)
- [ ] Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z already work in EditorPanel (Monaco). Document.
- [ ] Add toolbar Undo/Redo buttons + "Format document" entry where useful.

## New QoL features (frontend, fully testable)
- [ ] Reopen closed tab — Ctrl+Shift+T (per-project closed-tab stack in dockStore)
- [ ] Close active tab — Ctrl+W (guarded; skip when typing in terminal/input)
- [ ] Wire both into Command Palette + editable hotkeys registry
- [ ] Pure module src/lib/closedTabs.ts + tests

## Verify
- [ ] bun run typecheck, bun test src, bun run build all green
