//! Minimal, dependency-free OS login autostart support.
//!
//! Luxor stores the user's intent in `config.toml` (`ui.launch_on_startup`).
//! This module mirrors that intent to the native user-level startup location on
//! each platform. It intentionally avoids a long-running helper process.

// Only the macOS/Linux arms below build paths; on Windows the registry
// helpers work with strings, so the import would be dead there.
#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

use luxor_core::{Error, Result};

const APP_NAME: &str = "Luxor";

/// Make the OS login startup entry match `enabled`.
pub fn set_enabled(enabled: bool) -> Result<()> {
    if enabled {
        enable()
    } else {
        disable()
    }
}

#[cfg(target_os = "windows")]
fn enable() -> Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // CREATE_NO_WINDOW: never flash a console window when shelling out to
    // `reg.exe`. This is synced on *every* launch (see lib.rs setup), so
    // without it the user sees a black terminal flicker at startup.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let exe = std::env::current_exe()?;
    let value = quote_windows_arg(&exe.to_string_lossy());
    let status = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            APP_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &value,
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| Error::Config(format!("failed to update Windows startup registry: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Config(format!(
            "Windows startup registry update failed with status {status}"
        )))
    }
}

#[cfg(target_os = "windows")]
fn disable() -> Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // CREATE_NO_WINDOW: avoid the startup console flash (see `enable`).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let status = Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            APP_NAME,
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        // `reg delete` returns a non-zero status when the value is already
        // absent. Treat disable as idempotent; the desired state is achieved.
        Ok(_) => Ok(()),
        Err(e) => Err(Error::Config(format!(
            "failed to remove Windows startup registry entry: {e}"
        ))),
    }
}

#[cfg(target_os = "windows")]
fn quote_windows_arg(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\\\""))
}

#[cfg(target_os = "macos")]
fn enable() -> Result<()> {
    let plist = macos_plist_path()?;
    if let Some(parent) = plist.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let exe = std::env::current_exe()?;
    let exe = escape_xml(&exe.to_string_lossy());
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.luxor.app</string>
  <key>ProgramArguments</key>
  <array><string>{exe}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"#
    );
    std::fs::write(plist, xml)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn disable() -> Result<()> {
    let plist = macos_plist_path()?;
    match std::fs::remove_file(plist) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(target_os = "macos")]
fn macos_plist_path() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").ok_or_else(|| Error::Config("HOME is not set".into()))?;
    Ok(PathBuf::from(home).join("Library/LaunchAgents/com.luxor.app.plist"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn enable() -> Result<()> {
    let desktop = linux_desktop_path()?;
    if let Some(parent) = desktop.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let exe = std::env::current_exe()?;
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=Luxor\nExec={}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
        escape_desktop_exec(&exe.to_string_lossy())
    );
    std::fs::write(desktop, content)?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn disable() -> Result<()> {
    let desktop = linux_desktop_path()?;
    match std::fs::remove_file(desktop) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_desktop_path() -> Result<PathBuf> {
    let base = if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        PathBuf::from(xdg)
    } else {
        let home =
            std::env::var_os("HOME").ok_or_else(|| Error::Config("HOME is not set".into()))?;
        PathBuf::from(home).join(".config")
    };
    Ok(base.join("autostart/luxor.desktop"))
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn escape_desktop_exec(s: &str) -> String {
    if s.chars()
        .any(|c| c.is_whitespace() || matches!(c, '"' | '\\'))
    {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}
