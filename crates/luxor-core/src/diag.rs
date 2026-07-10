//! User-facing diagnostics: a frontend event log (errors, UI freezes) persisted
//! to the config dir, plus a one-click "export diagnostics" report bundling
//! everything a user needs to attach to a bug report — app version, OS, config,
//! crash reports and the recent frontend log.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::{crashlog, Error, Result};

/// Cap for `frontend.log`; when exceeded the file is rewritten with its
/// newest half so it never grows unbounded.
const LOG_CAP_BYTES: u64 = 512 * 1024;
/// How much of the frontend log the diagnostics report embeds.
const LOG_TAIL_BYTES: usize = 64 * 1024;
/// How many of the newest crash reports are embedded in full.
const EMBED_CRASHES: usize = 3;

pub fn frontend_log_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| Error::Config("no config directory".into()))?
        .join(crate::APP_ID);
    fs::create_dir_all(&dir)?;
    Ok(dir.join("frontend.log"))
}

/// Append a timestamped line to the frontend log (errors, freezes, …).
pub fn frontend_log(entry: &str) -> Result<()> {
    let path = frontend_log_path()?;
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > LOG_CAP_BYTES {
            rotate(&path)?;
        }
    }
    let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let line = format!("[{ts}] {}\n", entry.replace('\n', " | "));
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    f.write_all(line.as_bytes())?;
    Ok(())
}

/// Keep the newest half of the log when it exceeds the cap.
fn rotate(path: &PathBuf) -> Result<()> {
    let content = fs::read_to_string(path).unwrap_or_default();
    let half = content.len() / 2;
    // Cut on a line boundary so the file stays well-formed.
    let start = content[half..]
        .find('\n')
        .map(|i| half + i + 1)
        .unwrap_or(half);
    fs::write(path, &content[start..])?;
    Ok(())
}

/// Last `LOG_TAIL_BYTES` of the frontend log ("" when absent).
pub fn frontend_log_tail() -> String {
    let Ok(path) = frontend_log_path() else {
        return String::new();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return String::new();
    };
    if content.len() <= LOG_TAIL_BYTES {
        return content;
    }
    let start = content.len() - LOG_TAIL_BYTES;
    let start = content[start..]
        .find('\n')
        .map(|i| start + i + 1)
        .unwrap_or(start);
    content[start..].to_string()
}

/// Truncate the frontend log to empty (used by the Developer "Clear logs"
/// action). Missing file is treated as success.
pub fn frontend_log_clear() -> Result<()> {
    let path = frontend_log_path()?;
    if path.exists() {
        fs::write(&path, b"")?;
    }
    Ok(())
}

/// The directory that holds `frontend.log` (and config), for "Open log folder".
pub fn log_dir() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .ok_or_else(|| Error::Config("no config directory".into()))?
        .join(crate::APP_ID))
}

/// Build the full plain-text diagnostics report.
///
/// `config_toml` is the current config re-serialized by the caller (the core
/// crate stores no secrets in it — tokens live in the OS keychain).
pub fn collect(version: &str, config_toml: &str) -> String {
    let mut out = String::new();
    let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    out.push_str(&format!(
        "Luxor diagnostics report\n========================\nGenerated : {ts}\nVersion   : {version}\nOS        : {} {}\n\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
    ));

    out.push_str("--- Config (no secrets are stored here) ---\n");
    out.push_str(config_toml);
    out.push('\n');

    out.push_str("--- Crash reports ---\n");
    match crashlog::list_crashes() {
        Ok(list) if list.is_empty() => out.push_str("none\n"),
        Ok(list) => {
            for c in &list {
                out.push_str(&format!("{} ({} bytes)\n", c.name, c.size));
            }
            for c in list.iter().take(EMBED_CRASHES) {
                if let Ok(body) = crashlog::read_crash(&c.name) {
                    out.push_str(&format!(
                        "\n--- Crash: {} ---\n{}\n",
                        c.name,
                        body.trim_end()
                    ));
                }
            }
        }
        Err(e) => out.push_str(&format!("failed to list: {e}\n")),
    }

    out.push_str("\n--- Frontend log (errors, UI freezes; newest last) ---\n");
    let tail = frontend_log_tail();
    if tail.is_empty() {
        out.push_str("empty\n");
    } else {
        out.push_str(&tail);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_includes_sections() {
        let report = collect("9.9.9", "language = \"ru\"\n");
        assert!(report.contains("Version   : 9.9.9"));
        assert!(report.contains("language = \"ru\""));
        assert!(report.contains("Crash reports"));
        assert!(report.contains("Frontend log"));
    }

    #[test]
    fn rotate_keeps_newest_half() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frontend.log");
        let mut body = String::new();
        for i in 0..100 {
            body.push_str(&format!("line-{i}\n"));
        }
        fs::write(&path, &body).unwrap();
        rotate(&path).unwrap();
        let after = fs::read_to_string(&path).unwrap();
        assert!(after.len() < body.len());
        assert!(after.contains("line-99"));
        assert!(!after.contains("line-0\n"));
        assert!(after.starts_with("line-")); // cut on a line boundary
    }
}
