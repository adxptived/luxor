//! Support for the `luxor` CLI companion (`luxor .` opens the current
//! directory as a project).
//!
//! The handshake is file-based so it needs no sockets or plugins:
//! * the running app writes `app.pid` into its data dir and polls
//!   `cli-requests.jsonl` (draining it) every few seconds;
//! * the CLI appends the resolved path to `cli-requests.jsonl` and, when no
//!   live app pid is found, spawns the app binary.
//!
//! All functions take an explicit base directory so they are testable; the
//! real base is [`default_base_dir`] (`{config_dir}/luxor`).

use std::fs;
use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// `{config_dir}/luxor` — same directory as `config.toml`.
pub fn default_base_dir() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| Error::InvalidInput("no config directory on this platform".into()))?
        .join("luxor");
    Ok(dir)
}

/// Resolve a CLI argument into the project directory to open.
///
/// Relative paths are resolved against `cwd`; files resolve to their parent
/// directory; the path must exist.
pub fn resolve_open_path(arg: &str, cwd: &Path) -> Result<PathBuf> {
    let raw = if Path::new(arg).is_absolute() {
        PathBuf::from(arg)
    } else {
        cwd.join(arg)
    };
    let path = raw
        .canonicalize()
        .map_err(|e| Error::InvalidInput(format!("{}: {e}", raw.display())))?;
    if path.is_dir() {
        Ok(path)
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| Error::InvalidInput(format!("{}: not a directory", path.display())))
    }
}

fn requests_file(base: &Path) -> PathBuf {
    base.join("cli-requests.jsonl")
}

fn pid_file(base: &Path) -> PathBuf {
    base.join("app.pid")
}

/// Append an open request (one JSON string per line).
pub fn push_request(base: &Path, path: &Path) -> Result<()> {
    fs::create_dir_all(base)?;
    let line = serde_json::to_string(&path.to_string_lossy())? + "\n";
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(requests_file(base))?;
    f.write_all(line.as_bytes())?;
    Ok(())
}

/// Read and remove all pending open requests (deduped, order preserved).
pub fn drain_requests(base: &Path) -> Result<Vec<String>> {
    let file = requests_file(base);
    let content = match fs::read_to_string(&file) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let _ = fs::remove_file(&file);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in content.lines() {
        let Ok(path) = serde_json::from_str::<String>(line) else {
            continue;
        };
        if !path.is_empty() && seen.insert(path.clone()) {
            out.push(path);
        }
    }
    Ok(out)
}

/// Record the current process as the running app instance.
pub fn write_pid_file(base: &Path) -> Result<()> {
    fs::create_dir_all(base)?;
    fs::write(pid_file(base), std::process::id().to_string())?;
    Ok(())
}

/// Pid recorded by a (possibly stale) app instance, if any.
pub fn read_app_pid(base: &Path) -> Option<u32> {
    fs::read_to_string(pid_file(base)).ok()?.trim().parse().ok()
}

/// Remove the app pid file during a clean shutdown. Missing is fine.
pub fn remove_pid_file(base: &Path) -> Result<()> {
    match fs::remove_file(pid_file(base)) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Whether a process with this pid is currently alive.
pub fn pid_alive(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), false);
    sys.process(Pid::from_u32(pid)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_handles_relative_dirs_files_and_missing_paths() {
        let dir = tempdir().unwrap();
        let cwd = dir.path().canonicalize().unwrap();
        fs::create_dir(cwd.join("proj")).unwrap();
        fs::write(cwd.join("proj/main.rs"), "fn main() {}").unwrap();

        // "." resolves to the cwd itself.
        assert_eq!(resolve_open_path(".", &cwd).unwrap(), cwd);
        // Relative directory.
        assert_eq!(resolve_open_path("proj", &cwd).unwrap(), cwd.join("proj"));
        // A file resolves to its parent directory.
        assert_eq!(
            resolve_open_path("proj/main.rs", &cwd).unwrap(),
            cwd.join("proj")
        );
        // Missing paths are an error.
        assert!(resolve_open_path("nope", &cwd).is_err());
    }

    #[test]
    fn push_then_drain_roundtrips_and_dedupes() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        assert_eq!(drain_requests(base).unwrap(), Vec::<String>::new());

        push_request(base, Path::new("/a b/проект")).unwrap();
        push_request(base, Path::new("/c")).unwrap();
        push_request(base, Path::new("/a b/проект")).unwrap();

        let drained = drain_requests(base).unwrap();
        assert_eq!(drained, vec!["/a b/проект".to_string(), "/c".to_string()]);
        // Draining consumed the file.
        assert_eq!(drain_requests(base).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn drain_skips_corrupt_lines() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        fs::create_dir_all(base).unwrap();
        fs::write(requests_file(base), "not json\n\"/ok\"\n{bad\n").unwrap();
        assert_eq!(drain_requests(base).unwrap(), vec!["/ok".to_string()]);
    }

    #[test]
    fn pid_alive_detects_own_process() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(u32::MAX - 7));
    }

    #[test]
    fn pid_file_roundtrip() {
        let dir = tempdir().unwrap();
        let base = dir.path();
        assert_eq!(read_app_pid(base), None);
        write_pid_file(base).unwrap();
        assert_eq!(read_app_pid(base), Some(std::process::id()));
        remove_pid_file(base).unwrap();
        assert_eq!(read_app_pid(base), None);
    }
}
