//! Real terminal sessions backed by `portable-pty` (ConPTY on Windows, openpty on Unix).
//!
//! The manager is GUI-agnostic: output and exit notifications are pushed into an
//! [`OutputSink`] callback, which the Tauri layer forwards as events to xterm.js.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Events emitted by terminal sessions.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PtyEvent {
    /// Raw output bytes from the shell (UTF-8 is *not* guaranteed).
    Output { session_id: String, bytes: Vec<u8> },
    /// The shell exited.
    Exited {
        session_id: String,
        exit_code: Option<u32>,
    },
}

/// Callback receiving session events. Must be cheap & non-blocking.
pub type OutputSink = Arc<dyn Fn(PtyEvent) + Send + Sync>;

/// PTY output coalescing (see the reader/flusher threads in `spawn`).
///
/// Interactive shells hand back output in tiny reads (tens–hundreds of bytes),
/// and a naive "one Tauri event per `read()`" pump produces thousands of
/// events/sec under heavy output (build logs, `cat` of a large file) — each one
/// paying JSON + base64 + the IPC bridge + `term.write()`. We instead batch
/// bytes and flush when either ~8 ms has elapsed since the first pending byte
/// (keeps latency imperceptible) or ~64 KB has accumulated (bounds memory and
/// per-event cost). This cuts event volume by 1–2 orders of magnitude while
/// preserving interactive responsiveness.
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
const FLUSH_THRESHOLD: usize = 64 * 1024;

/// Options for spawning a new terminal session.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct SpawnOptions {
    /// Shell program; `None` = platform default.
    pub shell: Option<String>,
    pub args: Vec<String>,
    /// Working directory; `None` = inherit.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Commands written to the shell right after start (layout preset autorun).
    pub autorun: Vec<String>,
    /// Add `-NoLogo -NoProfile` for PowerShell when no explicit args are set.
    #[serde(default = "default_fast_powershell_startup")]
    pub fast_powershell_startup: bool,
}

impl Default for SpawnOptions {
    fn default() -> Self {
        Self {
            shell: None,
            args: Vec::new(),
            cwd: None,
            cols: 0,
            rows: 0,
            autorun: Vec::new(),
            fast_powershell_startup: default_fast_powershell_startup(),
        }
    }
}

/// Description of a live session.
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub shell: String,
    pub cwd: Option<String>,
    /// OS pid of the shell process (used for per-terminal resource stats).
    pub pid: Option<u32>,
}

struct Session {
    info: SessionInfo,
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// A shell program found on the system (embedded-terminal settings picker).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DetectedShell {
    /// Program name/path to spawn.
    pub command: String,
    /// Human-readable label.
    pub label: String,
}

/// Shells probed by [`detect_shells`]: `(command, label)`.
pub const KNOWN_SHELLS: &[(&str, &str)] = &[
    ("powershell.exe", "PowerShell"),
    ("pwsh", "PowerShell 7"),
    ("cmd.exe", "Command Prompt"),
    ("bash", "Bash"),
    ("zsh", "Zsh"),
    ("fish", "Fish"),
    ("nu", "Nushell"),
    ("wsl.exe", "WSL"),
];

/// Shells installed on this machine (PATH probe). The platform default and
/// `$SHELL` are always included so the picker never comes up empty.
pub fn detect_shells() -> Vec<DetectedShell> {
    let mut out: Vec<DetectedShell> = Vec::new();
    let mut push = |command: String, label: String| {
        if !out.iter().any(|s| s.command == command) {
            out.push(DetectedShell { command, label });
        }
    };
    let default = default_shell();
    push(default.clone(), format!("System default ({default})"));
    for (cmd, label) in KNOWN_SHELLS {
        if which::which(cmd).is_ok() {
            push((*cmd).to_string(), (*label).to_string());
        }
    }
    out
}

/// Platform default shell.
pub fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn default_fast_powershell_startup() -> bool {
    true
}

fn default_shell_args(
    shell: &str,
    configured_args: &[String],
    fast_powershell_startup: bool,
) -> Vec<String> {
    // Explicit user arguments always win — never second-guess them.
    if !configured_args.is_empty() {
        return configured_args.to_vec();
    }
    let name = std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();
    let is_powershell = matches!(
        name.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    );
    if !is_powershell {
        return Vec::new();
    }
    if fast_powershell_startup {
        // Fast start: skip the user profile and hide the banner.
        vec!["-NoLogo".into(), "-NoProfile".into()]
    } else {
        // Profile mode: load the user's PowerShell profile (oh-my-posh prompt,
        // aliases, functions) just like Windows Terminal does. `-NoLogo` only
        // hides the startup banner; it does NOT affect profile loading.
        vec!["-NoLogo".into()]
    }
}

/// Manages all live PTY sessions.
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    sink: OutputSink,
}

impl PtyManager {
    pub fn new(sink: OutputSink) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sink,
        }
    }

    /// Spawn a new shell session; returns its id.
    pub fn spawn(&self, opts: SpawnOptions) -> Result<SessionInfo> {
        let shell = opts.shell.clone().unwrap_or_else(default_shell);
        let cols = if opts.cols == 0 { 80 } else { opts.cols };
        let rows = if opts.rows == 0 { 24 } else { opts.rows };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(format!("openpty failed: {e}")))?;

        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(default_shell_args(
            &shell,
            &opts.args,
            opts.fast_powershell_startup,
        ));
        if let Some(cwd) = &opts.cwd {
            if !std::path::Path::new(cwd).is_dir() {
                return Err(Error::Pty(format!(
                    "working directory does not exist: {cwd}"
                )));
            }
            cmd.cwd(cwd);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::Pty(format!("failed to start {shell}: {e}")))?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| Error::Pty(format!("cannot get pty writer: {e}")))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| Error::Pty(format!("cannot get pty reader: {e}")))?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let info = SessionInfo {
            session_id: session_id.clone(),
            shell: shell.clone(),
            cwd: opts.cwd.clone(),
            pid: child.process_id(),
        };

        // Exactly one `Exited` event per session, whichever side notices first:
        // `child.wait()` can block indefinitely on some hosts even after the
        // shell is gone, while the PTY reader reliably sees EOF — and vice
        // versa on others.
        let exit_sent = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Output path is split across two threads so we can coalesce bytes
        // without ever holding up the blocking `read()`:
        //
        //   reader  --(Vec<u8> chunks via mpsc)-->  flusher  --(sink)-->  UI
        //
        // The reader only reads and forwards raw chunks. The flusher batches
        // them with `recv_timeout(FLUSH_INTERVAL)` and emits a single coalesced
        // `Output` event on timeout or once `FLUSH_THRESHOLD` bytes accumulate.
        // This is the standard VS Code / Alacritty bridge pattern. Two threads
        // per session is acceptable — the reader thread already existed.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        // Reader thread: pump raw chunks into the channel until EOF. Dropping
        // `tx` on exit signals EOF to the flusher via `Disconnected`.
        std::thread::Builder::new()
            .name(format!("pty-read-{}", &session_id[..8]))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            // If the flusher is gone the session is tearing
                            // down; stop reading.
                            if tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                    }
                }
            })
            .map_err(|e| Error::Pty(format!("failed to start reader thread: {e}")))?;

        // Flusher thread: coalesce chunks and emit batched output events.
        let sink = Arc::clone(&self.sink);
        let flush_session = session_id.clone();
        let flush_exit_sent = Arc::clone(&exit_sent);
        std::thread::Builder::new()
            .name(format!("pty-flush-{}", &session_id[..8]))
            .spawn(move || {
                let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_THRESHOLD);
                let mut first_byte_at: Option<Instant> = None;
                let flush = |pending: &mut Vec<u8>| {
                    if !pending.is_empty() {
                        sink(PtyEvent::Output {
                            session_id: flush_session.clone(),
                            bytes: std::mem::take(pending),
                        });
                    }
                };
                loop {
                    // Wait only for the remaining slice of the flush window so a
                    // steady trickle still flushes on time.
                    let timeout = match first_byte_at {
                        Some(t) => FLUSH_INTERVAL.saturating_sub(t.elapsed()),
                        None => FLUSH_INTERVAL,
                    };
                    match rx.recv_timeout(timeout) {
                        Ok(chunk) => {
                            pending.extend_from_slice(&chunk);
                            first_byte_at.get_or_insert_with(Instant::now);
                            let due = first_byte_at.is_some_and(|t| t.elapsed() >= FLUSH_INTERVAL);
                            if pending.len() >= FLUSH_THRESHOLD || due {
                                flush(&mut pending);
                                first_byte_at = None;
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            flush(&mut pending);
                            first_byte_at = None;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            // Reader hit EOF: emit whatever is buffered.
                            flush(&mut pending);
                            break;
                        }
                    }
                }
                // EOF: give the wait thread a moment to report the real exit
                // code, then emit a fallback Exited so the UI never shows a
                // zombie terminal.
                std::thread::sleep(Duration::from_millis(200));
                if !flush_exit_sent.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    sink(PtyEvent::Exited {
                        session_id: flush_session,
                        exit_code: None,
                    });
                }
            })
            .map_err(|e| Error::Pty(format!("failed to start flusher thread: {e}")))?;

        // Wait thread: emit Exited when the shell terminates.
        let sink = Arc::clone(&self.sink);
        let wait_session = session_id.clone();
        let wait_exit_sent = Arc::clone(&exit_sent);
        std::thread::Builder::new()
            .name(format!("pty-wait-{}", &session_id[..8]))
            .spawn(move || {
                let exit_code = child.wait().ok().map(|status| status.exit_code());
                if !wait_exit_sent.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    sink(PtyEvent::Exited {
                        session_id: wait_session,
                        exit_code,
                    });
                }
            })
            .map_err(|e| Error::Pty(format!("failed to start wait thread: {e}")))?;

        // Autorun commands from layout presets.
        for command in &opts.autorun {
            writer
                .write_all(format!("{command}\r").as_bytes())
                .map_err(|e| Error::Pty(format!("autorun write failed: {e}")))?;
        }

        let session = Session {
            info: info.clone(),
            writer,
            master: pair.master,
            killer,
        };
        self.sessions
            .lock()
            .map_err(|e| Error::Pty(format!("sessions lock poisoned: {e}")))?
            .insert(session_id, session);
        Ok(info)
    }

    /// Write user input to a session.
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| Error::Pty(format!("sessions lock poisoned: {e}")))?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| Error::NotFound(format!("terminal session {session_id}")))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| Error::Pty(format!("write failed: {e}")))?;
        session.writer.flush().ok();
        Ok(())
    }

    /// Resize a session's PTY.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| Error::Pty(format!("sessions lock poisoned: {e}")))?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| Error::NotFound(format!("terminal session {session_id}")))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(format!("resize failed: {e}")))
    }

    /// Kill a session and remove it from the registry.
    pub fn kill(&self, session_id: &str) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| Error::Pty(format!("sessions lock poisoned: {e}")))?;
        let mut session = sessions
            .remove(session_id)
            .ok_or_else(|| Error::NotFound(format!("terminal session {session_id}")))?;
        session
            .killer
            .kill()
            .map_err(|e| Error::Pty(format!("kill failed: {e}")))?;
        Ok(())
    }

    /// Remove bookkeeping for a session that exited on its own.
    pub fn forget(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
        // If the lock is poisoned the session bookkeeping is stale, but
        // forgetting is best-effort — there's nothing useful to panic over.
    }

    /// Live sessions.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .map(|sessions| sessions.values().map(|s| s.info.clone()).collect())
            .unwrap_or_default()
    }

    /// Kill all sessions (app shutdown).
    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.killer.kill();
            }
        }
        // If the lock is poisoned we can't cleanly kill sessions, but
        // shutdown is best-effort — panicking here would prevent the app
        // from exiting at all.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn detect_shells_always_includes_default() {
        let shells = detect_shells();
        assert!(!shells.is_empty());
        assert_eq!(shells[0].command, default_shell());
        // No duplicates.
        let mut commands: Vec<_> = shells.iter().map(|s| &s.command).collect();
        commands.dedup();
        assert_eq!(commands.len(), shells.len());
    }

    fn collect_events() -> (OutputSink, mpsc::Receiver<PtyEvent>) {
        let (tx, rx) = mpsc::channel();
        let sink: OutputSink = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        (sink, rx)
    }

    #[cfg(unix)]
    #[test]
    fn spawn_echo_and_collect_output() {
        let (sink, rx) = collect_events();
        let manager = PtyManager::new(sink);
        let info = manager
            .spawn(SpawnOptions {
                shell: Some("/bin/sh".into()),
                args: vec!["-c".into(), "echo luxor-pty-ok".into()],
                ..Default::default()
            })
            .unwrap();

        let mut output = Vec::new();
        let mut exited = false;
        let mut kill_sent = false;
        // Under heavy parallel test load some sandboxes fail to deliver the
        // child exit promptly; after the grace period force-kill the session,
        // which must still produce exactly one Exited event.
        let kill_after = std::time::Instant::now() + Duration::from_secs(10);
        let deadline = kill_after + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(PtyEvent::Output { bytes, .. }) => output.extend(bytes),
                Ok(PtyEvent::Exited { .. }) => {
                    exited = true;
                    break;
                }
                Err(_) => {}
            }
            if !kill_sent && std::time::Instant::now() > kill_after {
                kill_sent = true;
                let _ = manager.kill(&info.session_id);
            }
        }
        assert!(exited, "shell did not exit in time");
        let text = String::from_utf8_lossy(&output);
        assert!(text.contains("luxor-pty-ok"), "output was: {text:?}");
        manager.forget(&info.session_id);
    }

    #[cfg(unix)]
    #[test]
    fn write_and_kill_session() {
        let (sink, rx) = collect_events();
        let manager = PtyManager::new(sink);
        let info = manager
            .spawn(SpawnOptions {
                shell: Some("/bin/sh".into()),
                ..Default::default()
            })
            .unwrap();
        manager
            .write(&info.session_id, b"echo written-input\n")
            .unwrap();

        let mut output = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            if let Ok(PtyEvent::Output { bytes, .. }) = rx.recv_timeout(Duration::from_millis(200))
            {
                output.extend(bytes);
                if String::from_utf8_lossy(&output).contains("written-input") {
                    break;
                }
            }
        }
        assert!(String::from_utf8_lossy(&output).contains("written-input"));

        manager.resize(&info.session_id, 120, 40).unwrap();
        manager.kill(&info.session_id).unwrap();
        assert!(manager.list().is_empty());
    }

    #[test]
    fn powershell_fast_startup_adds_default_args_only_when_safe() {
        assert_eq!(
            default_shell_args("powershell.exe", &[], true),
            vec!["-NoLogo".to_string(), "-NoProfile".to_string()]
        );
        assert_eq!(
            default_shell_args("C:/Program Files/PowerShell/7/pwsh.exe", &[], true),
            vec!["-NoLogo".to_string(), "-NoProfile".to_string()]
        );
        // Profile mode (fast startup off): load the profile but still hide the
        // banner with -NoLogo (and crucially NOT -NoProfile).
        assert_eq!(
            default_shell_args("pwsh", &[], false),
            vec!["-NoLogo".to_string()]
        );
        assert_eq!(
            default_shell_args("powershell.exe", &[], false),
            vec!["-NoLogo".to_string()]
        );
        assert_eq!(
            default_shell_args("powershell.exe", &["-NoLogo".into()], true),
            vec!["-NoLogo".to_string()]
        );
        assert_eq!(default_shell_args("bash", &[], true), Vec::<String>::new());
        // Non-PowerShell shells get no injected args in either mode.
        assert_eq!(default_shell_args("bash", &[], false), Vec::<String>::new());
    }

    #[test]
    fn spawn_options_default_keeps_fast_powershell_startup_enabled() {
        let opts = SpawnOptions::default();
        assert!(opts.fast_powershell_startup);
        assert!(default_fast_powershell_startup());
    }

    #[test]
    fn unknown_session_is_not_found() {
        let (sink, _rx) = collect_events();
        let manager = PtyManager::new(sink);
        assert_eq!(manager.write("nope", b"x").unwrap_err().kind(), "not_found");
        assert_eq!(
            manager.resize("nope", 80, 24).unwrap_err().kind(),
            "not_found"
        );
        assert_eq!(manager.kill("nope").unwrap_err().kind(), "not_found");
    }

    #[test]
    fn bad_cwd_rejected() {
        let (sink, _rx) = collect_events();
        let manager = PtyManager::new(sink);
        let err = manager
            .spawn(SpawnOptions {
                cwd: Some("/definitely/not/a/dir".into()),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(err.kind(), "pty");
    }
}
