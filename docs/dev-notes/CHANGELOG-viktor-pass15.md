# Luxor — Viktor review pass 15

Focus: **browser-style tab groups** for the project tabs — named, colored,
collapsible clusters, exactly like Chrome/Edge tab groups. Frontend-only and
fully unit-tested; no Rust touched.

---

## Browser-style tab groups
You can now organize the project tabs into **named, colored groups** that
collapse and expand — just like in a browser.

**Create & manage** (right-click any tab):
- **New tab group** — wraps the tab in a fresh group (auto-named *Group N*, with
  the next free color from a 9-color palette).
- **Add to "<group>"** — drop the tab into any existing group (color swatch
  shown in the menu).
- **Remove from group**.

**The group header chip** (rendered before the group's tabs):
- **Click** to collapse / expand the whole group. Collapsed groups show a count
  badge and keep only the *active* tab visible, so your current workspace never
  disappears.
- **Right-click** for: **Rename**, **Group color** (9-color palette),
  **Collapse/Expand**, **Ungroup tabs** (keeps the tabs open, just dissolves the
  group).

**Behavior**
- Grouped tabs are **clustered contiguously** at the position of the group's
  first member — reordering individual tabs by drag still works and never breaks
  a group (membership is by tab id, not position).
- A thin **colored edge** marks each group cluster (bottom border in the top
  bar, left border in the vertical sidebar), so groups read at a glance.
- Works in **both** layouts: horizontal top bar and vertical sidebar.
- Pinned tabs still float to the front; groups cluster after them.

**Persistence**
- Group metadata (name / color / collapsed) and membership are persisted to
  **localStorage** (`luxor.tabGroups.v1`), deliberately *off* the Rust config so
  groups never require a config-schema migration.
- Membership is **auto-pruned** when tabs are closed; a group with no members
  left is removed automatically.

---

## Code
- New `src/lib/tabGroups.ts` — pure, side-effect-free: color palette,
  `buildTabLayout` (the clustering algorithm), `nextGroupColor`, `pruneGroups`,
  `activeGroupCount`. **17 unit tests** (`tabGroups.test.ts`).
- New `src/state/tabGroupsStore.ts` — zustand + localStorage store
  (create / rename / recolor / collapse / delete / assign / remove / sync).
- `src/components/TopBar.tsx` — extracted a shared `renderTab` and added
  `renderGroup` (chip + cluster); tab context menu gained the group actions;
  a `sync` effect prunes membership when the project list changes.
- RU + EN strings added.

---

## Verification (all green)
- `tsc --noEmit`: **0 errors**
- `bun test src`: **228 / 228 pass** (+17 new `tabGroups` tests)
- `bun run build`: **OK**
- `cargo fmt` / `clippy -D warnings` / `cargo test -p luxor-core`: **unchanged &
  green** (no Rust touched this pass)
- `src-tauri`: not compiled in sandbox (no webkit/gtk), but this pass added **no**
  Rust, so there's nothing new to compile-verify.
