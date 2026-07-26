//! Insights Engine (plan part 11): rule-based heuristics over telemetry that
//! turn raw numbers into human takeaways — weekly digest, prime-time, the
//! AI-dependency index, burnout / night-owl detection, and achievement
//! evaluation. All pure functions, fully unit-testable.

use serde::{Deserialize, Serialize};

use crate::telemetry::{AgentSlice, DayBucket, ProjectTime, YearInReview};

/// A single surfaced insight (plan part 11.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Insight {
    /// Machine kind: "prime_time" | "ai_dependency" | "burnout" | "night_owl"
    /// | "streak" | "trend".
    pub kind: String,
    /// "info" | "positive" | "warning".
    pub severity: String,
    pub title: String,
    pub message: String,
}

/// Weekly auto-report (plan part 11.1).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WeeklyDigest {
    pub total_seconds: i64,
    pub ai_seconds: i64,
    pub coding_seconds: i64,
    pub commits: i64,
    pub busiest_day: Option<String>,
    pub prime_time_hour: u8,
    pub ai_dependency_pct: f64,
    /// Change in total time vs the previous week, percent.
    pub vs_last_week_pct: Option<f64>,
    pub top_project: Option<String>,
    pub top_agent: Option<String>,
}

/// Hour of day (0..24, local) with the most accumulated activity.
pub fn prime_time(hourly: &[i64; 24]) -> u8 {
    hourly
        .iter()
        .enumerate()
        .max_by_key(|(_, &s)| s)
        .map(|(h, _)| h as u8)
        .unwrap_or(0)
}

/// Ratio of AI time to total productive time, 0..=100 (plan part 1.1).
pub fn ai_dependency_index(ai_seconds: i64, total_seconds: i64) -> f64 {
    if total_seconds <= 0 {
        0.0
    } else {
        (ai_seconds as f64 / total_seconds as f64 * 100.0).clamp(0.0, 100.0)
    }
}

/// A session longer than 4 uninterrupted hours triggers a burnout nudge
/// (plan part 1.4).
pub fn is_burnout(longest_session_seconds: i64) -> bool {
    longest_session_seconds > 4 * 3600
}

/// "Night owl" if a meaningful share of activity happens between 00:00–05:00
/// (plan part 1.4 night coding).
pub fn is_night_owl(hourly: &[i64; 24]) -> bool {
    let night: i64 = hourly[0..6].iter().sum();
    let total: i64 = hourly.iter().sum();
    total > 0 && (night as f64 / total as f64) > 0.2
}

/// Build the weekly digest from already-queried inputs.
#[allow(clippy::too_many_arguments)]
pub fn build_weekly_digest(
    this_week: &[DayBucket],
    last_week_total_seconds: Option<i64>,
    agents: &[AgentSlice],
    projects: &[ProjectTime],
    commits: i64,
    hourly: &[i64; 24],
) -> WeeklyDigest {
    let coding: i64 = this_week.iter().map(|d| d.coding_seconds).sum();
    let ai: i64 = this_week.iter().map(|d| d.ai_seconds).sum();
    let audit: i64 = this_week.iter().map(|d| d.audit_seconds).sum();
    let total = coding + ai + audit;
    let busiest_day = this_week
        .iter()
        .max_by_key(|d| d.coding_seconds + d.ai_seconds + d.audit_seconds)
        .filter(|d| d.coding_seconds + d.ai_seconds + d.audit_seconds > 0)
        .map(|d| d.date.clone());
    let vs_last_week_pct = match last_week_total_seconds {
        Some(prev) if prev > 0 => Some((total - prev) as f64 / prev as f64 * 100.0),
        _ => None,
    };
    WeeklyDigest {
        total_seconds: total,
        ai_seconds: ai,
        coding_seconds: coding,
        commits,
        busiest_day,
        prime_time_hour: prime_time(hourly),
        ai_dependency_pct: ai_dependency_index(ai, total),
        vs_last_week_pct,
        top_project: projects.first().map(|p| p.name.clone()),
        top_agent: agents.first().map(|a| a.agent.clone()),
    }
}

/// Turn metrics into a prioritised list of human insights (plan part 11.2).
pub fn generate_insights(
    digest: &WeeklyDigest,
    longest_session_seconds: i64,
    hourly: &[i64; 24],
    streak_days: i64,
) -> Vec<Insight> {
    let mut out = Vec::new();

    if is_burnout(longest_session_seconds) {
        out.push(Insight {
            kind: "burnout".into(),
            severity: "warning".into(),
            title: "Возможное выгорание".into(),
            message: format!(
                "Самая длинная сессия — {}. Стоит делать перерывы.",
                crate::discord::fmt_duration(longest_session_seconds)
            ),
        });
    }

    out.push(Insight {
        kind: "prime_time".into(),
        severity: "info".into(),
        title: "Ваше прайм-тайм".into(),
        message: format!("Пик продуктивности около {:02}:00.", digest.prime_time_hour),
    });

    if digest.ai_dependency_pct >= 60.0 {
        out.push(Insight {
            kind: "ai_dependency".into(),
            severity: "info".into(),
            title: "Высокая опора на ИИ".into(),
            message: format!(
                "{:.0}% продуктивного времени — работа с ИИ.",
                digest.ai_dependency_pct
            ),
        });
    }

    if is_night_owl(hourly) {
        out.push(Insight {
            kind: "night_owl".into(),
            severity: "info".into(),
            title: "Ночной кодер".into(),
            message: "Заметная доля работы приходится на 00:00–05:00.".into(),
        });
    }

    if streak_days >= 3 {
        out.push(Insight {
            kind: "streak".into(),
            severity: "positive".into(),
            title: "В потоке".into(),
            message: format!("{streak_days} дней подряд активности — так держать!"),
        });
    }

    if let Some(pct) = digest.vs_last_week_pct {
        out.push(Insight {
            kind: "trend".into(),
            severity: if pct >= 0.0 { "positive" } else { "info" }.into(),
            title: "Динамика недели".into(),
            message: format!(
                "Общее время {} на {:.0}% относительно прошлой недели.",
                if pct >= 0.0 {
                    "выросло"
                } else {
                    "снизилось"
                },
                pct.abs()
            ),
        });
    }

    out
}

/// Evaluate achievement progress from aggregate stats (plan part 1.5). Returns
/// `(key, progress 0..1, unlocked)` tuples the caller persists.
pub fn evaluate_achievements(
    yir: &YearInReview,
    streak_days: i64,
    issues_fixed_total: i64,
    night_seconds: i64,
) -> Vec<(String, f64, bool)> {
    let frac = |value: f64, target: f64| (value / target).clamp(0.0, 1.0);
    let symbiote = frac(yir.ai_seconds as f64, (100 * 3600) as f64);
    let purity = frac(issues_fixed_total as f64, 50.0);
    let night = frac(night_seconds as f64, (10 * 3600) as f64);
    let streak7 = frac(streak_days as f64, 7.0);
    let streak30 = frac(streak_days as f64, 30.0);
    vec![
        ("symbiote".into(), symbiote, symbiote >= 1.0),
        ("purity_keeper".into(), purity, purity >= 1.0),
        ("night_watch".into(), night, night >= 1.0),
        ("streak_7".into(), streak7, streak7 >= 1.0),
        ("streak_30".into(), streak30, streak30 >= 1.0),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket(date: &str, c: i64, a: i64) -> DayBucket {
        DayBucket {
            date: date.into(),
            coding_seconds: c,
            ai_seconds: a,
            audit_seconds: 0,
        }
    }

    #[test]
    fn prime_time_and_dependency() {
        let mut h = [0i64; 24];
        h[14] = 9000;
        h[10] = 3000;
        assert_eq!(prime_time(&h), 14);
        assert!((ai_dependency_index(50, 100) - 50.0).abs() < 1e-9);
        assert_eq!(ai_dependency_index(10, 0), 0.0);
    }

    #[test]
    fn burnout_and_night_owl() {
        assert!(is_burnout(5 * 3600));
        assert!(!is_burnout(2 * 3600));
        let mut h = [0i64; 24];
        h[2] = 4000;
        h[14] = 1000;
        assert!(is_night_owl(&h));
        let mut day = [0i64; 24];
        day[14] = 9000;
        assert!(!is_night_owl(&day));
    }

    #[test]
    fn digest_and_insights() {
        let week = vec![
            bucket("2026-06-15", 3600, 7200),
            bucket("2026-06-16", 1800, 1800),
        ];
        let agents = vec![AgentSlice {
            agent: "Claude Code".into(),
            seconds: 9000,
        }];
        let projects = vec![ProjectTime {
            name: "luxor".into(),
            seconds: 9000,
            primary_lang: Some("Rust".into()),
        }];
        let mut hourly = [0i64; 24];
        hourly[15] = 9000;
        let digest = build_weekly_digest(&week, Some(7200), &agents, &projects, 12, &hourly);
        assert_eq!(digest.commits, 12);
        assert_eq!(digest.prime_time_hour, 15);
        assert_eq!(digest.top_project.as_deref(), Some("luxor"));
        assert!(digest.ai_dependency_pct > 60.0);
        assert!(digest.vs_last_week_pct.unwrap() > 0.0);

        let insights = generate_insights(&digest, 5 * 3600, &hourly, 4);
        assert!(insights.iter().any(|i| i.kind == "burnout"));
        assert!(insights.iter().any(|i| i.kind == "ai_dependency"));
        assert!(insights.iter().any(|i| i.kind == "streak"));
    }

    #[test]
    fn achievements_progress() {
        let yir = YearInReview {
            ai_seconds: 50 * 3600,
            ..Default::default()
        };
        let a = evaluate_achievements(&yir, 7, 25, 5 * 3600);
        let sym = a.iter().find(|(k, _, _)| k == "symbiote").unwrap();
        assert!((sym.1 - 0.5).abs() < 1e-9);
        let s7 = a.iter().find(|(k, _, _)| k == "streak_7").unwrap();
        assert!(s7.2, "7-day streak should unlock streak_7");
    }
}
