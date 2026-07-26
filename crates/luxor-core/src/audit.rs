//! Static project audit (plan part 1.3 "killer feature").
//!
//! A real, dependency-light scanner that walks a project (honouring
//! `.gitignore` via the `ignore` crate) and flags concrete risk signals:
//! hard-coded secrets, private-key blobs, `unsafe` Rust, panic-prone
//! `unwrap()/expect()`, dangerous JS (`eval`, `dangerouslySetInnerHTML`) and
//! tech-debt markers (`TODO/FIXME`). It returns severity-bucketed findings the
//! UI and Discord presence (audit frame) consume, and feeds the audit counters
//! (`audits_run`, `issues_fixed`) and the `purity_keeper` achievement.
//!
//! It is intentionally heuristic and offline — no network, no LLM — so it fits
//! the zero-overhead budget and runs fully locally.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Finding severity, highest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

/// A single audit finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub severity: Severity,
    /// Stable rule id, e.g. "hardcoded_secret".
    pub rule: String,
    /// Project-relative file path.
    pub file: String,
    pub line: usize,
    pub message: String,
}

/// Aggregated audit result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditReport {
    pub findings: Vec<Finding>,
    pub files_scanned: i64,
    pub lines_scanned: i64,
    pub critical: i64,
    pub high: i64,
    pub medium: i64,
    pub low: i64,
    pub total: i64,
}

/// Files larger than this are skipped (likely generated / binary).
const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Hard cap on findings so a pathological repo can't blow up memory/UI.
const MAX_FINDINGS: usize = 2000;

/// Skip obvious non-source / vendored directories even if not in .gitignore.
fn is_skippable_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "dist" | ".git" | "vendor" | "build" | ".next" | "out"
    )
}

/// Only scan text-ish source files.
fn is_source_ext(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some(
            "rs" | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "py"
                | "go"
                | "java"
                | "kt"
                | "c"
                | "h"
                | "cpp"
                | "cc"
                | "hpp"
                | "cs"
                | "rb"
                | "php"
                | "swift"
                | "sh"
                | "bash"
                | "zsh"
                | "toml"
                | "yaml"
                | "yml"
                | "json"
                | "env"
                | "ini"
                | "cfg"
                | "sql"
                | "html"
                | "css"
                | "scss"
        )
    )
}

struct Rules {
    secret_prefixed: regex::Regex,
    secret_kv: regex::Regex,
    private_key: regex::Regex,
}

fn rules() -> &'static Rules {
    use std::sync::OnceLock;
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| Rules {
        // Provider-prefixed tokens (GitHub/Slack/OpenAI/AWS) — high confidence.
        secret_prefixed: regex::Regex::new(
            r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b",
        )
        .expect("valid secret_prefixed regex"),
        // `SECRET = "literal"` where the value is not an env/placeholder.
        secret_kv: regex::Regex::new(
            r#"(?i)\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_]*\s*[:=]\s*["'][^"'$\{][^"']{5,}["']"#,
        )
        .expect("valid secret_kv regex"),
        private_key: regex::Regex::new(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")
            .expect("valid private_key regex"),
    })
}

/// Run the audit over `root`. Walks the tree, applies per-line rules.
pub fn run_audit(root: &Path) -> Result<AuditReport> {
    if !root.exists() {
        return Err(Error::NotFound(format!(
            "audit path not found: {}",
            root.display()
        )));
    }
    let rx = rules();
    let mut report = AuditReport::default();

    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .hidden(false)
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|n| !is_skippable_dir(n))
                .unwrap_or(true)
        })
        .build();

    for entry in walker.flatten() {
        if report.findings.len() >= MAX_FINDINGS {
            break;
        }
        let path = entry.path();
        if !path.is_file() || !is_source_ext(path) {
            continue;
        }
        if entry
            .metadata()
            .map(|m| m.len() > MAX_FILE_BYTES)
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue; // binary / non-utf8
        };
        report.files_scanned += 1;
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let is_rust = ext == "rs";
        let is_js = matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs");

        for (i, raw) in content.lines().enumerate() {
            report.lines_scanned += 1;
            let line_no = i + 1;
            let line = raw.trim_start();
            if line.starts_with("//") || line.starts_with('#') || line.starts_with('*') {
                // Skip comment-only lines for code rules (still scan for secrets).
                if rx.secret_prefixed.is_match(raw) {
                    push(
                        &mut report,
                        Severity::Critical,
                        "hardcoded_secret",
                        &rel,
                        line_no,
                        "Возможный захардкоженный токен",
                    );
                }
                continue;
            }
            if rx.private_key.is_match(raw) {
                push(
                    &mut report,
                    Severity::Critical,
                    "private_key",
                    &rel,
                    line_no,
                    "Приватный ключ в репозитории",
                );
            } else if rx.secret_prefixed.is_match(raw) {
                push(
                    &mut report,
                    Severity::Critical,
                    "hardcoded_secret",
                    &rel,
                    line_no,
                    "Возможный захардкоженный токен (provider-prefixed)",
                );
            } else if rx.secret_kv.is_match(raw) {
                push(
                    &mut report,
                    Severity::High,
                    "hardcoded_secret",
                    &rel,
                    line_no,
                    "Похоже на захардкоженный секрет в коде",
                );
            }
            if is_rust && line.contains("unsafe ") && line.contains('{') {
                push(
                    &mut report,
                    Severity::High,
                    "unsafe_block",
                    &rel,
                    line_no,
                    "Блок unsafe — проверьте инварианты памяти",
                );
            }
            if is_rust && (line.contains(".unwrap()") || line.contains(".expect(")) {
                push(
                    &mut report,
                    Severity::Low,
                    "panic_risk",
                    &rel,
                    line_no,
                    "unwrap/expect может паниковать в проде",
                );
            }
            if is_js && line.contains("eval(") {
                push(
                    &mut report,
                    Severity::High,
                    "js_eval",
                    &rel,
                    line_no,
                    "eval() — риск инъекции кода",
                );
            }
            if is_js && line.contains("dangerouslySetInnerHTML") {
                push(
                    &mut report,
                    Severity::Medium,
                    "dangerous_html",
                    &rel,
                    line_no,
                    "dangerouslySetInnerHTML — риск XSS",
                );
            }
            if line.contains("TODO")
                || line.contains("FIXME")
                || line.contains("XXX")
                || line.contains("HACK")
            {
                push(
                    &mut report,
                    Severity::Low,
                    "tech_debt",
                    &rel,
                    line_no,
                    "Маркер техдолга (TODO/FIXME)",
                );
            }
        }
    }

    report.critical = count(&report, Severity::Critical);
    report.high = count(&report, Severity::High);
    report.medium = count(&report, Severity::Medium);
    report.low = count(&report, Severity::Low);
    report.total = report.findings.len() as i64;
    Ok(report)
}

fn push(r: &mut AuditReport, severity: Severity, rule: &str, file: &str, line: usize, msg: &str) {
    if r.findings.len() >= MAX_FINDINGS {
        return;
    }
    r.findings.push(Finding {
        severity,
        rule: rule.into(),
        file: file.into(),
        line,
        message: msg.into(),
    });
}

fn count(r: &AuditReport, sev: Severity) -> i64 {
    r.findings.iter().filter(|f| f.severity == sev).count() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn detects_secrets_unsafe_and_debt() {
        let dir = tempfile::tempdir().unwrap();
        let rs = dir.path().join("main.rs");
        let mut f = std::fs::File::create(&rs).unwrap();
        writeln!(f, "fn main() {{").unwrap();
        writeln!(
            f,
            "    let token = \"ghp_abcdefghijklmnopqrstuvwxyz0123456789\";"
        )
        .unwrap();
        writeln!(f, "    unsafe {{ do_thing(); }}").unwrap();
        writeln!(f, "    let x = foo().unwrap(); // TODO: handle error").unwrap();
        writeln!(f, "}}").unwrap();

        let report = run_audit(dir.path()).unwrap();
        assert!(report.files_scanned >= 1);
        assert!(
            report.critical >= 1,
            "expected a secret finding: {report:?}"
        );
        assert!(report.high >= 1, "expected unsafe finding");
        assert!(report.low >= 1, "expected unwrap/TODO finding");
        assert_eq!(report.total, report.findings.len() as i64);
    }

    #[test]
    fn skips_env_placeholders() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("config.ts");
        std::fs::write(
            &f,
            "const apiKey = process.env.API_KEY;\nconst secret = \"${SECRET}\";\n",
        )
        .unwrap();
        let report = run_audit(dir.path()).unwrap();
        // Neither an env read nor a ${...} placeholder should be flagged.
        assert_eq!(
            report.critical + report.high,
            0,
            "false positive: {report:?}"
        );
    }
}
