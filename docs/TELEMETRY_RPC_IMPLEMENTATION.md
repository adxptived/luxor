# Telemetry, Dashboards & Discord RPC — Implementation Report

This document maps the [plan](../plans/luxor_discord_rpc_plan.md) onto the code
that now ships in the repository, and lists what was deliberately deferred.

> ⚠️ **Build verification needed.** This work was authored in an environment
> without a Rust toolchain, so it has **not** been compiled. Run
> `cargo build` / `cargo test -p luxor-core` and `bun run tsc` / `bun test`
> before merging. The pure-logic modules ship with unit tests (see below).

## What was implemented (Phases 1–2 of the roadmap)

### Backend — `luxor-core`

| File | Plan parts | Contents |
|------|-----------|----------|
| `crates/luxor-core/src/telemetry.rs` | 1, 2, 7, 11, 5.6 | `TelemetryStore` (SQLite **WAL**, in-place `user_version` migrations, UTC), full data model (`activity_intervals`, `projects`, `daily_rollups`, `git_events`, `achievements`), recording API, dashboard queries (today summary + Δ vs yesterday, weekday breakdown, AI-agent donut, 365-day heatmap, project log, streak, achievements), 90-day **retention** compaction, JSON export & wipe. Pure helpers (`lang_from_ext`, `git_flow_state`, `hash_path`, session-gap) + 7 unit tests. |
| `crates/luxor-core/src/discord.rs` | 4, 8, 5.3, 5.4 | Presence model + 128-char/2-button sanitiser, **carousel** rotation, **priority queue** (Background/Action/Critical), `build_carousel_frames`, masking (`mask_project_name`, `mask_file_label`), regex/glob **blacklist**, anti-flicker `state_hash`, and a **raw Discord IPC transport** (`std`-only, Unix Domain Socket / Windows Named Pipe, opcode framing, handshake, rate-limit, exponential backoff). 9 unit tests. |

Both modules are registered in `crates/luxor-core/src/lib.rs`.
**No new crate dependencies** were added — the store reuses the existing
`rusqlite`/`chrono`/`sha2`, and the Discord transport is implemented directly
on `std`, which keeps the build surface small and the core crate GUI-free.

### Backend — Tauri layer (`src-tauri`)

| File | Commands |
|------|----------|
| `src-tauri/src/commands/telemetry.rs` | `telemetry_record`, `telemetry_git_event`, `telemetry_bump_audit`, `telemetry_dashboard`, `telemetry_set_masking`, `telemetry_set_achievement`, `telemetry_export`, `telemetry_wipe` + `spawn_background` (6-hourly retention task). |
| `src-tauri/src/commands/discord.rs` | `DiscordEngine` (carousel+queue+IPC+settings) and `discord_status`, `discord_apply_settings`, `discord_update`, `discord_push_event`, `discord_clear`. |

Wiring (`src-tauri/src/lib.rs`, `state.rs`, `commands/mod.rs`):
- `AppState` gains `telemetry: Mutex<TelemetryStore>` and `discord: Mutex<DiscordEngine>`.
- Store opens at `{config}/luxor/local_stats.db` (temp-dir fallback so startup never blocks).
- All commands registered in `invoke_handler`; retention task spawned in `setup`.

### Frontend (`src`)

| File | Plan parts |
|------|-----------|
| `src/lib/analytics.ts` | Typed IPC bridge (snake_case to match serde), an **always-on background driver** (`startTelemetryDriver`) that samples focus + busy AI agent + active project on a 30 s cadence and pushes presence, plus a dev mock so the page works in `vite dev`. |
| `src/panels/AnalyticsPanel.tsx` | 3, 5, 1.5 | Summary cards, weekday stacked bars, AI donut, **365-day contribution heatmap**, project log, **gamification** (streak + achievements), and the **Discord & Privacy** controls (enable, per-field toggles, rotation slider, masking, blacklist, client-id, export/wipe, local-first banner). Charts are inline SVG — **no chart dependency to install**. |

Panel registration: `analytics` added to `PanelKind`, `PANEL_TITLES`,
`DockLayout` component map + tab icon, `navButtons.ts`, and `navActions.ts`
(open + open-new).

## How to finish wiring (post-build)

1. **Discord assets & app id.** Create a Discord application, upload the asset
   keys referenced in the plan (`lang_rust`, `ai_claude`, `audit_ok`, …) and set
   the client id in the Analytics → *Discord & Privacy* panel (or the
   `DEFAULT_CLIENT_ID` constant in `commands/discord.rs`). RPC stays disabled
   while the id is empty.
2. **Git events.** Call `telemetryGitEvent(...)` from the existing git
   commit/branch flows to populate commit/line counters and `git_events`.
3. **Audit counters.** Call `telemetryBumpAudit(runs, fixed)` when an audit run
   finishes (part 1.3 killer-feature metrics).
4. **OS focus / idle.** The driver currently gates idle on `document.hasFocus()`.
   For true cross-process active-window + input-idle detection (plan part 9),
   add an OS hook in `luxor-core` and feed `Sample { is_focused, category: Idle }`.

## Phase 3–4 backlog — now implemented

A second pass added the "wow" features and ecosystem hooks:

| File | Plan parts | Contents |
|------|-----------|----------|
| `crates/luxor-core/src/insights.rs` | 11.1–11.2, 1.4 | Insights Engine: weekly digest, prime-time, AI-dependency index, burnout & night-owl detection, rule-based insight generation, achievement evaluation. 4 unit tests. |
| `crates/luxor-core/src/cards.rs` | 12.1, 12.3 | Shareable weekly card + Year-in-Review card as self-contained SVG (no render dep). 2 unit tests. |
| `crates/luxor-core/src/metricprovider.rs` | 13.1 | `MetricProvider` trait + `MetricRegistry` (namespacing, enable/disable) for plugin extensibility. 1 unit test. |
| `crates/luxor-core/src/webhook.rs` | 13.2, 18 | Slack & Telegram digest delivery via existing `reqwest`. 1 unit test. |
| `crates/luxor-core/src/activity_os.rs` | 9.3, 1.4 | OS idle/AFK detection (Windows `GetLastInputInfo`, macOS `CGEventSourceSecondsSinceLastEventType`, Linux → `None`). No keylogging. |

New telemetry queries (`telemetry.rs`): `hourly_distribution`, `longest_session_seconds`, `year_in_review`, `commits_since`, `issues_fixed_total`, `export_csv`, `export_wakatime`.

New Tauri commands: `telemetry_insights`, `telemetry_year_in_review`,
`telemetry_export_csv`, `telemetry_export_wakatime`, `telemetry_shareable_card`,
`telemetry_year_card`, `telemetry_evaluate_achievements`,
`telemetry_idle_seconds`, `webhook_send_digest`.

Frontend: the Analytics panel now shows an **Insights** card and an
**Export & Share** card (weekly/Year SVG cards, CSV + WakaTime export, Slack/
Telegram digest sender). The background driver consumes OS idle to gate AFK.
Git commits are recorded from `GitPanel` via `telemetryGitEvent`.

### Truly remaining (small, config-only)

- Real Discord asset upload + app id (config-only, no code) — set the client id
  in the Analytics → *Discord & Privacy* panel.
- Optional: persist webhook URLs and auto-send the weekly digest on a timer
  (the digest builder + sender are done; today it is sent on demand from the
  *Export & Share* card).
- macOS active-window uses the front **app name** (not per-window title) via
  `osascript`; Linux active-window needs `xdotool`, Linux idle needs
  `xprintidle` — both degrade gracefully to focus-based tracking when absent.

## Deferred to backlog (Phases 3–4)

Not implemented in this pass, with the hooks already in place to add them:
- Insights Engine weekly digest & rule-based heuristics / local ML (part 11.2–11.3).
- Shareable cards & Year-in-Review (part 12.1, 12.3); WakaTime-format export.
- Burnout alerts / night-coding nudges as live notifications (part 1.4).
- Plugin `MetricProvider` trait & webhook integrations (part 13).
- Team mode / leaderboards & CLI companion (part 16, Phase 4).
