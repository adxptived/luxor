# Luxor — Viktor review pass 14

Focus: a real **Run / build** loop in Dev Tools (quick `cargo run` / one-click
launch of built exes), plus **adaptive layout** for narrow / small windows and
general UI polish. No Rust changes — built entirely on existing, already-tested
backend commands, so this pass is fully verifiable.

---

## 1. Dev Tools → new **Run** tab (build → run loop)
The Dev Tools panel got a new first tab, **Run**, purpose-built for the
edit→build→run cycle (the panel previously only had env/logs/disk/deps/procs/
crashes).

**Smart toolchain detection** (`src/lib/runDetect.ts`, pure + unit-tested) reads
the project root and offers one-click commands that open in a **new integrated
terminal tab**:
- **Cargo** (`Cargo.toml`): `run`, `run --release`, `build`, `build --release`,
  `test`, `check`, `clippy`, `fmt`. Multi-binary crates get a `run --bin <name>`
  button per `[[bin]]` (so `cargo run` is never ambiguous).
- **npm scripts** (`package.json`): the package manager is auto-detected from the
  lockfile (`bun` / `pnpm` / `yarn` / `npm`); every `scripts` entry becomes a
  button (dev/start/build/test surfaced first) plus `install`.
- **Go** (`go.mod`): `run` / `build` / `test`.
- **Python** (`pyproject.toml` / `requirements.txt` / `main.py`): run main,
  `pip install -r`, `poetry install` / `pip install .`.
- **Make** (`Makefile`): a button per target.

**One-click run of built executables** ("exe открытие быстро"): a *Built
executables* section scans the project (`launcher_find_executables`) and lists
each binary with its **debug/release** badge and three actions:
- ▶ **Run** — launches it natively (`launcher_run_executable`),
- ⌗ **Run in terminal** — runs the exe path in a new terminal tab,
- 🗁 **Open containing folder**.

So for a Rust project: hit `build` (or `build --release`), **Rescan**, and run
the produced binary in one click — no digging through `target/`.

---

## 2. Adaptive layout (narrow / small windows)
- New reusable **`useElementWidth`** hook (ResizeObserver) — panels adapt to the
  *panel's* width, not just the window.
- The Dev Tools **tab bar** now: scrolls horizontally instead of wrapping/
  breaking, and **collapses to icon-only** (label → tooltip) below ~430px, with
  an accent underline on the active tab and per-tab icons. New `.lx-noscrollbar`
  utility keeps the scroll gesture without a visible bar.
- Dev Tools headers/toolbars wrap gracefully instead of overflowing.

> This hook + pattern is the foundation for making every panel narrow-window
> friendly; Dev Tools is the first adopter. I'll roll it into the other tab bars
> in the next passes.

---

## 3. Polish
- Dev Tools tabs got icons + a consistent active-state (accent underline),
  matching the rest of the app chrome.
- All new strings localized RU + EN.

---

## Coming next — pass 15
*Browser-style tab groups* (named, colored, collapsible groups for the project
tabs, with an "add to group" context menu) — a bigger, self-contained feature
I'm building separately so it lands properly tested.

---

## Verification (all green)
- `tsc --noEmit`: **0 errors**
- `bun test src`: **211 / 211 pass** (+16 new `runDetect` tests)
- `bun run build`: **OK**
- `cargo fmt --all --check` / `clippy -D warnings` / `cargo test -p luxor-core`:
  **unchanged & green** (no Rust touched this pass)
- `src-tauri`: still not compiled in my sandbox (no webkit/gtk) — but this pass
  added **no** Rust, so there's nothing new to compile-verify here.
