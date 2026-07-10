//! Secret redaction for any free-form text that leaves the app as a log,
//! diagnostics bundle or crash report.
//!
//! This is deliberately conservative: it masks the *value* of things that look
//! like credentials while keeping the surrounding structure, so logs stay
//! readable. It is a safety net, not a guarantee — real secrets still live only
//! in the OS keychain (see `secrets.rs`).

use std::sync::OnceLock;

use regex::{Captures, Regex};

const MASK: &str = "***REDACTED***";

struct Rules {
    /// `KEY=value` / `KEY: value` where the key name looks sensitive.
    key_value: Regex,
    /// `Authorization: Bearer <token>` / bare `Bearer <token>`.
    bearer: Regex,
    /// Provider-prefixed tokens (GitHub `ghp_…`, Slack `xoxb-…`, OpenAI `sk-…`,
    /// AWS access key id `AKIA…`).
    prefixed: Regex,
    /// Telegram bot tokens — appear inside API URLs (`api.telegram.org/bot<id>:<secret>/…`)
    /// and therefore leak through reqwest error `Display` (audit 11.1).
    telegram: Regex,
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| Rules {
        key_value: Regex::new(
            r#"(?i)\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_]*)(\s*[:=]\s*)("?)([^\s"']+)("?)"#,
        )
        .expect("valid key_value regex"),
        bearer: Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._\-]+").expect("valid bearer regex"),
        prefixed: Regex::new(
            r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b",
        )
        .expect("valid prefixed-token regex"),
        telegram: Regex::new(r"\bbot\d{6,}:[A-Za-z0-9_-]{20,}\b")
            .expect("valid telegram-token regex"),
    })
}

/// Redact likely secrets from `text`, masking values while keeping structure.
pub fn redact(text: &str) -> String {
    let r = rules();
    // 1) sensitive key/value pairs — keep the key + separator + surrounding quote.
    let step1 = r.key_value.replace_all(text, |c: &Captures| {
        format!("{}{}{}{MASK}{}", &c[1], &c[2], &c[3], &c[5])
    });
    // 2) bearer tokens.
    let step2 = r
        .bearer
        .replace_all(&step1, format!("Bearer {MASK}").as_str());
    // 3) provider-prefixed tokens anywhere.
    let step3 = r.prefixed.replace_all(&step2, MASK);
    // 4) telegram bot tokens (inside URLs and error text).
    r.telegram
        .replace_all(&step3, format!("bot{MASK}").as_str())
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_sensitive_key_values() {
        let out = redact("API_KEY=supersecret123\nNORMAL=keepme");
        assert!(out.contains("API_KEY="), "key name kept");
        assert!(out.contains(MASK), "value masked");
        assert!(!out.contains("supersecret123"), "secret removed");
        assert!(out.contains("NORMAL=keepme"), "non-secret untouched");
    }

    #[test]
    fn masks_quoted_and_colon_forms() {
        let out = redact(r#"db_password: "p@ss w0rd-not-matched"  GITHUB_TOKEN="abc123def""#);
        // colon form, value up to whitespace is masked, quote preserved
        assert!(out.contains("db_password:"));
        assert!(out.contains(r#"GITHUB_TOKEN="***REDACTED***""#));
        assert!(!out.contains("abc123def"));
    }

    #[test]
    fn masks_bearer_and_prefixed_tokens() {
        let out = redact("Authorization: Bearer abcDEF.123_tok-xyz");
        assert!(out.contains("Bearer ***REDACTED***"));
        assert!(!out.contains("abcDEF.123_tok-xyz"));

        let out = redact("key AKIAIOSFODNN7EXAMPLE and ghp_0123456789abcdefghijABCDEF and sk-0123456789abcdefXYZ");
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!out.contains("ghp_0123456789abcdefghijABCDEF"));
        assert!(!out.contains("sk-0123456789abcdefXYZ"));
    }

    #[test]
    fn masks_telegram_bot_tokens_in_urls() {
        let out = redact(
            "error sending request for url (https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage)",
        );
        assert!(!out.contains("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"));
        assert!(out.contains("api.telegram.org"), "url structure kept");
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let s = "Just a normal log line: request to /api/users took 42ms";
        assert_eq!(redact(s), s);
    }
}
