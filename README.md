<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Luxor" width="96" />
</p>

<h1 align="center">Luxor</h1>

<p align="center">
  <b>An open-source desktop cockpit for AI-assisted coding.</b><br/>
  Not another code editor — Luxor sits <i>next to</i> VS Code / Zed and gives you the
  mission-control around them: terminals, projects, Git, AI agents and dev tools in one window.
</p>

<p align="center">
  English · Русский (full UI translation, switch in Settings → Interface)
</p>

---

## Why Luxor

You run an AI agent in one terminal, a dev server in another, `git status` in a third, and keep
a browser and a notes file open next to them. Luxor puts all of that in one window, remembers
how you arranged it, and stays out of the way when you just want to type.

## Features

### Terminals
- **Real PTY shells** (ConPTY on Windows, openpty on Unix) rendered with xterm.js + WebGL.
  Split, stack and arrange them freely (dockview).
- **Terminals survive a restart**: the output (with colours), the unsent input line and — for
  shells that report it — the working directory come back under a "restored" marker.
  Passwords typed at `Password:` prompts are never saved. Turn it off in Settings → Terminal.
- **Layout presets**: save an arrangement including working directories and autorun commands
  (`cargo watch` left, `bun run dev` right, logs at the bottom). Autorun from a saved layout
  always asks first.
- Command-finished and "AI agent is waiting for you" notifications, per-terminal CPU/RAM badge,
  clickable `file:line` paths, in-terminal search, command history (`Ctrl+Shift+R`).

### Projects and Git
- **Project tabs** (top bar or side bar), per-project layouts, recent projects, blank
  workspaces without a folder, `luxor <path>` from the shell.
- **Git explorer** powered by libgit2 — no git CLI required: status, staging, commits,
  side-by-side diffs, history, blame, branches, stash, tags, fetch / pull / push. Tokens live in
  the OS keychain; ssh-agent and credential helpers also work.
- **GitHub**: issues, pull requests and CI runs for the repository you have open.

### Files and code
- File explorer with a built-in CodeMirror 6 editor (autosave, on-disk conflict guard,
  encodings), search & replace across the project, image / PDF / SQLite viewers, HTML and
  Markdown preview.

### AI agents
- Detects running agents (Claude Code, Codex, Gemini CLI, …), shows their CPU/RAM, notifies when
  one stops and waits for you; a skills manager for the `.claude` / `.agents` / `.cursor` …
  skill folders (project and global); a Kanban task board; snippets, notes and bookmarks.

### Dev tools
- Quick actions (open in IDE / file manager, run discovered executables, pinned commands),
  Docker containers and images, REST scratch pad, `.env` / logs / disk / dependency / process
  inspectors, an optional built-in browser.
- **Local analytics**: a WakaTime-style activity tracker with insights and a static project
  audit. Everything stays in `local_stats.db` on your machine; Paranoid Mode turns it all off.

### Comfort
- Command palette (`Ctrl+Shift+P`), 15 themes, accent colour, adaptive layout down to small
  windows, tray with "keep running in the background", zen mode, configurable status bar,
  side bar and right-hand widget panel.

## Install

Grab the installer for your platform from the
[releases page](https://github.com/adxptived/luxor/releases) (Windows `.msi`/`.exe`,
Linux `.deb`/`.AppImage`, macOS `.dmg`). Windows is the primary target; Linux and macOS builds
come from the same CI.

Luxor checks GitHub Releases for a newer version once at startup and shows a toast with an
**Open release** button; installation stays a manual step. Disable it in Settings → Interface.

## Default hotkeys

All of these can be rebound in Settings → Hotkeys. On macOS `Ctrl` means `⌘`.

| Chord | Action |
| --- | --- |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+P` | Switch project |
| `Ctrl+O` | Open project folder |
| ``Ctrl+` `` | New terminal |
| `Ctrl+Shift+G` | Git explorer |
| `Ctrl+Shift+E` | File explorer |
| `Ctrl+Shift+F` | Search in project |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+Z` | Zen mode |
| `Ctrl+PageDown` / `Ctrl+PageUp` | Next / previous tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Alt+S` | Save all files |

In a terminal: `Ctrl+F` search, `Ctrl+Shift+R` command history.

## Privacy and network

Luxor has **no cloud account and sends no telemetry**. Activity analytics are written to a local
SQLite file and never leave the machine. Secrets (git tokens) live only in the OS keychain —
never in files, the database or logs.

The app talks to the network only when you use a feature that needs it:

| Feature | Destination |
| --- | --- |
| Git fetch / pull / push | the remote you configured |
| GitHub panel | `api.github.com` (your token is only sent there) |
| Update check (once per start, can be disabled) | GitHub Releases of `adxptived/luxor` |
| HTTP client panel | the URL you request |
| Built-in browser (optional) | the pages you open |

## Develop

Prerequisites: [Rust](https://rustup.rs) (stable), [Bun](https://bun.sh), and the
[Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
bun install          # frontend deps
bun tauri dev        # run the app in dev mode (or: cargo tauri dev)

cargo test -p luxor-core   # the platform-independent core (all the logic)
bun test src               # frontend unit tests
bun run e2e                # Playwright against the mocked backend
```

UI without Tauri (browser, mocked backend): `bun run dev` → http://localhost:5173.

## Architecture

```
crates/luxor-core   # all logic: pty, git, projects, layouts, config, secrets, telemetry …
src-tauri           # thin Tauri v2 shell: IPC commands + events
src                 # React + TypeScript UI: dockview, xterm.js, CodeMirror 6, zustand, Tailwind
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and invariants, and
[CONTRIBUTING.md](CONTRIBUTING.md) if you would like to help. Release notes are in
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
