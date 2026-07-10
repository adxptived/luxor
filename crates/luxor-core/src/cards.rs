//! Shareable cards & Year-in-Review (plan part 12.1 / 12.3).
//!
//! Renders self-contained SVG cards from telemetry summaries — no external
//! rendering dependency. The frontend can download or share the SVG directly.

use crate::discord::fmt_duration;
use crate::insights::WeeklyDigest;
use crate::telemetry::YearInReview;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// A 1200×630 (OG-image ratio) weekly summary card (plan part 12.1).
pub fn weekly_card_svg(digest: &WeeklyDigest, title: &str) -> String {
    let ai_pct = digest.ai_dependency_pct.round() as i64;
    let top_project = digest.top_project.clone().unwrap_or_else(|| "—".into());
    let top_agent = digest.top_agent.clone().unwrap_or_else(|| "—".into());
    let trend = digest
        .vs_last_week_pct
        .map(|p| format!("{}{:.0}% к прошлой неделе", if p >= 0.0 { "+" } else { "" }, p))
        .unwrap_or_default();
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Inter, system-ui, sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0f1a"/>
      <stop offset="1" stop-color="#161b2e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f1424" stroke="#23304d"/>
  <text x="80" y="120" fill="#8ea2ff" font-size="28" font-weight="600">⚡ Luxor</text>
  <text x="80" y="180" fill="#e8edff" font-size="48" font-weight="700">{title}</text>
  <text x="80" y="280" fill="#9fb0d6" font-size="26">Всего за неделю</text>
  <text x="80" y="340" fill="#ffffff" font-size="64" font-weight="800">{total}</text>
  <text x="640" y="280" fill="#9fb0d6" font-size="26">Время с ИИ</text>
  <text x="640" y="340" fill="#34d399" font-size="64" font-weight="800">{ai}</text>
  <text x="80" y="430" fill="#9fb0d6" font-size="24">Коммитов: <tspan fill="#ffffff" font-weight="700">{commits}</tspan></text>
  <text x="80" y="475" fill="#9fb0d6" font-size="24">AI-зависимость: <tspan fill="#ffffff" font-weight="700">{ai_pct}%</tspan></text>
  <text x="80" y="520" fill="#9fb0d6" font-size="24">Топ проект: <tspan fill="#ffffff" font-weight="700">{project}</tspan></text>
  <text x="640" y="430" fill="#9fb0d6" font-size="24">Топ агент: <tspan fill="#ffffff" font-weight="700">{agent}</tspan></text>
  <text x="640" y="475" fill="#9fb0d6" font-size="24">Прайм-тайм: <tspan fill="#ffffff" font-weight="700">{hour:02}:00</tspan></text>
  <text x="640" y="520" fill="#f0a82e" font-size="24">{trend}</text>
</svg>"##,
        title = esc(title),
        total = fmt_duration(digest.total_seconds),
        ai = fmt_duration(digest.ai_seconds),
        commits = digest.commits,
        ai_pct = ai_pct,
        project = esc(&top_project),
        agent = esc(&top_agent),
        hour = digest.prime_time_hour,
        trend = esc(&trend),
    )
}

/// A Year-in-Review card (plan part 12.3).
pub fn year_in_review_svg(yir: &YearInReview, title: &str) -> String {
    let top_project = yir.top_projects.first().map(|p| p.name.clone()).unwrap_or_else(|| "—".into());
    let top_agent = yir.top_agents.first().map(|a| a.agent.clone()).unwrap_or_else(|| "—".into());
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Inter, system-ui, sans-serif">
  <rect width="1200" height="630" fill="#0b0f1a"/>
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f1424" stroke="#23304d"/>
  <text x="80" y="130" fill="#8ea2ff" font-size="30" font-weight="600">⚡ Luxor · Year in Review</text>
  <text x="80" y="200" fill="#e8edff" font-size="52" font-weight="800">{title}</text>
  <text x="80" y="300" fill="#9fb0d6" font-size="26">Всего наработано</text>
  <text x="80" y="360" fill="#ffffff" font-size="60" font-weight="800">{total}</text>
  <text x="640" y="300" fill="#9fb0d6" font-size="26">Активных дней</text>
  <text x="640" y="360" fill="#34d399" font-size="60" font-weight="800">{days}</text>
  <text x="80" y="450" fill="#9fb0d6" font-size="24">Коммитов: <tspan fill="#fff" font-weight="700">{commits}</tspan></text>
  <text x="80" y="495" fill="#9fb0d6" font-size="24">Строк: <tspan fill="#34d399" font-weight="700">+{added}</tspan> / <tspan fill="#e0556e" font-weight="700">-{removed}</tspan></text>
  <text x="640" y="450" fill="#9fb0d6" font-size="24">Топ проект: <tspan fill="#fff" font-weight="700">{project}</tspan></text>
  <text x="640" y="495" fill="#9fb0d6" font-size="24">Топ агент: <tspan fill="#fff" font-weight="700">{agent}</tspan></text>
</svg>"##,
        title = esc(title),
        total = fmt_duration(yir.total_seconds),
        days = yir.active_days,
        commits = yir.commits,
        added = yir.lines_added,
        removed = yir.lines_removed,
        project = esc(&top_project),
        agent = esc(&top_agent),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekly_card_contains_numbers() {
        let d = WeeklyDigest {
            total_seconds: 36 * 3600,
            ai_seconds: 12 * 3600,
            commits: 42,
            prime_time_hour: 15,
            ai_dependency_pct: 33.0,
            top_project: Some("luxor".into()),
            ..Default::default()
        };
        let svg = weekly_card_svg(&d, "Эта неделя");
        assert!(svg.contains("<svg"));
        assert!(svg.contains("42"));
        assert!(svg.contains("luxor"));
        assert!(svg.contains("15:00"));
    }

    #[test]
    fn year_card_escapes() {
        let yir = YearInReview { total_seconds: 3600, active_days: 200, ..Default::default() };
        let svg = year_in_review_svg(&yir, "A<B&C");
        assert!(svg.contains("A&lt;B&amp;C"));
        assert!(svg.contains("200"));
    }
}
