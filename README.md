<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Luxor" width="96" />
</p>

<h1 align="center">Luxor</h1>

<p align="center">
  <b>An open-source desktop cockpit for AI-assisted coding.</b><br/>
  Not another code editor — Luxor sits <i>next to</i> VS Code / Zed and gives you the
  mission-control around them: terminals, projects, git and AI services in one window.
</p>

---

## Features

- **🖥 Real multi-terminals** — true PTY shells (ConPTY on Windows, openpty on Unix) rendered
  with xterm.js + WebGL. Split, stack and arrange them freely (dockview), then save the
  arrangement as a **layout preset** — including working directories and autorun commands
  (e.g. `cargo watch` left, `bun run dev` right, logs at the bottom).
- **🗂 Project tabs** — every project is a tab (top bar or side bar, your choice). Per-project
  layouts are restored when you switch. Project registry is stored in SQLite.
- **⎇ Git explorer** — status, staging, commits, side-by-side CodeMirror diffs, commit history,
  per-file history, branches (create/checkout/delete), stash, fetch / pull / push. Powered by
  libgit2 — no git CLI required. Tokens live in the OS keychain; ssh-agent and git credential
  helpers are also supported.
- **🚀 Quick actions** — open the project in an external terminal, file manager or any detected
  IDE (VS Code, Cursor, Zed, …), auto-discover runnable executables in the project, and pin
  favorite commands that launch in a new terminal tab.

## Install

Grab the installer for your platform from the
[releases page](../../releases) (Windows `.msi`/`.exe`, Linux `.deb`/`.AppImage`, macOS `.dmg`).

Windows is the primary target; Linux and macOS builds are produced by the same CI.

## Develop

Prerequisites: [Rust](https://rustup.rs) (stable), [Bun](https://bun.sh),
and the [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
bun install          # frontend deps
bun tauri dev        # run the app in dev mode (or: cargo tauri dev)

# the platform-independent core (all the logic) builds & tests standalone:
cargo test -p luxor-core
```

UI without Tauri (browser, mocked backend): `bun run dev` → http://localhost:5173.

## Architecture

```
crates/luxor-core   # all logic: pty, git, projects, layouts, config, secrets
src-tauri           # thin Tauri v2 shell: IPC commands + events
src                 # React + TypeScript UI: dockview, xterm.js, CodeMirror 6, zustand, Tailwind
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details, and
[CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to help.

## Component Playground

A lightweight component playground is available in dev mode at `http://localhost:5173/?playground`.
It renders key UI components (buttons, toasts, cards, inputs, badges) in isolation
for visual testing and development. See `src/components/ComponentPlayground.tsx`.

## Default hotkeys

| Chord | Action |
| --- | --- |
| `Ctrl+\`` | New terminal |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+G` | Git explorer |
| `Ctrl+,` | Settings |

## Security

- Secrets (git tokens, AI provider keys) are stored **only** in the OS keychain — never in
  files, the database or logs.
- Keys are only ever sent to the service you configured them for (a git host, or the local
  configured local services). **No telemetry.**

## License

[MIT](LICENSE)
