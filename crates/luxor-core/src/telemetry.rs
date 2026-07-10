//! Local-first activity telemetry — a WakaTime/RescueTime-class tracker built
//! straight into Luxor (see `plans/luxor_discord_rpc_plan.md`, parts 1, 2, 7, 11).
//!
//! Design goals:
//! - **Zero-overhead:** the heavy lifting (sampling, git inspection) happens in
//!   the Tauri layer on an existing background cadence; this module only records
//!   pre-computed samples and answers dashboard queries.
//! - **Local-first / privacy:** everything lives in `{config}/luxor/local_stats.db`
//!   and never leaves the machine. Project names can be masked (part 5).
//! - **Never break user data:** schema is migrated in-place via `PRAGMA
//!   user_version`, mirroring [`crate::projects`].
//!
//! The store keeps **raw atomic intervals** (`activity_intervals`) plus a
//! denormalised `daily_rollups` table for fast dashboards. Raw intervals older
//! than the retention window are folded into rollups and pruned so the DB stays
//! compact (tens of MB over years).

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{Error, Result};

/// Schema version of the telemetry database. Bump when adding migrations.
const SCHEMA_VERSION: i64 = 1;

/// Raw intervals older than this many days are compacted into `daily_rollups`
/// and deleted (part 7.2 retention).
pub const RETENTION_DAYS: i64 = 90;

/// A session is considered closed when its category process has been absent for
/// longer than this (part 1.1).
pub const SESSION_GAP_SECONDS: i64 = 30 * 60;

/// What the user was doing during an interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    /// Hand-writing code (IDE / editor focused, no AI agent active).
    Coding,
    /// Pair-programming with an AI agent (Claude Code, Cursor, Copilot…).
    Ai,
    /// Running a Luxor security audit.
    Audit,
    /// Idle / AFK.
    Idle,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Coding => "coding",
            Category::Ai => "ai",
            Category::Audit => "audit",
            Category::Idle => "idle",
        }
    }
    pub fn from_str(s: &str) -> Category {
        match s {
            "ai" => Category::Ai,
            "audit" => Category::Audit,
            "idle" => Category::Idle,
            _ => Category::Coding,
        }
    }
}

/// One observation fed in by the Tauri sampler (already debounced upstream).
#[derive(Debug, Clone)]
pub struct Sample {
    pub at: DateTime<Utc>,
    pub category: Category,
    /// Absolute project path (hashed before storage when masking is on).
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    /// Detected AI agent display name, e.g. "Claude Code".
    pub agent: Option<String>,
    pub branch: Option<String>,
    /// Was the relevant window in the foreground (part 1.1)?
    pub is_focused: bool,
}

/// A git activity event (commit / branch switch / merge) — part 7 `git_events`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitEvent {
    pub at: DateTime<Utc>,
    pub project_path: Option<String>,
    /// "commit" | "branch_switch" | "merge"
    pub event_type: String,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub branch: Option<String>,
}

/// Summary card data for "today" (part 3.1).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TodaySummary {
    pub total_seconds: i64,
    pub ai_seconds: i64,
    pub coding_seconds: i64,
    pub audit_seconds: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub commits: i64,
    pub audits_run: i64,
    pub issues_fixed: i64,
    /// AI-time delta vs yesterday, percent (part 3.1: "+12% со вчера").
    pub ai_delta_pct: Option<f64>,
}

/// One stacked bar for the weekday chart (part 3.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayBucket {
    pub date: String, // YYYY-MM-DD (local)
    pub coding_seconds: i64,
    pub ai_seconds: i64,
    pub audit_seconds: i64,
}

/// A slice of the AI-agent donut (part 3.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSlice {
    pub agent: String,
    pub seconds: i64,
}

/// One cell of the GitHub-style contribution heatmap (part 3.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatCell {
    pub date: String, // YYYY-MM-DD (local)
    pub seconds: i64,
}

/// Time spent per project (part 3.6 project log).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTime {
    pub name: String,
    pub seconds: i64,
    pub primary_lang: Option<String>,
}

/// Gamification achievement (part 1.5 / 3.5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Achievement {
    pub key: String,
    pub title: String,
    pub description: String,
    /// 0.0 → 1.0
    pub progress: f64,
    pub unlocked_at: Option<i64>,
}

/// Everything the dashboard needs in one round-trip (part 3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSnapshot {
    pub today: TodaySummary,
    pub week: Vec<DayBucket>,
    pub agents: Vec<AgentSlice>,
    pub heatmap: Vec<HeatCell>,
    pub projects: Vec<ProjectTime>,
    pub streak_days: i64,
    pub achievements: Vec<Achievement>,
}

/// Aggregated "Year in Review" snapshot (plan part 12.3).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct YearInReview {
    pub total_seconds: i64,
    pub ai_seconds: i64,
    pub coding_seconds: i64,
    pub commits: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub top_projects: Vec<ProjectTime>,
    pub top_agents: Vec<AgentSlice>,
    pub busiest_day: Option<String>,
    pub active_days: i64,
}

/// SQLite-backed telemetry store. One instance per app (held behind a `Mutex`
/// in the Tauri `AppState`). WAL mode lets the dashboard read while the
/// background engine writes.
pub struct TelemetryStore {
    conn: Connection,
    /// When true, project paths are stored as SHA256 hashes and names are
    /// replaced with a generic placeholder (part 5 privacy).
    pub mask_projects: bool,
}

impl TelemetryStore {
    /// Default DB path: `{config_dir}/luxor/local_stats.db`.
    pub fn default_path() -> Result<PathBuf> {
        let base = dirs::config_dir()
            .ok_or_else(|| Error::Config("no config directory".into()))?;
        Ok(base.join("luxor").join("local_stats.db"))
    }

    /// Open (and migrate) the store at `path`. Parent dirs are created.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let mut store = Self { conn, mask_projects: false };
        store.migrate()?;
        Ok(store)
    }

    /// In-memory store for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let mut store = Self { conn, mask_projects: false };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        // v1 — initial schema (part 7.1).
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS activity_intervals (
                id          INTEGER PRIMARY KEY,
                start_utc   INTEGER NOT NULL,   -- Unix ms, UTC
                end_utc     INTEGER NOT NULL,
                category    TEXT NOT NULL,      -- 'coding'|'ai'|'audit'|'idle'
                project_id  INTEGER,
                agent       TEXT,
                branch      TEXT,
                is_focused  INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_intervals_time
                ON activity_intervals(start_utc, end_utc);
            CREATE INDEX IF NOT EXISTS idx_intervals_cat
                ON activity_intervals(category);

            CREATE TABLE IF NOT EXISTS projects (
                id           INTEGER PRIMARY KEY,
                path_hash    TEXT UNIQUE,       -- SHA256 of path (or plain path)
                display_name TEXT,
                is_masked    INTEGER NOT NULL DEFAULT 0,
                primary_lang TEXT,
                color        TEXT
            );

            CREATE TABLE IF NOT EXISTS daily_rollups (
                date           TEXT PRIMARY KEY, -- YYYY-MM-DD (local)
                total_seconds  INTEGER NOT NULL DEFAULT 0,
                ai_seconds     INTEGER NOT NULL DEFAULT 0,
                coding_seconds INTEGER NOT NULL DEFAULT 0,
                audit_seconds  INTEGER NOT NULL DEFAULT 0,
                commits        INTEGER NOT NULL DEFAULT 0,
                lines_added    INTEGER NOT NULL DEFAULT 0,
                lines_removed  INTEGER NOT NULL DEFAULT 0,
                audits_run     INTEGER NOT NULL DEFAULT 0,
                issues_fixed   INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS git_events (
                id            INTEGER PRIMARY KEY,
                ts_utc        INTEGER NOT NULL,
                project_id    INTEGER,
                event_type    TEXT NOT NULL,
                lines_added   INTEGER NOT NULL DEFAULT 0,
                lines_removed INTEGER NOT NULL DEFAULT 0,
                branch        TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_git_events_time ON git_events(ts_utc);

            CREATE TABLE IF NOT EXISTS achievements (
                key         TEXT PRIMARY KEY,
                progress    REAL NOT NULL DEFAULT 0,
                unlocked_at INTEGER
            );
            "#,
        )?;
        self.conn
            .pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    /// Resolve (or create) the project row id for a path, honouring masking.
    fn project_id(&self, path: Option<&str>, name: Option<&str>) -> Result<Option<i64>> {
        let Some(path) = path else { return Ok(None) };
        let key = if self.mask_projects {
            hash_path(path)
        } else {
            path.to_string()
        };
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM projects WHERE path_hash = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Ok(Some(id));
        }
        let display = if self.mask_projects {
            "Private Project".to_string()
        } else {
            name.map(str::to_string)
                .or_else(|| basename(path))
                .unwrap_or_else(|| "Project".into())
        };
        // primary_lang is filled in later by a git/language scan.
        let lang: Option<String> = None;
        self.conn.execute(
            "INSERT INTO projects(path_hash, display_name, is_masked, primary_lang)
             VALUES(?1, ?2, ?3, ?4)",
            params![key, display, self.mask_projects as i64, lang],
        )?;
        Ok(Some(self.conn.last_insert_rowid()))
    }

    /// Record one atomic interval. `from`..`to` are UTC; `to` must be >= `from`.
    pub fn record_interval(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        sample: &Sample,
    ) -> Result<()> {
        if to < from {
            return Err(Error::InvalidInput("interval end before start".into()));
        }
        let project_id = self.project_id(sample.project_path.as_deref(), sample.project_name.as_deref())?;
        self.conn.execute(
            "INSERT INTO activity_intervals
                (start_utc, end_utc, category, project_id, agent, branch, is_focused)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                from.timestamp_millis(),
                to.timestamp_millis(),
                sample.category.as_str(),
                project_id,
                sample.agent,
                sample.branch,
                sample.is_focused as i64,
            ],
        )?;
        Ok(())
    }

    /// Record a git event and bump today's commit/line counters.
    pub fn record_git_event(&self, ev: &GitEvent) -> Result<()> {
        let project_id = self.project_id(ev.project_path.as_deref(), None)?;
        self.conn.execute(
            "INSERT INTO git_events
                (ts_utc, project_id, event_type, lines_added, lines_removed, branch)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.at.timestamp_millis(),
                project_id,
                ev.event_type,
                ev.lines_added,
                ev.lines_removed,
                ev.branch,
            ],
        )?;
        Ok(())
    }

    /// Increment an audit/issues counter for today's rollup (part 1.3).
    pub fn bump_audit(&self, audits_run: i64, issues_fixed: i64) -> Result<()> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        self.conn.execute(
            "INSERT INTO daily_rollups(date, audits_run, issues_fixed)
             VALUES(?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET
                audits_run = audits_run + ?2,
                issues_fixed = issues_fixed + ?3",
            params![date, audits_run, issues_fixed],
        )?;
        Ok(())
    }

    // ----- queries -------------------------------------------------------

    /// Sum seconds per category between two UTC instants, from raw intervals.
    /// Idle time is omitted from headline productivity metrics.
    fn seconds_by_category(&self, from: i64, to: i64) -> Result<(i64, i64, i64)> {
        let mut coding = 0i64;
        let mut ai = 0i64;
        let mut audit = 0i64;
        let mut stmt = self.conn.prepare(
            "SELECT category, SUM(MIN(end_utc, ?2) - MAX(start_utc, ?1))
             FROM activity_intervals
             WHERE end_utc > ?1 AND start_utc < ?2 AND category != 'idle'
             GROUP BY category",
        )?;
        let rows = stmt.query_map(params![from, to], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1).unwrap_or(0)))
        })?;
        for row in rows {
            let (cat, ms) = row?;
            let secs = (ms.max(0)) / 1000;
            match Category::from_str(&cat) {
                Category::Ai => ai += secs,
                Category::Audit => audit += secs,
                _ => coding += secs,
            }
        }
        Ok((coding, ai, audit))
    }

    /// Seconds `(coding, ai, audit)` previously folded into `daily_rollups`
    /// for one local date. Raw intervals for pruned days are deleted by
    /// [`Self::run_retention`], so per-day dashboards must add this back in
    /// (otherwise the 365-day heatmap / streak / Year-in-Review silently drop
    /// everything older than [`RETENTION_DAYS`]).
    ///
    /// Returns `Result` instead of silently swallowing DB errors: the dashboard
    /// should surface real database corruption rather than pretending history is
    /// empty.
    fn rollup_day(&self, date: &str) -> Result<(i64, i64, i64)> {
        Ok(self
            .conn
            .query_row(
                "SELECT coding_seconds, ai_seconds, audit_seconds
                 FROM daily_rollups WHERE date = ?1",
                params![date],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
            )
            .optional()?
            .unwrap_or((0, 0, 0)))
    }

    /// Sum of rollup seconds `(coding, ai, audit)` over the inclusive local
    /// date range `[from_date, to_date]` (YYYY-MM-DD).
    fn rollup_between(&self, from_date: &str, to_date: &str) -> Result<(i64, i64, i64)> {
        self.conn.query_row(
            "SELECT COALESCE(SUM(coding_seconds),0), COALESCE(SUM(ai_seconds),0),
                    COALESCE(SUM(audit_seconds),0)
             FROM daily_rollups WHERE date >= ?1 AND date <= ?2",
            params![from_date, to_date],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        ).map_err(Error::from)
    }

    fn local_midnight_utc(date: chrono::NaiveDate) -> DateTime<Utc> {
        let midnight = date.and_time(chrono::NaiveTime::MIN);
        Local
            .from_local_datetime(&midnight)
            // Ambiguous midnights can happen around DST changes; choosing the
            // earliest instant keeps day buckets monotonic and prevents double
            // counting. Non-existent local midnights fall back through noon.
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|| {
                let noon = date.and_time(chrono::NaiveTime::from_hms_opt(12, 0, 0).unwrap_or(chrono::NaiveTime::MIN));
                Local
                    .from_local_datetime(&noon)
                    .earliest()
                    .map(|d| d.with_timezone(&Utc) - chrono::Duration::hours(12))
                    .unwrap_or_else(Utc::now)
            })
    }

    fn local_day_bounds(date: chrono::NaiveDate) -> (i64, i64) {
        let start = Self::local_midnight_utc(date);
        let end = Self::local_midnight_utc(date + chrono::Duration::days(1));
        if end > start {
            (start.timestamp_millis(), end.timestamp_millis())
        } else {
            // Extremely defensive fallback for broken OS timezone data.
            (start.timestamp_millis(), (start + chrono::Duration::days(1)).timestamp_millis())
        }
    }

    pub fn today_summary(&self) -> Result<TodaySummary> {
        let today = Local::now().date_naive();
        let (from, to) = Self::local_day_bounds(today);
        let (coding, ai, audit) = self.seconds_by_category(from, to)?;

        // git counters for today
        let (added, removed, commits): (i64, i64, i64) = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(lines_added),0), COALESCE(SUM(lines_removed),0),
                        COALESCE(SUM(CASE WHEN event_type='commit' THEN 1 ELSE 0 END),0)
                 FROM git_events WHERE ts_utc >= ?1 AND ts_utc < ?2",
                params![from, to],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((0, 0, 0));

        let (audits_run, issues_fixed): (i64, i64) = self
            .conn
            .query_row(
                "SELECT COALESCE(audits_run,0), COALESCE(issues_fixed,0)
                 FROM daily_rollups WHERE date = ?1",
                params![today.format("%Y-%m-%d").to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .unwrap_or((0, 0));

        // yesterday AI seconds for delta
        let y = today - chrono::Duration::days(1);
        let (yf, yt) = Self::local_day_bounds(y);
        let (_, ai_y, _) = self.seconds_by_category(yf, yt)?;
        let ai_delta_pct = if ai_y > 0 {
            Some(((ai - ai_y) as f64 / ai_y as f64) * 100.0)
        } else {
            None
        };

        Ok(TodaySummary {
            total_seconds: coding + ai + audit,
            ai_seconds: ai,
            coding_seconds: coding,
            audit_seconds: audit,
            lines_added: added,
            lines_removed: removed,
            commits,
            audits_run,
            issues_fixed,
            ai_delta_pct,
        })
    }

    pub fn weekday_breakdown(&self, days: i64) -> Result<Vec<DayBucket>> {
        let mut out = Vec::new();
        let today = Local::now().date_naive();
        for i in (0..days).rev() {
            let date = today - chrono::Duration::days(i);
            let (from, to) = Self::local_day_bounds(date);
            let (coding, ai, audit) = self.seconds_by_category(from, to)?;
            // Add any retained daily rollup for this day; retention deletes only
            // fully compacted raw rows, so this does not double-count current raw
            // data after the transactional pruning fix below.
            let date_str = date.format("%Y-%m-%d").to_string();
            let (rc, ra, rau) = self.rollup_day(&date_str)?;
            out.push(DayBucket {
                date: date_str,
                coding_seconds: coding + rc,
                ai_seconds: ai + ra,
                audit_seconds: audit + rau,
            });
        }
        Ok(out)
    }

    pub fn agent_breakdown(&self, days: i64) -> Result<Vec<AgentSlice>> {
        let to = Utc::now().timestamp_millis();
        let from = to - days * 86_400_000;
        let mut stmt = self.conn.prepare(
            // Clamp each interval's duration to the window's lower bound so an
            // interval that began before `from` is not over-counted.
            "SELECT agent,
                    SUM(end_utc - MAX(start_utc, ?1))
             FROM activity_intervals
             WHERE category='ai' AND end_utc > ?1 AND agent IS NOT NULL
             GROUP BY agent ORDER BY 2 DESC",
        )?;
        let rows = stmt.query_map(params![from], |r| {
            Ok(AgentSlice {
                agent: r.get(0)?,
                seconds: r.get::<_, i64>(1).unwrap_or(0).max(0) / 1000,
            })
        })?;
        Ok(rows.filter_map(std::result::Result::ok).collect())
    }

    pub fn heatmap(&self, days: i64) -> Result<Vec<HeatCell>> {
        let mut out = Vec::new();
        let today = Local::now().date_naive();
        for i in (0..days).rev() {
            let date = today - chrono::Duration::days(i);
            let (from, to) = Self::local_day_bounds(date);
            let (coding, ai, audit) = self.seconds_by_category(from, to)?;
            // Days older than the retention window only survive as rollups.
            let date_str = date.format("%Y-%m-%d").to_string();
            let (rc, ra, rau) = self.rollup_day(&date_str)?;
            out.push(HeatCell {
                date: date_str,
                seconds: coding + ai + audit + rc + ra + rau,
            });
        }
        Ok(out)
    }

    pub fn project_log(&self, days: i64, limit: i64) -> Result<Vec<ProjectTime>> {
        let to = Utc::now().timestamp_millis();
        let from = to - days * 86_400_000;
        let mut stmt = self.conn.prepare(
            // NOTE: per-project time only covers the retention window — rollups
            // do not carry the project dimension, so pruned days are not shown
            // here (headline year/heatmap totals do include them).
            "SELECT p.display_name, p.primary_lang,
                    SUM(a.end_utc - MAX(a.start_utc, ?1)) AS ms
             FROM activity_intervals a JOIN projects p ON p.id = a.project_id
             WHERE a.end_utc > ?1 AND a.category != 'idle'
             GROUP BY a.project_id ORDER BY ms DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![from, limit], |r| {
            Ok(ProjectTime {
                name: r.get::<_, Option<String>>(0)?.unwrap_or_else(|| "Project".into()),
                primary_lang: r.get(1)?,
                seconds: r.get::<_, i64>(2).unwrap_or(0).max(0) / 1000,
            })
        })?;
        Ok(rows.filter_map(std::result::Result::ok).collect())
    }

    /// Current consecutive-day coding streak (part 1.5).
    pub fn streak_days(&self) -> Result<i64> {
        let mut streak = 0i64;
        let today = Local::now().date_naive();
        for i in 0..366 {
            let date = today - chrono::Duration::days(i);
            let (from, to) = Self::local_day_bounds(date);
            let (c, a, au) = self.seconds_by_category(from, to)?;
            let (rc, ra, rau) = self.rollup_day(&date.format("%Y-%m-%d").to_string())?;
            if c + a + au + rc + ra + rau > 0 {
                streak += 1;
            } else if i == 0 {
                // today empty so far — don't break the streak yet
                continue;
            } else {
                break;
            }
        }
        Ok(streak)
    }

    /// Persist achievement progress (idempotent upsert).
    pub fn set_achievement(&self, key: &str, progress: f64, unlocked: bool) -> Result<()> {
        let unlocked_at = if unlocked {
            Some(Utc::now().timestamp_millis())
        } else {
            None
        };
        self.conn.execute(
            "INSERT INTO achievements(key, progress, unlocked_at)
             VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
                progress = MAX(progress, ?2),
                unlocked_at = COALESCE(unlocked_at, ?3)",
            params![key, progress.clamp(0.0, 1.0), unlocked_at],
        )?;
        Ok(())
    }

    fn achievement_progress(&self) -> Result<std::collections::HashMap<String, (f64, Option<i64>)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, progress, unlocked_at FROM achievements")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, f64>(1)?, r.get::<_, Option<i64>>(2)?),
            ))
        })?;
        Ok(rows.filter_map(std::result::Result::ok).collect())
    }

    /// Achievement catalogue merged with stored progress (part 1.5 / 3.5).
    pub fn achievements(&self) -> Result<Vec<Achievement>> {
        let stored = self.achievement_progress()?;
        Ok(ACHIEVEMENT_CATALOG
            .iter()
            .map(|(key, title, desc)| {
                let (progress, unlocked_at) =
                    stored.get(*key).copied().unwrap_or((0.0, None));
                Achievement {
                    key: (*key).into(),
                    title: (*title).into(),
                    description: (*desc).into(),
                    progress,
                    unlocked_at,
                }
            })
            .collect())
    }

    /// One round-trip for the whole dashboard (part 3).
    pub fn dashboard(&self) -> Result<DashboardSnapshot> {
        Ok(DashboardSnapshot {
            today: self.today_summary()?,
            week: self.weekday_breakdown(7)?,
            agents: self.agent_breakdown(7)?,
            heatmap: self.heatmap(365)?,
            projects: self.project_log(30, 8)?,
            streak_days: self.streak_days()?,
            achievements: self.achievements()?,
        })
    }

    /// Seconds of activity per local hour-of-day (0..24) over the last `days`
    /// — feeds prime-time / night-owl insights (plan part 11.2 / 1.4).
    pub fn hourly_distribution(&self, days: i64) -> Result<[i64; 24]> {
        let to = Utc::now().timestamp_millis();
        let from = to - days * 86_400_000;
        let mut hours = [0i64; 24];
        let mut stmt = self.conn.prepare(
            "SELECT CAST(strftime('%H', start_utc/1000, 'unixepoch', 'localtime') AS INTEGER) AS hr,
                    SUM(end_utc - start_utc)
             FROM activity_intervals
             WHERE end_utc > ?1 AND category != 'idle'
             GROUP BY hr",
        )?;
        let rows = stmt.query_map(params![from], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1).unwrap_or(0)))
        })?;
        for row in rows {
            let (hr, ms) = row?;
            if (0..24).contains(&hr) {
                hours[hr as usize] = (ms.max(0)) / 1000;
            }
        }
        Ok(hours)
    }

    /// Longest single uninterrupted session in seconds over the last `days`
    /// (intervals separated by <= [`SESSION_GAP_SECONDS`] are merged) — feeds
    /// the burnout detector (plan part 1.4).
    pub fn longest_session_seconds(&self, days: i64) -> Result<i64> {
        let to = Utc::now().timestamp_millis();
        let from = to - days * 86_400_000;
        let mut stmt = self.conn.prepare(
            "SELECT start_utc, end_utc FROM activity_intervals
             WHERE end_utc > ?1 AND category != 'idle' ORDER BY start_utc",
        )?;
        let rows = stmt.query_map(params![from], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })?;
        let mut best = 0i64;
        let mut cur_start: Option<i64> = None;
        let mut cur_end = 0i64;
        for row in rows {
            let (s, e) = row?;
            match cur_start {
                Some(_) if s - cur_end <= SESSION_GAP_SECONDS * 1000 => {
                    cur_end = cur_end.max(e);
                }
                _ => {
                    if let Some(cs) = cur_start {
                        best = best.max(cur_end - cs);
                    }
                    cur_start = Some(s);
                    cur_end = e;
                }
            }
        }
        if let Some(cs) = cur_start {
            best = best.max(cur_end - cs);
        }
        Ok((best.max(0)) / 1000)
    }

    /// Aggregate totals for a "Year in Review" (plan part 12.3).
    pub fn year_in_review(&self) -> Result<YearInReview> {
        let to = Utc::now().timestamp_millis();
        let from = to - 365 * 86_400_000;
        let (coding, ai, audit) = self.seconds_by_category(from, to)?;
        // Fold in pre-retention rollups so the "year" really spans a year and
        // not just the retention window (raw intervals are pruned after 90d).
        let today = Local::now().date_naive();
        let from_date = (today - chrono::Duration::days(364)).format("%Y-%m-%d").to_string();
        let to_date = today.format("%Y-%m-%d").to_string();
        let (rc, ra, rau) = self.rollup_between(&from_date, &to_date)?;
        let (coding, ai, audit) = (coding + rc, ai + ra, audit + rau);
        let (added, removed, commits): (i64, i64, i64) = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(lines_added),0), COALESCE(SUM(lines_removed),0),
                        COALESCE(SUM(CASE WHEN event_type='commit' THEN 1 ELSE 0 END),0)
                 FROM git_events WHERE ts_utc >= ?1",
                params![from],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((0, 0, 0));
        let projects = self.project_log(365, 5)?;
        let agents = self.agent_breakdown(365)?;
        let heat = self.heatmap(365)?;
        let busiest_day = heat
            .iter()
            .max_by_key(|c| c.seconds)
            .map(|c| c.date.clone());
        Ok(YearInReview {
            total_seconds: coding + ai + audit,
            ai_seconds: ai,
            coding_seconds: coding,
            commits,
            lines_added: added,
            lines_removed: removed,
            top_projects: projects,
            top_agents: agents,
            busiest_day,
            active_days: heat.iter().filter(|c| c.seconds > 0).count() as i64,
        })
    }

    /// Commit count over the last `days` (for the weekly digest).
    pub fn commits_since(&self, days: i64) -> Result<i64> {
        let from = Utc::now().timestamp_millis() - days * 86_400_000;
        Ok(self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM git_events WHERE event_type='commit' AND ts_utc >= ?1",
                params![from],
                |r| r.get(0),
            )
            .unwrap_or(0))
    }

    /// Total issues fixed across all daily rollups (for achievements).
    pub fn issues_fixed_total(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COALESCE(SUM(issues_fixed),0) FROM daily_rollups", [], |r| {
                r.get(0)
            })
            .unwrap_or(0))
    }

    /// Compact raw intervals older than [`RETENTION_DAYS`] into daily rollups
    /// and delete them (part 7.2). Returns rows pruned.
    pub fn run_retention(&self) -> Result<usize> {
        let cutoff = (Utc::now() - chrono::Duration::days(RETENTION_DAYS)).timestamp_millis();
        // Fold-then-delete must be atomic: if the process dies between the
        // INSERT and the DELETE, the next run would re-aggregate the same rows
        // and double-count them. A transaction makes the pair all-or-nothing.
        let tx = self.conn.unchecked_transaction()?;
        // Materialise per-day rollups for anything being pruned. Clamp each raw
        // interval to local day boundaries before summing; otherwise a session
        // crossing midnight is attributed entirely to its start day and can make
        // daily charts/streaks lie. SQLite's localtime modifier also handles DST
        // boundaries consistently with the dashboard's local buckets.
        tx.execute(
            "WITH RECURSIVE split(id, category, day_start, day_end, start_utc, end_utc) AS (
                SELECT id, category,
                       CAST(strftime('%s', date(start_utc/1000, 'unixepoch', 'localtime'), 'utc') AS INTEGER) * 1000,
                       CAST(strftime('%s', date(start_utc/1000, 'unixepoch', 'localtime', '+1 day'), 'utc') AS INTEGER) * 1000,
                       start_utc,
                       end_utc
                FROM activity_intervals
                WHERE end_utc < ?1 AND category != 'idle'
                UNION ALL
                SELECT id, category,
                       day_end,
                       CAST(strftime('%s', date(day_end/1000, 'unixepoch', 'localtime', '+1 day'), 'utc') AS INTEGER) * 1000,
                       start_utc,
                       end_utc
                FROM split
                WHERE end_utc > day_end
             ), pieces AS (
                SELECT date(day_start/1000, 'unixepoch', 'localtime') AS d,
                       category,
                       MAX(0, MIN(end_utc, day_end) - MAX(start_utc, day_start)) AS ms
                FROM split
             )
             INSERT INTO daily_rollups(date, total_seconds, ai_seconds, coding_seconds, audit_seconds)
             SELECT d,
                    SUM(ms)/1000,
                    SUM(CASE WHEN category='ai' THEN ms ELSE 0 END)/1000,
                    SUM(CASE WHEN category='coding' THEN ms ELSE 0 END)/1000,
                    SUM(CASE WHEN category='audit' THEN ms ELSE 0 END)/1000
             FROM pieces GROUP BY d
             ON CONFLICT(date) DO UPDATE SET
                total_seconds  = total_seconds  + excluded.total_seconds,
                ai_seconds     = ai_seconds     + excluded.ai_seconds,
                coding_seconds = coding_seconds + excluded.coding_seconds,
                audit_seconds  = audit_seconds  + excluded.audit_seconds",
            params![cutoff],
        )?;
        let pruned = tx.execute(
            "DELETE FROM activity_intervals WHERE end_utc < ?1",
            params![cutoff],
        )?;
        tx.commit()?;
        Ok(pruned)
    }

    /// Export the full raw history as JSON (part 5.6 data management). Unlike
    /// the dashboard snapshot, this dumps every stored row so a user can take
    /// all of their data with them (data-portability / GDPR-style export).
    pub fn export_json(&self) -> Result<serde_json::Value> {
        let intervals: Vec<serde_json::Value> = self
            .conn
            .prepare(
                "SELECT start_utc, end_utc, category, project_id, agent, branch, is_focused
                 FROM activity_intervals ORDER BY start_utc",
            )?
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "start_utc": r.get::<_, i64>(0)?,
                    "end_utc": r.get::<_, i64>(1)?,
                    "category": r.get::<_, String>(2)?,
                    "project_id": r.get::<_, Option<i64>>(3)?,
                    "agent": r.get::<_, Option<String>>(4)?,
                    "branch": r.get::<_, Option<String>>(5)?,
                    "is_focused": r.get::<_, i64>(6)? != 0,
                }))
            })?
            .filter_map(std::result::Result::ok)
            .collect();

        let git_events: Vec<serde_json::Value> = self
            .conn
            .prepare(
                "SELECT ts_utc, project_id, event_type, lines_added, lines_removed, branch
                 FROM git_events ORDER BY ts_utc",
            )?
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "ts_utc": r.get::<_, i64>(0)?,
                    "project_id": r.get::<_, Option<i64>>(1)?,
                    "event_type": r.get::<_, String>(2)?,
                    "lines_added": r.get::<_, i64>(3)?,
                    "lines_removed": r.get::<_, i64>(4)?,
                    "branch": r.get::<_, Option<String>>(5)?,
                }))
            })?
            .filter_map(std::result::Result::ok)
            .collect();

        let rollups: Vec<serde_json::Value> = self
            .conn
            .prepare(
                "SELECT date, total_seconds, ai_seconds, coding_seconds, audit_seconds,
                        commits, lines_added, lines_removed, audits_run, issues_fixed
                 FROM daily_rollups ORDER BY date",
            )?
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "date": r.get::<_, String>(0)?,
                    "total_seconds": r.get::<_, i64>(1)?,
                    "ai_seconds": r.get::<_, i64>(2)?,
                    "coding_seconds": r.get::<_, i64>(3)?,
                    "audit_seconds": r.get::<_, i64>(4)?,
                    "commits": r.get::<_, i64>(5)?,
                    "lines_added": r.get::<_, i64>(6)?,
                    "lines_removed": r.get::<_, i64>(7)?,
                    "audits_run": r.get::<_, i64>(8)?,
                    "issues_fixed": r.get::<_, i64>(9)?,
                }))
            })?
            .filter_map(std::result::Result::ok)
            .collect();

        let projects: Vec<serde_json::Value> = self
            .conn
            .prepare("SELECT id, display_name, is_masked, primary_lang FROM projects")?
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?,
                    "display_name": r.get::<_, Option<String>>(1)?,
                    "is_masked": r.get::<_, i64>(2)? != 0,
                    "primary_lang": r.get::<_, Option<String>>(3)?,
                }))
            })?
            .filter_map(std::result::Result::ok)
            .collect();

        Ok(serde_json::json!({
            "schema_version": SCHEMA_VERSION,
            "exported_at": Utc::now().timestamp_millis(),
            "projects": projects,
            "activity_intervals": intervals,
            "git_events": git_events,
            "daily_rollups": rollups,
            "achievements": self.achievements()?,
        }))
    }

    /// Export the last `days` of daily totals as CSV (part 5.6 / 12.2).
    pub fn export_csv(&self, days: i64) -> Result<String> {
        let week = self.weekday_breakdown(days)?;
        let mut out = String::from("date,coding_seconds,ai_seconds,audit_seconds,total_seconds\n");
        for d in week {
            let total = d.coding_seconds + d.ai_seconds + d.audit_seconds;
            out.push_str(&format!(
                "{},{},{},{},{}\n",
                d.date, d.coding_seconds, d.ai_seconds, d.audit_seconds, total
            ));
        }
        Ok(out)
    }

    /// Export in the WakaTime-style "summaries" shape (part 12.2) so existing
    /// WakaTime tooling can ingest Luxor data.
    pub fn export_wakatime(&self, days: i64) -> Result<serde_json::Value> {
        let week = self.weekday_breakdown(days)?;
        let data: Vec<_> = week
            .iter()
            .map(|d| {
                let total = d.coding_seconds + d.ai_seconds + d.audit_seconds;
                serde_json::json!({
                    "range": { "date": d.date },
                    "grand_total": {
                        "total_seconds": total,
                        "text": super::discord::fmt_duration(total),
                    },
                    "categories": [
                        { "name": "Coding", "total_seconds": d.coding_seconds },
                        { "name": "AI", "total_seconds": d.ai_seconds },
                        { "name": "Audit", "total_seconds": d.audit_seconds },
                    ],
                })
            })
            .collect();
        Ok(serde_json::json!({ "data": data }))
    }

    /// Wipe all telemetry (part 5.6 "delete all history").
    pub fn wipe(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM activity_intervals;
             DELETE FROM git_events;
             DELETE FROM daily_rollups;
             DELETE FROM achievements;
             DELETE FROM projects;",
        )?;
        Ok(())
    }
}

/// Catalogue of achievements: (key, title, description). Part 1.5.
pub const ACHIEVEMENT_CATALOG: &[(&str, &str, &str)] = &[
    ("symbiote", "Симбиот", "100 часов работы с ИИ"),
    ("purity_keeper", "Хранитель чистоты", "Исправлено 50 багов"),
    ("night_watch", "Ночной дозор", "10 часов после полуночи"),
    ("streak_7", "Неделя в потоке", "7 дней подряд кодинга"),
    ("streak_30", "Месяц дисциплины", "30 дней подряд кодинга"),
];

// ----- pure helpers (unit-tested) ---------------------------------------

/// SHA256 hex of a path (used when masking is on, part 5).
pub fn hash_path(path: &str) -> String {
    let mut h = Sha256::new();
    h.update(path.as_bytes());
    format!("{:x}", h.finalize())
}

fn basename(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(str::to_string)
}

/// Map a file extension to a human language label / Discord asset hint.
/// Returns `(label, discord_asset_key)`.
pub fn lang_from_ext(ext: &str) -> Option<(&'static str, &'static str)> {
    let e = ext.trim_start_matches('.').to_ascii_lowercase();
    Some(match e.as_str() {
        "rs" => ("Rust", "lang_rust"),
        "ts" | "tsx" => ("TypeScript", "lang_ts"),
        "js" | "jsx" | "mjs" | "cjs" => ("JavaScript", "lang_js"),
        "py" => ("Python", "lang_python"),
        "go" => ("Go", "lang_go"),
        "java" => ("Java", "lang_java"),
        "kt" | "kts" => ("Kotlin", "lang_kotlin"),
        "c" | "h" => ("C", "lang_c"),
        "cpp" | "cc" | "cxx" | "hpp" => ("C++", "lang_cpp"),
        "cs" => ("C#", "lang_csharp"),
        "rb" => ("Ruby", "lang_ruby"),
        "php" => ("PHP", "lang_php"),
        "swift" => ("Swift", "lang_swift"),
        "html" => ("HTML", "lang_html"),
        "css" | "scss" => ("CSS", "lang_css"),
        "json" => ("JSON", "lang_json"),
        "md" => ("Markdown", "lang_md"),
        "sql" => ("SQL", "lang_sql"),
        "sh" | "bash" | "zsh" => ("Shell", "lang_shell"),
        _ => return None,
    })
}

/// Infer a "git flow" phase from a branch name (part 1.2).
pub fn git_flow_state(branch: &str) -> &'static str {
    let b = branch.to_ascii_lowercase();
    if b.starts_with("bugfix/") || b.starts_with("fix/") || b.starts_with("hotfix/") {
        "Исправляет баги"
    } else if b.starts_with("feature/") || b.starts_with("feat/") {
        "Пилит фичи"
    } else if b.starts_with("refactor/") {
        "Рефакторит"
    } else if b.starts_with("release/") {
        "Готовит релиз"
    } else if b.starts_with("docs/") {
        "Пишет документацию"
    } else if b == "main" || b == "master" {
        "На основной ветке"
    } else {
        "Работает"
    }
}

/// Whether two samples taken `gap` seconds apart belong to the same session
/// (part 1.1: a gap > 30 min closes the session).
pub fn same_session(gap_seconds: i64) -> bool {
    gap_seconds <= SESSION_GAP_SECONDS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(cat: Category, agent: Option<&str>) -> Sample {
        Sample {
            at: Utc::now(),
            category: cat,
            project_path: Some("/home/dev/luxor".into()),
            project_name: Some("luxor".into()),
            agent: agent.map(str::to_string),
            branch: Some("main".into()),
            is_focused: true,
        }
    }

    #[test]
    fn records_and_aggregates_today() {
        let store = TelemetryStore::open_in_memory().unwrap();
        let now = Utc::now();
        // 600s coding + 300s ai today
        store
            .record_interval(now - chrono::Duration::seconds(600), now, &s(Category::Coding, None))
            .unwrap();
        store
            .record_interval(
                now - chrono::Duration::seconds(300),
                now,
                &s(Category::Ai, Some("Claude Code")),
            )
            .unwrap();
        let t = store.today_summary().unwrap();
        assert!(t.coding_seconds >= 590 && t.coding_seconds <= 610, "{}", t.coding_seconds);
        assert!(t.ai_seconds >= 290 && t.ai_seconds <= 310, "{}", t.ai_seconds);
        assert_eq!(t.total_seconds, t.coding_seconds + t.ai_seconds + t.audit_seconds);
    }

    #[test]
    fn agent_breakdown_groups_by_agent() {
        let store = TelemetryStore::open_in_memory().unwrap();
        let now = Utc::now();
        store
            .record_interval(now - chrono::Duration::seconds(120), now, &s(Category::Ai, Some("Claude Code")))
            .unwrap();
        store
            .record_interval(now - chrono::Duration::seconds(60), now, &s(Category::Ai, Some("Cursor")))
            .unwrap();
        let agents = store.agent_breakdown(7).unwrap();
        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].agent, "Claude Code"); // larger first
    }

    #[test]
    fn masking_hashes_path_and_renames() {
        let mut store = TelemetryStore::open_in_memory().unwrap();
        store.mask_projects = true;
        let now = Utc::now();
        store
            .record_interval(now - chrono::Duration::seconds(60), now, &s(Category::Coding, None))
            .unwrap();
        let projects = store.project_log(7, 10).unwrap();
        assert_eq!(projects[0].name, "Private Project");
    }

    #[test]
    fn git_event_counts_commits_and_lines() {
        let store = TelemetryStore::open_in_memory().unwrap();
        store
            .record_git_event(&GitEvent {
                at: Utc::now(),
                project_path: Some("/home/dev/luxor".into()),
                event_type: "commit".into(),
                lines_added: 450,
                lines_removed: 120,
                branch: Some("main".into()),
            })
            .unwrap();
        let t = store.today_summary().unwrap();
        assert_eq!(t.commits, 1);
        assert_eq!(t.lines_added, 450);
        assert_eq!(t.lines_removed, 120);
    }

    #[test]
    fn lang_and_flow_helpers() {
        assert_eq!(lang_from_ext("rs"), Some(("Rust", "lang_rust")));
        assert_eq!(lang_from_ext(".tsx"), Some(("TypeScript", "lang_ts")));
        assert_eq!(lang_from_ext("unknown"), None);
        assert_eq!(git_flow_state("feature/telemetry"), "Пилит фичи");
        assert_eq!(git_flow_state("bugfix/leak"), "Исправляет баги");
        assert!(same_session(60 * 10));
        assert!(!same_session(60 * 40));
    }

    #[test]
    fn achievements_merge_catalog() {
        let store = TelemetryStore::open_in_memory().unwrap();
        store.set_achievement("symbiote", 0.5, false).unwrap();
        let a = store.achievements().unwrap();
        let sym = a.iter().find(|x| x.key == "symbiote").unwrap();
        assert_eq!(sym.title, "Симбиот");
        assert!((sym.progress - 0.5).abs() < 1e-9);
        assert!(sym.unlocked_at.is_none());
    }

    #[test]
    fn retention_preserves_heatmap_and_year_totals() {
        // Regression for the retention/read bug: an interval older than the
        // retention window must still show up in the heatmap, streak source and
        // Year-in-Review after raw rows are pruned into daily_rollups.
        let store = TelemetryStore::open_in_memory().unwrap();
        let old = Utc::now() - chrono::Duration::days(120);
        store
            .record_interval(old - chrono::Duration::seconds(3600), old, &s(Category::Coding, None))
            .unwrap();
        // Before retention the raw interval is visible.
        let heat_before: i64 = store.heatmap(365).unwrap().iter().map(|c| c.seconds).sum();
        assert!(heat_before >= 3590, "pre-retention heat {heat_before}");

        let pruned = store.run_retention().unwrap();
        assert_eq!(pruned, 1, "the old interval should have been pruned");
        // Raw table is now empty for that day...
        let (from, to) = TelemetryStore::local_day_bounds(old.with_timezone(&Local).date_naive());
        assert_eq!(store.seconds_by_category(from, to).unwrap(), (0, 0, 0));
        // ...but the heatmap and Year-in-Review still reflect it via rollups.
        let heat_after: i64 = store.heatmap(365).unwrap().iter().map(|c| c.seconds).sum();
        assert!(heat_after >= 3590, "post-retention heat {heat_after}");
        let yir = store.year_in_review().unwrap();
        assert!(yir.total_seconds >= 3590, "year total {}", yir.total_seconds);
        assert!(yir.active_days >= 1);
    }

    #[test]
    fn retention_splits_cross_midnight_intervals() {
        let store = TelemetryStore::open_in_memory().unwrap();
        let date = (Local::now() - chrono::Duration::days(120)).date_naive();
        let (day_start_ms, _) = TelemetryStore::local_day_bounds(date);
        let start = Utc.timestamp_millis_opt(day_start_ms).single().unwrap() + chrono::Duration::hours(23);
        let end = start + chrono::Duration::hours(2);
        store.record_interval(start, end, &s(Category::Coding, None)).unwrap();
        assert_eq!(store.run_retention().unwrap(), 1);
        let first = store.rollup_day(&date.format("%Y-%m-%d").to_string()).unwrap();
        let second = store
            .rollup_day(&(date + chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
            .unwrap();
        assert!(first.0 >= 3500 && first.0 <= 3700, "first day seconds {}", first.0);
        assert!(second.0 >= 3500 && second.0 <= 3700, "second day seconds {}", second.0);
    }

    #[test]
    fn export_json_dumps_raw_rows() {
        let store = TelemetryStore::open_in_memory().unwrap();
        let now = Utc::now();
        store
            .record_interval(now - chrono::Duration::seconds(60), now, &s(Category::Coding, None))
            .unwrap();
        let v = store.export_json().unwrap();
        assert!(v["activity_intervals"].as_array().unwrap().len() == 1);
        assert!(v["schema_version"].as_i64().unwrap() == SCHEMA_VERSION);
    }

    #[test]
    fn wipe_clears_everything() {
        let store = TelemetryStore::open_in_memory().unwrap();
        let now = Utc::now();
        store
            .record_interval(now - chrono::Duration::seconds(60), now, &s(Category::Coding, None))
            .unwrap();
        store.wipe().unwrap();
        assert_eq!(store.today_summary().unwrap().total_seconds, 0);
    }
}
