//! Foreground (active) window detection (plan part 1.1 / 9.2).
//!
//! Returns the title (or front-app name) of the currently focused window so
//! telemetry can tell whether an AI tool is actually in focus — a minimised
//! Cursor must not count as active time. Best-effort and `Option`-typed:
//! - Windows: `GetForegroundWindow` + `GetWindowTextW`.
//! - macOS:  `osascript` (System Events front process name).
//! - Linux:  `xdotool getactivewindow getwindowname` when installed.
//!
//! No screen scraping or input hooking — only the window title the OS exposes.

/// Title (Windows/Linux) or front-app name (macOS) of the focused window.
pub fn foreground_title() -> Option<String> {
    imp::foreground_title()
}

/// Map a foreground window title to a canonical AI-tool name (plan part 9.1),
/// so an AI agent in focus can be credited even when its CPU is briefly idle.
pub fn ai_agent_from_title(title: &str) -> Option<&'static str> {
    let t = title.to_ascii_lowercase();
    const HINTS: &[(&str, &str)] = &[
        ("cursor", "Cursor"),
        ("claude", "Claude Code"),
        ("copilot", "Copilot"),
        ("windsurf", "Windsurf"),
        ("aider", "Aider"),
        ("zed", "Zed"),
        ("trae", "Trae"),
    ];
    HINTS.iter().find(|(k, _)| t.contains(k)).map(|(_, v)| *v)
}

#[cfg(windows)]
mod imp {
    use std::os::raw::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowTextW(h_wnd: *mut c_void, lp_string: *mut u16, n_max_count: i32) -> i32;
    }

    pub fn foreground_title() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    pub fn foreground_title() -> Option<String> {
        let out = std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to get name of first application process whose frontmost is true",
            ])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then_some(s)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
    pub fn foreground_title() -> Option<String> {
        let out = std::process::Command::new("xdotool")
            .args(["getactivewindow", "getwindowname"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then_some(s)
    }
}

#[cfg(not(any(windows, unix)))]
mod imp {
    pub fn foreground_title() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_call_is_safe() {
        // Must not panic regardless of platform / headless CI.
        let _ = foreground_title();
    }

    #[test]
    fn ai_agent_matching() {
        assert_eq!(ai_agent_from_title("project — Cursor"), Some("Cursor"));
        assert_eq!(ai_agent_from_title("Claude Code"), Some("Claude Code"));
        assert_eq!(ai_agent_from_title("Firefox"), None);
    }
}
