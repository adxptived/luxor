# Luxor — Viktor review pass 16 (feature audit + code review)

A full audit sweep over the features touched in passes 8–15 plus `luxor-core`,
looking for bugs, dead code, inconsistent UX, missing error handling, untested
logic and type issues. **Headline: the codebase is in very good shape** — the
sweep surfaced a small number of real items, all fixed below, with no risky
rewrites. Everything verifiable in the sandbox is green.

---

## Fixed

### 1. Dead + subtly broken `createGroup` (tab groups store)
`tabGroupsStore.createGroup()` created an *empty* group, but the `sync()` /
`pruneGroups()` housekeeping removes any group with zero members — so an empty
group was deleted again on the very next project-list change. The method was
also unused (the UI only ever creates groups *from a tab* via
`newGroupFromTab`). Removed it to keep the store honest; group creation always
seeds a member now, which is the only mode that actually works.

### 2. Missing Russian for group/tab color names
The new group color picker (and the existing tab color menu) ran color labels
through `t()`, but 7 of them — *Blue, Green, Yellow, Orange, Red, Pink, Purple* —
had no Russian entry and silently fell back to English inside an otherwise
Russian UI. Added the missing translations (`Синий / Зелёный / Жёлтый /
Оранжевый / Красный / Розовый / Фиолетовый`); this also fixes the same labels in
the per-tab color menu.

### 3. Untested pure logic now covered
Added `statusBarPrefs.test.ts` for `alignToJustify()` (status-bar alignment →
CSS `justify-content`), including the unknown-value fallback path.

---

## Audited and confirmed sound (no change needed)
- **Kill agent button** (the earlier "knopka kill ne rabotaet"): traced fully —
  `AgentsPanel.kill` → `ipc.processKill` → `invoke("process_kill", {pid,
  withChildren})` → registered Rust `extras::process_kill(pid, with_children)`,
  covered by the passing `procs::tests::kill_terminates_a_real_child` test.
  Wiring is correct end-to-end.
- **Panel registry consistency**: every `kind` in the "+" menu (`plusMenu.ts`)
  maps to a real component in `DockLayout`'s registry — no dead menu entries.
- **Listener / interval cleanup**: every `addEventListener` / `setInterval` in
  the UI is paired with teardown, except two *intentional* app-lifetime
  singletons (the global error handlers and the focus-timer watcher in
  `main.tsx` / `focusTimerStore.ts`), which are guarded against double-install.
- **Type hygiene**: no `any`, no `@ts-ignore`/`@ts-expect-error` in `src`.
- **Rust safety**: exactly one non-test `.expect()` — the standard Tauri
  `run()` boilerplate in `lib.rs`. No stray `unwrap()`/`panic!` in command paths.
- **No leftover** `TODO`/`FIXME`/`HACK` or stray `console.log` debug noise.

---

## Needs your local build (cannot be verified in this sandbox)
The sandbox has no webkit/gtk, so the GUI/Tauri layer can't be compiled or run
here. Two things still need a real `bun tauri dev` on your machine:
- **Pass 13 native embedded browser** (`src-tauri/src/commands/browser.rs` +
  `Window::add_child` / `WebviewBuilder`, both `unstable`-gated). Please run
  `bun tauri dev` and send me any compile errors so I can fix them.
- Any **visual/layout** check of the recent UI passes (settings/about redesign,
  tab groups, Dev Tools Run tab, adaptive layout) — logic is tested, but pixels
  need eyes on the running app.

---

## Verification (all green)
- `tsc --noEmit`: **0 errors**
- `bun test src`: **231 / 231 pass** (+3 new `alignToJustify` tests)
- `bun run build`: **OK**
- `cargo fmt --all --check`: clean
- `cargo clippy -p luxor-core --all-targets -- -D warnings`: **0 warnings**
- `cargo test -p luxor-core`: **202 / 202 pass**
- `src-tauri` GUI layer: not compilable here (no webkit/gtk) — see section above.
