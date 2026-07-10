//! Webhook integrations (plan part 13.2 / 18): push the weekly digest to
//! Slack or Telegram. Uses the crate's existing `reqwest` client — no new
//! dependency.

use crate::insights::WeeklyDigest;
use crate::{discord::fmt_duration, Error, Result};

/// Render a digest as a short plain-text message suitable for chat apps.
pub fn digest_message(digest: &WeeklyDigest) -> String {
    let mut lines = vec![
        // Plain text (no Markdown markers): the digest is sent without
        // parse_mode, so formatting characters would show literally.
        "⚡ Luxor — итоги недели".to_string(),
        format!("• Всего: {}", fmt_duration(digest.total_seconds)),
        format!(
            "• С ИИ: {} ({:.0}%)",
            fmt_duration(digest.ai_seconds),
            digest.ai_dependency_pct
        ),
        format!("• Коммитов: {}", digest.commits),
        format!("• Прайм-тайм: {:02}:00", digest.prime_time_hour),
    ];
    if let Some(p) = &digest.top_project {
        lines.push(format!("• Топ проект: {p}"));
    }
    if let Some(a) = &digest.top_agent {
        lines.push(format!("• Топ агент: {a}"));
    }
    if let Some(pct) = digest.vs_last_week_pct {
        lines.push(format!(
            "• Динамика: {}{:.0}% к прошлой неделе",
            if pct >= 0.0 { "+" } else { "" },
            pct
        ));
    }
    lines.join("\n")
}

/// Post a message to a Slack Incoming Webhook URL.
pub async fn send_slack(webhook_url: &str, text: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(webhook_url)
        .map_err(|_| Error::InvalidInput("invalid Slack webhook URL".into()))?;
    let trusted_host = matches!(
        parsed.host_str(),
        Some("hooks.slack.com") | Some("hooks.slack-gov.com")
    );
    if parsed.scheme() != "https" || !trusted_host || !parsed.path().starts_with("/services/") {
        return Err(Error::InvalidInput(
            "Slack webhook must use an official hooks.slack.com URL".into(),
        ));
    }
    let resp = reqwest::Client::new()
        .post(webhook_url)
        .json(&serde_json::json!({ "text": text }))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::Http(resp.error_for_status().unwrap_err()));
    }
    Ok(())
}

/// Send a message via the Telegram Bot API.
///
/// The bot token is embedded in the request URL (that's how the Telegram API
/// works), so any `reqwest::Error` Display would leak it — every error path
/// here converts to a string and runs it through `redact` before returning
/// (audit 11.1). The message is sent as plain text: `parse_mode: "Markdown"`
/// made delivery fail with a 400 whenever a project/agent name contained
/// `_`, `*` or `[` (audit 11.2).
pub async fn send_telegram(bot_token: &str, chat_id: &str, text: &str) -> Result<()> {
    if bot_token.is_empty() || chat_id.is_empty() {
        return Err(Error::InvalidInput("telegram bot_token and chat_id required".into()));
    }
    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
        }))
        .send()
        .await
        .map_err(|e| Error::Launcher(crate::redact::redact(&format!("telegram send failed: {e}"))))?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(Error::Launcher(format!(
            "telegram send failed with status {status}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_includes_key_fields() {
        let d = WeeklyDigest {
            total_seconds: 36 * 3600,
            ai_seconds: 12 * 3600,
            commits: 42,
            prime_time_hour: 15,
            ai_dependency_pct: 33.0,
            top_project: Some("luxor".into()),
            vs_last_week_pct: Some(10.0),
            ..Default::default()
        };
        let m = digest_message(&d);
        assert!(m.contains("42"));
        assert!(m.contains("luxor"));
        assert!(m.contains("15:00"));
        assert!(m.contains("+10%"));
    }
}
