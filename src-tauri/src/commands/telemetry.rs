//! Local activity telemetry commands (plan parts 2, 3, 5, 7, 11).
//!
//! The frontend drives sampling: on its existing poll cadence it reports what
//! the user is doing (active project, branch, AI agent, focus) and this layer
//! records an atomic interval. Dashboard queries answer the Analytics page in
//! a single round-trip.

use chrono::{Duration as ChronoDuration, Utc};
use luxor_core::cards;
use luxor_core::insights::{self, Insight, WeeklyDigest};
use luxor_core::telemetry::{
    Achievement, Category, DashboardSnapshot, GitEvent, Sample, TelemetryStore, YearInReview,
};
use luxor_core::webhook;
use luxor_core::Error;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

fn lock<'a>(state: &'a State<'_, AppState>) -> std::sync::MutexGuard<'a, TelemetryStore> {
    state
        .telemetry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One activity report from the frontend poller.
#[derive(Debug, Clone, Deserialize)]
pub struct SampleInput {
    /// "coding" | "ai" | "audit" | "idle"
    pub category: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub agent: Option<String>,
    pub branch: Option<String>,
    #[serde(default = "default_true")]
    pub is_focused: bool,
    /// Seconds this sample covers (the poll interval).
    pub duration_seconds: i64,
}

fn default_true() -> bool {
    true
}

/// Record an atomic activity interval ending now (plan part 2/7).
#[tauri::command(async)]
pub fn telemetry_record(state: State<'_, AppState>, sample: SampleInput) -> Result<(), Error> {
    let dur = sample.duration_seconds.clamp(0, 3600);
    if dur == 0 {
        return Ok(());
    }
    let to = Utc::now();
    let from = to - ChronoDuration::seconds(dur);
    let s = Sample {
        at: to,
        category: Category::parse(&sample.category),
        project_path: sample.project_path,
        project_name: sample.project_name,
        agent: sample.agent,
        branch: sample.branch,
        is_focused: sample.is_focused,
    };
    lock(&state).record_interval(from, to, &s)
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitEventInput {
    pub project_path: Option<String>,
    /// "commit" | "branch_switch" | "merge"
    pub event_type: String,
    #[serde(default)]
    pub lines_added: i64,
    #[serde(default)]
    pub lines_removed: i64,
    pub branch: Option<String>,
}

/// Record a git event (commit / branch switch / merge) — plan part 1.2/7.
#[tauri::command(async)]
pub fn telemetry_git_event(state: State<'_, AppState>, event: GitEventInput) -> Result<(), Error> {
    let ev = GitEvent {
        at: Utc::now(),
        project_path: event.project_path,
        event_type: event.event_type,
        lines_added: event.lines_added,
        lines_removed: event.lines_removed,
        branch: event.branch,
    };
    lock(&state).record_git_event(&ev)
}

/// Bump today's audit counters (plan part 1.3 killer feature).
#[tauri::command(async)]
pub fn telemetry_bump_audit(
    state: State<'_, AppState>,
    audits_run: i64,
    issues_fixed: i64,
) -> Result<(), Error> {
    lock(&state).bump_audit(audits_run.max(0), issues_fixed.max(0))
}

/// One round-trip for the whole Analytics dashboard (plan part 3).
#[tauri::command(async)]
pub fn telemetry_dashboard(state: State<'_, AppState>) -> Result<DashboardSnapshot, Error> {
    lock(&state).dashboard()
}

/// Toggle project-name masking (plan part 5.3).
#[tauri::command(async)]
pub fn telemetry_set_masking(state: State<'_, AppState>, masked: bool) -> Result<(), Error> {
    lock(&state).mask_projects = masked;
    Ok(())
}

/// Persist achievement progress (plan part 1.5).
#[tauri::command(async)]
pub fn telemetry_set_achievement(
    state: State<'_, AppState>,
    key: String,
    progress: f64,
    unlocked: bool,
) -> Result<(), Error> {
    lock(&state).set_achievement(&key, progress, unlocked)
}

/// Export all telemetry as JSON (plan part 5.6).
#[tauri::command(async)]
pub fn telemetry_export(state: State<'_, AppState>) -> Result<serde_json::Value, Error> {
    lock(&state).export_json()
}

/// Wipe all local telemetry (plan part 5.6 "delete all history").
#[tauri::command(async)]
pub fn telemetry_wipe(state: State<'_, AppState>) -> Result<(), Error> {
    lock(&state).wipe()
}

/// Insights report returned to the dashboard (plan part 11).
#[derive(Debug, Clone, Serialize)]
pub struct InsightsReport {
    pub digest: WeeklyDigest,
    pub insights: Vec<Insight>,
}

/// Gather the weekly digest + supporting signals from the store.
fn gather_digest(store: &TelemetryStore) -> Result<(WeeklyDigest, i64, [i64; 24], i64), Error> {
    let fortnight = store.weekday_breakdown(14)?;
    let split = fortnight.len().saturating_sub(7);
    let this_week = &fortnight[split..];
    let last_week_total: i64 = fortnight[..split]
        .iter()
        .map(|d| d.coding_seconds + d.ai_seconds + d.audit_seconds)
        .sum();
    let agents = store.agent_breakdown(7)?;
    let projects = store.project_log(7, 5)?;
    let commits = store.commits_since(7)?;
    let hourly = store.hourly_distribution(7)?;
    let longest = store.longest_session_seconds(7)?;
    let streak = store.streak_days()?;
    let digest = insights::build_weekly_digest(
        this_week,
        Some(last_week_total),
        &agents,
        &projects,
        commits,
        &hourly,
    );
    Ok((digest, longest, hourly, streak))
}

/// Weekly digest + rule-based insights (plan part 11).
#[tauri::command(async)]
pub fn telemetry_insights(state: State<'_, AppState>) -> Result<InsightsReport, Error> {
    let store = lock(&state);
    let (digest, longest, hourly, streak) = gather_digest(&store)?;
    let insights = insights::generate_insights(&digest, longest, &hourly, streak);
    Ok(InsightsReport { digest, insights })
}

/// Year-in-Review aggregate (plan part 12.3).
#[tauri::command(async)]
pub fn telemetry_year_in_review(state: State<'_, AppState>) -> Result<YearInReview, Error> {
    lock(&state).year_in_review()
}

/// CSV export of the last `days` of daily totals (plan part 5.6 / 12.2).
#[tauri::command(async)]
pub fn telemetry_export_csv(state: State<'_, AppState>, days: Option<i64>) -> Result<String, Error> {
    lock(&state).export_csv(days.unwrap_or(90).clamp(1, 365))
}

/// WakaTime-format export (plan part 12.2).
#[tauri::command(async)]
pub fn telemetry_export_wakatime(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> Result<serde_json::Value, Error> {
    lock(&state).export_wakatime(days.unwrap_or(7).clamp(1, 365))
}

/// Render a shareable weekly card as SVG (plan part 12.1).
#[tauri::command(async)]
pub fn telemetry_shareable_card(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<String, Error> {
    let store = lock(&state);
    let (digest, _, _, _) = gather_digest(&store)?;
    Ok(cards::weekly_card_svg(&digest, &title.unwrap_or_else(|| "Эта неделя".into())))
}

/// Render a Year-in-Review card as SVG (plan part 12.3).
#[tauri::command(async)]
pub fn telemetry_year_card(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<String, Error> {
    let yir = lock(&state).year_in_review()?;
    Ok(cards::year_in_review_svg(&yir, &title.unwrap_or_else(|| "Год с Luxor".into())))
}

/// Evaluate achievement progress from aggregate stats, persist, and return the
/// updated catalogue (plan part 1.5).
#[tauri::command(async)]
pub fn telemetry_evaluate_achievements(
    state: State<'_, AppState>,
) -> Result<Vec<Achievement>, Error> {
    let store = lock(&state);
    let yir = store.year_in_review()?;
    let streak = store.streak_days()?;
    let issues = store.issues_fixed_total()?;
    let hourly = store.hourly_distribution(365)?;
    let night: i64 = hourly[0..6].iter().sum();
    for (key, progress, unlocked) in insights::evaluate_achievements(&yir, streak, issues, night) {
        store.set_achievement(&key, progress, unlocked)?;
    }
    store.achievements()
}

/// Push the weekly digest to Slack and/or Telegram (plan part 13.2).
#[tauri::command]
pub async fn webhook_send_digest(
    state: State<'_, AppState>,
    slack_url: Option<String>,
    telegram_token: Option<String>,
    telegram_chat: Option<String>,
) -> Result<(), Error> {
    // Build the message while holding the lock, then drop it before awaiting.
    let message = {
        let store = lock(&state);
        let (digest, _, _, _) = gather_digest(&store)?;
        webhook::digest_message(&digest)
    };
    let slack_url = slack_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let telegram_token = telegram_token.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let telegram_chat = telegram_chat.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if slack_url.is_none() && !(telegram_token.is_some() && telegram_chat.is_some()) {
        return Err(Error::InvalidInput(
            "provide a Slack webhook URL or Telegram bot token + chat ID".into(),
        ));
    }
    if let Some(url) = slack_url {
        webhook::send_slack(&url, &message).await?;
    }
    if let (Some(token), Some(chat)) = (telegram_token, telegram_chat) {
        webhook::send_telegram(&token, &chat, &message).await?;
    }
    Ok(())
}

/// OS idle time in seconds (plan part 9.3); `None` when unsupported.
#[tauri::command(async)]
pub fn telemetry_idle_seconds() -> Result<Option<u64>, Error> {
    Ok(luxor_core::activity_os::idle_seconds())
}

/// Foreground window title / front-app name (plan part 1.1); `None` when
/// unsupported. Used by the frontend to credit a focused AI tool.
#[tauri::command(async)]
pub fn telemetry_active_window() -> Result<Option<String>, Error> {
    Ok(luxor_core::active_window::foreground_title())
}

/// Spawn the background retention task: every 6 hours, fold raw intervals
/// older than the retention window into daily rollups and prune them
/// (plan part 7.2). Kept tiny and off the UI thread (zero-overhead).
pub fn spawn_background(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(6 * 3600));
        loop {
            ticker.tick().await;
            if let Some(state) = app.try_state::<AppState>() {
                let store = state
                    .telemetry
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                match store.run_retention() {
                    Ok(n) if n > 0 => tracing::info!("telemetry retention pruned {n} rows"),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("telemetry retention failed: {e}"),
                }
                // Refresh achievement progress from aggregate stats (part 1.5).
                if let (Ok(yir), Ok(streak), Ok(issues), Ok(hourly)) = (
                    store.year_in_review(),
                    store.streak_days(),
                    store.issues_fixed_total(),
                    store.hourly_distribution(365),
                ) {
                    let night: i64 = hourly[0..6].iter().sum();
                    for (key, progress, unlocked) in
                        insights::evaluate_achievements(&yir, streak, issues, night)
                    {
                        let _ = store.set_achievement(&key, progress, unlocked);
                    }
                }
            }
        }
    });
}
