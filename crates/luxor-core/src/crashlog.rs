//! Crash reporter: a panic hook writes a timestamped report to the config
//! directory; the Health panel lists and shows them so users can attach
//! reports to GitHub issues.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
pub struct CrashReport {
    /// File name, e.g. `crash-2026-06-12T10-00-00Z.txt`.
    pub name: String,
    pub modified: i64,
    pub size: u64,
}

pub fn crash_dir() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| Error::Config("no config directory".into()))?
        .join(crate::APP_ID)
        .join("crashes");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write a crash report; returns the file path. Keeps the 20 newest reports.
///
/// The payload is run through [`crate::redact`] first: a panic backtrace or
/// captured environment can contain tokens/keys, and these reports are meant to
/// be attached to public GitHub issues.
pub fn write_crash(payload: &str) -> Result<PathBuf> {
    let dir = crash_dir()?;
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ");
    let path = dir.join(format!("crash-{stamp}.txt"));
    fs::write(&path, crate::redact::redact(payload))?;
    // Retention: drop oldest beyond 20.
    let mut reports = list_crashes()?;
    if reports.len() > 20 {
        reports.sort_by_key(|r| r.modified);
        for old in &reports[..reports.len() - 20] {
            let _ = fs::remove_file(dir.join(&old.name));
        }
    }
    Ok(path)
}

pub fn list_crashes() -> Result<Vec<CrashReport>> {
    let dir = crash_dir()?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("crash-") || !name.ends_with(".txt") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(CrashReport {
            name,
            modified,
            size: meta.len(),
        });
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.modified));
    Ok(out)
}

pub fn read_crash(name: &str) -> Result<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(Error::InvalidInput("invalid crash report name".into()));
    }
    let path = crash_dir()?.join(name);
    if !path.is_file() {
        return Err(Error::NotFound(format!("crash report {name}")));
    }
    Ok(fs::read_to_string(path)?)
}

/// Render a panic payload into a readable report body.
pub fn format_panic(info: &std::panic::PanicHookInfo<'_>, version: &str) -> String {
    let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    };
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "<unknown>".into());
    format!(
        "Luxor crash report\nversion: {version}\ntime: {}\nos: {} {}\nlocation: {location}\nmessage: {message}\n\nbacktrace:\n{}",
        chrono::Utc::now().to_rfc3339(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::backtrace::Backtrace::force_capture(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_roundtrip_and_name_guard() {
        let path = write_crash("test crash body").unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let listed = list_crashes().unwrap();
        assert!(listed.iter().any(|r| r.name == name));
        assert_eq!(read_crash(&name).unwrap(), "test crash body");
        assert!(read_crash("../../etc/passwd").is_err());
        let _ = fs::remove_file(path);
    }
}
