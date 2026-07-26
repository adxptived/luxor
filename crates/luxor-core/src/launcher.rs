//! Quick actions: open external terminals, file managers, IDEs and run executables.
//!
//! All commands are resolved with `which` before spawning and are executed
//! detached (no stdio inheritance into Luxor).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// External tool families used for platform defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalTerminal {
    /// Windows Terminal (`wt.exe`)
    WindowsTerminal,
    Cmd,
    Powershell,
    /// First available of x-terminal-emulator/gnome-terminal/konsole (Linux)
    LinuxDefault,
    /// Terminal.app via `open -a Terminal` (macOS)
    MacTerminal,
}

/// A spawn plan: program + args + cwd. Returned by the pure "build" functions
/// so they can be unit-tested without launching anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpawnPlan {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

fn ensure_dir(path: &str) -> Result<&Path> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(Error::Launcher(format!("directory does not exist: {path}")));
    }
    Ok(p)
}

/// Build the plan for opening an external terminal in `dir`.
pub fn plan_external_terminal(terminal: ExternalTerminal, dir: &str) -> SpawnPlan {
    match terminal {
        ExternalTerminal::WindowsTerminal => SpawnPlan {
            program: "wt.exe".into(),
            args: vec!["-d".into(), dir.into()],
            cwd: None,
        },
        ExternalTerminal::Cmd => SpawnPlan {
            program: "cmd.exe".into(),
            args: vec!["/c".into(), "start".into(), "cmd.exe".into()],
            cwd: Some(dir.into()),
        },
        ExternalTerminal::Powershell => SpawnPlan {
            program: "cmd.exe".into(),
            args: vec!["/c".into(), "start".into(), "powershell.exe".into()],
            cwd: Some(dir.into()),
        },
        ExternalTerminal::LinuxDefault => SpawnPlan {
            program: "x-terminal-emulator".into(),
            args: vec![],
            cwd: Some(dir.into()),
        },
        ExternalTerminal::MacTerminal => SpawnPlan {
            program: "open".into(),
            args: vec!["-a".into(), "Terminal".into(), dir.into()],
            cwd: None,
        },
    }
}

/// Build the plan for revealing `dir` in the OS file manager.
pub fn plan_file_manager(dir: &str) -> SpawnPlan {
    #[cfg(target_os = "windows")]
    {
        SpawnPlan {
            program: "explorer".into(),
            args: vec![dir.into()],
            cwd: None,
        }
    }
    #[cfg(target_os = "macos")]
    {
        SpawnPlan {
            program: "open".into(),
            args: vec![dir.into()],
            cwd: None,
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        SpawnPlan {
            program: "xdg-open".into(),
            args: vec![dir.into()],
            cwd: None,
        }
    }
}

/// Build the plan for opening `dir` in an IDE/editor command like `code` / `zed`.
///
/// `ide_command` is either a bare program name (resolved on PATH) or an
/// absolute path to an executable (so users can point at custom installs).
pub fn plan_ide(ide_command: &str, dir: &str) -> Result<SpawnPlan> {
    let cmd = ide_command.trim();
    if cmd.is_empty() {
        return Err(Error::InvalidInput("IDE command cannot be empty".into()));
    }
    // Bare names must be a single token (no shell metacharacters); absolute
    // paths may contain spaces (e.g. `C:\Program Files\...\zed.exe`).
    if !Path::new(cmd).is_absolute() && cmd.split_whitespace().count() != 1 {
        return Err(Error::InvalidInput(format!(
            "IDE command must be a single program name or an absolute path: {cmd:?}"
        )));
    }
    Ok(SpawnPlan {
        program: cmd.into(),
        args: vec![dir.into()],
        cwd: Some(dir.into()),
    })
}

/// A terminal emulator found on the system (for the settings picker).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedTerminal {
    /// Program name as found on PATH (e.g. `alacritty`, `wt.exe`).
    pub command: String,
    /// Human-readable label (e.g. "Alacritty").
    pub label: String,
}

/// Known terminal emulators probed by [`detect_terminals`]: `(command, label)`.
/// Order matters — it is the display order in settings.
pub const KNOWN_TERMINALS: &[(&str, &str)] = &[
    ("wt.exe", "Windows Terminal"),
    ("powershell.exe", "PowerShell"),
    ("pwsh", "PowerShell 7"),
    ("cmd.exe", "Command Prompt"),
    ("ghostty", "Ghostty"),
    ("alacritty", "Alacritty"),
    ("kitty", "kitty"),
    ("wezterm", "WezTerm"),
    ("gnome-terminal", "GNOME Terminal"),
    ("konsole", "Konsole"),
    ("xfce4-terminal", "Xfce Terminal"),
    ("tilix", "Tilix"),
    ("terminator", "Terminator"),
    ("x-terminal-emulator", "System terminal"),
];

/// Terminal emulators installed on this machine (PATH probe).
pub fn detect_terminals() -> Vec<DetectedTerminal> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut found: Vec<DetectedTerminal> = KNOWN_TERMINALS
        .iter()
        .filter(|(cmd, _)| which::which(cmd).is_ok())
        .map(|(cmd, label)| DetectedTerminal {
            command: (*cmd).into(),
            label: (*label).into(),
        })
        .collect();
    #[cfg(target_os = "macos")]
    found.push(DetectedTerminal {
        command: "open -a Terminal".into(),
        label: "Terminal.app".into(),
    });
    found
}

/// Known IDEs / editors probed by [`detect_ides`]: `(command, label)`.
/// Order matters — it is the display order in pickers.
pub const KNOWN_IDES: &[(&str, &str)] = &[
    ("code", "VS Code"),
    ("code-insiders", "VS Code Insiders"),
    ("cursor", "Cursor"),
    ("windsurf", "Windsurf"),
    ("zed", "Zed"),
    ("subl", "Sublime Text"),
    ("idea", "IntelliJ IDEA"),
    ("idea64.exe", "IntelliJ IDEA"),
    ("pycharm", "PyCharm"),
    ("pycharm64.exe", "PyCharm"),
    ("webstorm", "WebStorm"),
    ("webstorm64.exe", "WebStorm"),
    ("clion", "CLion"),
    ("rider", "Rider"),
    ("goland", "GoLand"),
    ("fleet", "Fleet"),
    ("studio", "Android Studio"),
    ("notepad++.exe", "Notepad++"),
    ("notepad++", "Notepad++"),
    ("trae", "Trae"),
    ("trae.exe", "Trae"),
    ("antigravity", "Antigravity"),
    ("antigravity.exe", "Antigravity"),
    ("kiro", "Kiro"),
    ("void", "Void"),
    ("sublime_text", "Sublime Text"),
    ("notepad.exe", "Notepad"),
    ("gnome-text-editor", "GNOME Text Editor"),
    ("mousepad", "Mousepad"),
    ("kwrite", "KWrite"),
    ("gvim", "gVim"),
    ("emacs", "Emacs"),
    ("lapce", "Lapce"),
    ("hx", "Helix"),
    ("nvim-qt", "Neovim Qt"),
    ("gedit", "gedit"),
    ("kate", "Kate"),
];

/// IDEs / editors installed on this machine (PATH probe, deduped by label).
pub fn detect_ides() -> Vec<DetectedTerminal> {
    let mut seen = std::collections::HashSet::new();
    KNOWN_IDES
        .iter()
        .filter(|(cmd, _)| which::which(cmd).is_ok())
        .filter(|(_, label)| seen.insert(*label))
        .map(|(cmd, label)| DetectedTerminal {
            command: (*cmd).into(),
            label: (*label).into(),
        })
        .collect()
}

/// Open `path` (file or directory) with the OS "default app" association —
/// the same as double-clicking it in the system file manager.
pub fn open_with_default_app(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(Error::NotFound(format!("path {}", p.display())));
    }
    // Windows: `explorer.exe <path>` rather than `cmd /C start "" <path>`.
    //
    // `cmd.exe` re-parses its own command line by rules that do NOT match the
    // C-runtime quoting `std::process::Command` applies, so shell metacharacters
    // in a FILENAME (`&`, `|`, `^`, `%`) can break out of the quoting and be
    // interpreted as commands — the same class of problem as CVE-2024-24576.
    // Paths here come from the file explorer, i.e. potentially from a cloned
    // repository containing a file called `a&calc.txt`. `explorer.exe` performs
    // the same default-app association without a shell in the middle.
    #[cfg(target_os = "windows")]
    let plan = SpawnPlan {
        program: "explorer.exe".into(),
        args: vec![path.into()],
        cwd: None,
    };
    #[cfg(target_os = "macos")]
    let plan = SpawnPlan {
        program: "open".into(),
        args: vec![path.into()],
        cwd: None,
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let plan = SpawnPlan {
        program: "xdg-open".into(),
        args: vec![path.into()],
        cwd: None,
    };
    spawn(&plan)
}

/// Build the plan for opening a *specific* terminal program in `dir`.
///
/// Knows the correct "start in directory" arguments for popular emulators;
/// anything unknown is just spawned with `dir` as its working directory.
pub fn plan_terminal_command(command: &str, dir: &str) -> SpawnPlan {
    let base = Path::new(command)
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| command.to_ascii_lowercase());
    let base = base.trim_end_matches(".exe");
    match base {
        "wt" => SpawnPlan {
            program: command.into(),
            args: vec!["-d".into(), dir.into()],
            cwd: None,
        },
        // Console shells must be started through `cmd /c start` on Windows so
        // they get their own window instead of dying headless.
        "cmd" => plan_external_terminal(ExternalTerminal::Cmd, dir),
        "powershell" | "pwsh" => SpawnPlan {
            program: "cmd.exe".into(),
            args: vec!["/c".into(), "start".into(), command.into()],
            cwd: Some(dir.into()),
        },
        "ghostty" => SpawnPlan {
            program: command.into(),
            args: vec![format!("--working-directory={dir}")],
            cwd: None,
        },
        "alacritty" => SpawnPlan {
            program: command.into(),
            args: vec!["--working-directory".into(), dir.into()],
            cwd: None,
        },
        "kitty" => SpawnPlan {
            program: command.into(),
            args: vec!["--directory".into(), dir.into()],
            cwd: None,
        },
        "wezterm" => SpawnPlan {
            program: command.into(),
            args: vec!["start".into(), "--cwd".into(), dir.into()],
            cwd: None,
        },
        "gnome-terminal" | "xfce4-terminal" | "tilix" => SpawnPlan {
            program: command.into(),
            args: vec![format!("--working-directory={dir}")],
            cwd: None,
        },
        "konsole" => SpawnPlan {
            program: command.into(),
            args: vec!["--workdir".into(), dir.into()],
            cwd: None,
        },
        _ => SpawnPlan {
            program: command.into(),
            args: vec![],
            cwd: Some(dir.into()),
        },
    }
}

/// Open a user-chosen terminal program in `dir` (settings: external terminal).
pub fn open_terminal_command(command: &str, dir: &str) -> Result<()> {
    ensure_dir(dir)?;
    let cmd = command.trim();
    if cmd.is_empty() {
        return Err(Error::InvalidInput(
            "terminal command cannot be empty".into(),
        ));
    }
    // macOS Terminal.app pseudo-command from detect_terminals().
    if cmd == "open -a Terminal" {
        return spawn(&plan_external_terminal(ExternalTerminal::MacTerminal, dir));
    }
    spawn(&plan_terminal_command(cmd, dir))
}

/// Platform default external terminal.
pub fn default_terminal() -> ExternalTerminal {
    #[cfg(target_os = "windows")]
    {
        if which::which("wt.exe").is_ok() {
            ExternalTerminal::WindowsTerminal
        } else {
            ExternalTerminal::Powershell
        }
    }
    #[cfg(target_os = "macos")]
    {
        ExternalTerminal::MacTerminal
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        ExternalTerminal::LinuxDefault
    }
}

/// Execute a spawn plan detached. The program must exist on PATH (or be a path).
pub fn spawn(plan: &SpawnPlan) -> Result<()> {
    let program = Path::new(&plan.program);
    let resolved = if program.is_absolute() {
        if !program.is_file() {
            return Err(Error::Launcher(format!(
                "program does not exist: {}",
                plan.program
            )));
        }
        program.to_path_buf()
    } else {
        which::which(&plan.program)
            .map_err(|_| Error::Launcher(format!("program not found on PATH: {}", plan.program)))?
    };
    let mut cmd = Command::new(resolved);
    cmd.args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Never flash a console window when launching GUI tools from Luxor
    // (CLI shims like `zed.exe`/`code.cmd` otherwise pop up a terminal).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Some(cwd) = &plan.cwd {
        ensure_dir(cwd)?;
        cmd.current_dir(cwd);
    }
    cmd.spawn()
        .map_err(|e| Error::Launcher(format!("failed to start {}: {e}", plan.program)))?;
    Ok(())
}

/// Open an external terminal in `dir` using the platform default (or `terminal`).
pub fn open_external_terminal(dir: &str, terminal: Option<ExternalTerminal>) -> Result<()> {
    ensure_dir(dir)?;
    let term = terminal.unwrap_or_else(default_terminal);
    let mut plan = plan_external_terminal(term, dir);
    // Linux: pick the first terminal emulator that actually exists.
    if term == ExternalTerminal::LinuxDefault {
        for candidate in [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "alacritty",
            "kitty",
        ] {
            if which::which(candidate).is_ok() {
                plan.program = candidate.into();
                break;
            }
        }
    }
    spawn(&plan)
}

/// Reveal `dir` in the OS file manager.
pub fn open_file_manager(dir: &str) -> Result<()> {
    ensure_dir(dir)?;
    spawn(&plan_file_manager(dir))
}

/// Open `dir` in an IDE (e.g. `code`, `zed`).
pub fn open_in_ide(ide_command: &str, dir: &str) -> Result<()> {
    ensure_dir(dir)?;
    spawn(&plan_ide(ide_command, dir)?)
}

/// Find executable files inside a project for the quick-run menu.
///
/// Fast path: scan common build output folders first (`target/*`,
/// `src-tauri/target/*`, `bin`, `dist`, etc). Then do a shallow recursive
/// project scan so Windows `.exe` files dropped in nested folders still appear
/// immediately, while noisy/generated folders are skipped. Results are
/// de-duplicated and capped by `limit`.
pub fn find_executables(project_dir: &str, limit: usize) -> Result<Vec<String>> {
    let root = ensure_dir(project_dir)?;
    let limit = limit.max(1);
    let mut found: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::<PathBuf>::new();

    let priority_dirs = [
        root.to_path_buf(),
        root.join("target").join("release"),
        root.join("target").join("debug"),
        root.join("src-tauri").join("target").join("release"),
        root.join("src-tauri").join("target").join("debug"),
        root.join("release"),
        root.join("debug"),
        root.join("build"),
        root.join("bin"),
        root.join("dist"),
        root.join("out"),
    ];

    for dir in priority_dirs {
        collect_executables(&dir, 0, &mut found, &mut seen, limit);
        if found.len() >= limit {
            break;
        }
    }

    // Fallback: catch app-specific output folders without crawling giant vendor
    // trees. Depth 5 reaches common paths such as
    // `packages/desktop/target/release/app.exe` but skips `node_modules`,
    // `.git`, cargo incremental/deps noise, caches and virtualenvs.
    if found.len() < limit {
        collect_executables_recursive(root, 5, &mut found, &mut seen, limit);
    }

    Ok(found
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

fn collect_executables(
    dir: &Path,
    depth: usize,
    found: &mut Vec<PathBuf>,
    seen: &mut std::collections::HashSet<PathBuf>,
    limit: usize,
) {
    if found.len() >= limit || !dir.is_dir() || should_skip_exe_dir(dir, depth) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    // Deterministic order: executable-looking filenames first, then alpha.
    paths.sort_by_key(|p| {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        (!has_executable_extension(p), name)
    });
    for path in paths {
        if found.len() >= limit {
            break;
        }
        if path.is_file() && is_executable(&path) {
            let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
            if seen.insert(canonical) {
                found.push(path);
            }
        }
    }
}

fn collect_executables_recursive(
    dir: &Path,
    depth_left: usize,
    found: &mut Vec<PathBuf>,
    seen: &mut std::collections::HashSet<PathBuf>,
    limit: usize,
) {
    if found.len() >= limit
        || depth_left == 0
        || !dir.is_dir()
        || should_skip_exe_dir(dir, depth_left)
    {
        return;
    }

    collect_executables(dir, depth_left, found, seen, limit);
    if found.len() >= limit {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !should_skip_exe_dir(p, depth_left))
        .collect();
    dirs.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });

    for child in dirs {
        if found.len() >= limit {
            break;
        }
        collect_executables_recursive(&child, depth_left - 1, found, seen, limit);
    }
}

fn should_skip_exe_dir(path: &Path, _depth_marker: usize) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".cache"
            | ".parcel-cache"
            | ".next"
            | ".turbo"
            | "incremental"
            | ".fingerprint"
            | "deps"
    )
}

fn has_executable_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("exe") | Some("bat") | Some("cmd") | Some("com") | Some("appimage")
    )
}

fn is_executable(path: &Path) -> bool {
    if has_executable_extension(path) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Run an executable that belongs to the given project directory, detached.
///
/// The executable must resolve to a path inside `project_dir` — running
/// arbitrary system binaries through this entry point is rejected.
pub fn run_executable(project_dir: &str, exe_path: &str) -> Result<()> {
    let root = ensure_dir(project_dir)?
        .canonicalize()
        .map_err(|e| Error::Launcher(format!("cannot resolve project dir: {e}")))?;
    let exe = Path::new(exe_path)
        .canonicalize()
        .map_err(|_| Error::Launcher(format!("executable not found: {exe_path}")))?;
    if !exe.starts_with(&root) {
        return Err(Error::Launcher(format!(
            "refusing to run executable outside the project directory: {}",
            exe.display()
        )));
    }
    if !exe.is_file() || !is_executable(&exe) {
        return Err(Error::Launcher(format!(
            "not an executable file: {}",
            exe.display()
        )));
    }
    let cwd = exe.parent().unwrap_or(&root).to_path_buf();
    let mut cmd = Command::new(&exe);
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
        .map_err(|e| Error::Launcher(format!("failed to start {}: {e}", exe.display())))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_plans_are_correct() {
        let plan = plan_external_terminal(ExternalTerminal::WindowsTerminal, "C:/dev");
        assert_eq!(plan.program, "wt.exe");
        assert_eq!(plan.args, vec!["-d", "C:/dev"]);

        let plan = plan_external_terminal(ExternalTerminal::MacTerminal, "/dev/proj");
        assert_eq!(plan.program, "open");
    }

    #[test]
    fn terminal_command_plans_use_correct_cwd_args() {
        let p = plan_terminal_command("wt.exe", "C:/dev");
        assert_eq!(p.args, vec!["-d", "C:/dev"]);
        let p = plan_terminal_command("alacritty", "/p");
        assert_eq!(p.args, vec!["--working-directory", "/p"]);
        let p = plan_terminal_command("ghostty", "/p");
        assert_eq!(p.args, vec!["--working-directory=/p"]);
        let p = plan_terminal_command("wezterm", "/p");
        assert_eq!(p.args, vec!["start", "--cwd", "/p"]);
        let p = plan_terminal_command("kitty", "/p");
        assert_eq!(p.args, vec!["--directory", "/p"]);
        let p = plan_terminal_command("konsole", "/p");
        assert_eq!(p.args, vec!["--workdir", "/p"]);
        // PowerShell goes through `cmd /c start` so it gets its own window.
        let p = plan_terminal_command("powershell.exe", "C:/dev");
        assert_eq!(p.program, "cmd.exe");
        assert_eq!(p.cwd.as_deref(), Some("C:/dev"));
        // Unknown emulators fall back to plain spawn in the directory.
        let p = plan_terminal_command("myterm", "/p");
        assert!(p.args.is_empty());
        assert_eq!(p.cwd.as_deref(), Some("/p"));
        // Absolute paths keep working (basename match).
        let p = plan_terminal_command("/usr/bin/alacritty", "/p");
        assert_eq!(p.args, vec!["--working-directory", "/p"]);
    }

    #[test]
    fn detect_terminals_does_not_panic() {
        // Environment-dependent; just ensure the probe runs.
        let _ = detect_terminals();
    }

    #[test]
    fn open_terminal_command_validates_input() {
        let dir = tempfile::tempdir().unwrap();
        let dir = dir.path().to_str().unwrap();
        assert_eq!(
            open_terminal_command("", dir).unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            open_terminal_command("luxor-no-such-term-xyz", dir)
                .unwrap_err()
                .kind(),
            "launcher"
        );
    }

    #[test]
    fn ide_plan_validates_command() {
        assert!(plan_ide("code", "/p").is_ok());
        assert_eq!(plan_ide("", "/p").unwrap_err().kind(), "invalid_input");
        assert_eq!(
            plan_ide("code --evil; rm -rf /", "/p").unwrap_err().kind(),
            "invalid_input"
        );
        // Absolute paths (possibly with spaces) are allowed.
        let abs = if cfg!(windows) {
            "C:\\Program Files\\Zed\\zed.exe"
        } else {
            "/opt/my tools/zed"
        };
        assert!(plan_ide(abs, "/p").is_ok());
    }

    #[test]
    fn missing_dir_rejected() {
        let err = open_file_manager("/definitely/not/here").unwrap_err();
        assert_eq!(err.kind(), "launcher");
    }

    #[test]
    fn find_executables_scans_known_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let found = find_executables(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with(if cfg!(windows) { "tool.exe" } else { "tool" }));
    }

    #[test]
    fn find_executables_finds_nested_windows_exes_but_skips_noise() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir
            .path()
            .join("apps")
            .join("desktop")
            .join("target")
            .join("release");
        std::fs::create_dir_all(&nested).unwrap();
        let exe = nested.join("Luxor.exe");
        std::fs::write(&exe, b"not a real exe for unit tests").unwrap();

        let noisy = dir.path().join("node_modules").join("bad");
        std::fs::create_dir_all(&noisy).unwrap();
        std::fs::write(noisy.join("ignore-me.exe"), b"").unwrap();

        let found = find_executables(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("Luxor.exe"));
    }

    #[test]
    fn detect_ides_returns_unique_labels() {
        let found = detect_ides();
        let mut labels: Vec<&str> = found.iter().map(|d| d.label.as_str()).collect();
        let before = labels.len();
        labels.dedup();
        assert_eq!(before, labels.len());
    }

    #[test]
    fn open_with_default_app_missing_path_is_not_found() {
        assert_eq!(
            open_with_default_app("/definitely/not/here")
                .unwrap_err()
                .kind(),
            "not_found"
        );
    }

    #[test]
    fn run_executable_refuses_outside_project() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let exe = other.path().join("evil");
        std::fs::write(&exe, b"").unwrap();
        let err = run_executable(dir.path().to_str().unwrap(), exe.to_str().unwrap()).unwrap_err();
        assert_eq!(err.kind(), "launcher");
    }

    #[test]
    fn unknown_program_fails_cleanly() {
        let plan = SpawnPlan {
            program: "luxor-no-such-program-xyz".into(),
            args: vec![],
            cwd: None,
        };
        assert_eq!(spawn(&plan).unwrap_err().kind(), "launcher");
    }

    #[test]
    fn known_ides_are_unique_and_include_new_editors() {
        let mut commands: Vec<&str> = KNOWN_IDES.iter().map(|(cmd, _)| *cmd).collect();
        let total = commands.len();
        commands.sort_unstable();
        commands.dedup();
        assert_eq!(commands.len(), total, "duplicate command in KNOWN_IDES");
        for cmd in [
            "trae",
            "antigravity",
            "kiro",
            "void",
            "sublime_text",
            "notepad++",
            "notepad.exe",
            "gnome-text-editor",
            "mousepad",
            "emacs",
        ] {
            assert!(commands.contains(&cmd), "missing IDE: {cmd}");
        }
        for (_, label) in KNOWN_IDES {
            assert!(!label.is_empty());
        }
    }
}
