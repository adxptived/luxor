//! OS-level idle / AFK detection (plan part 9.3 / 1.4).
//!
//! Reports how long since the last keyboard/mouse input **without** any
//! keylogging — only the elapsed-idle counter the OS already maintains:
//! - Windows: `GetLastInputInfo` + `GetTickCount`.
//! - macOS:  `CGEventSourceSecondsSinceLastEventType`.
//! - Linux:  no portable API → returns `None` (caller falls back to window
//!   focus). An X11/idle backend can be added later behind a feature.
//!
//! All platform code is best-effort and returns `Option`, so telemetry keeps
//! working (using window focus) wherever this is unavailable.

/// Idle threshold after which a session is considered paused (plan part 1.4).
pub const AFK_THRESHOLD_SECONDS: u64 = 5 * 60;

/// Seconds since the last user input, or `None` if unsupported on this OS.
pub fn idle_seconds() -> Option<u64> {
    imp::idle_seconds()
}

/// `Some(true)` if the user has been idle past `threshold`, `None` if the OS
/// idle counter is unavailable.
pub fn is_afk(threshold_seconds: u64) -> Option<bool> {
    idle_seconds().map(|s| s >= threshold_seconds)
}

#[cfg(windows)]
mod imp {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }
    extern "system" {
        fn GetTickCount() -> u32;
    }

    pub fn idle_seconds() -> Option<u64> {
        unsafe {
            let mut lii = LastInputInfo {
                cb_size: std::mem::size_of::<LastInputInfo>() as u32,
                dw_time: 0,
            };
            if GetLastInputInfo(&mut lii) == 0 {
                return None;
            }
            let now = GetTickCount();
            Some(u64::from(now.wrapping_sub(lii.dw_time)) / 1000)
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    // kCGEventSourceStateHIDSystemState = 1; kCGAnyInputEventType = ~0.
    const HID_SYSTEM_STATE: u32 = 1;
    const ANY_INPUT_EVENT: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: u32, event_type: u32) -> f64;
    }

    pub fn idle_seconds() -> Option<u64> {
        let secs = unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT) };
        if secs.is_finite() && secs >= 0.0 {
            Some(secs as u64)
        } else {
            None
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
    /// Linux has no portable syscall for idle time. Use the common `xprintidle`
    /// helper (returns milliseconds idle) when it is installed; otherwise give
    /// up gracefully so the caller falls back to window focus. This avoids
    /// linking X11/XScreenSaver at build time (not always present in CI).
    pub fn idle_seconds() -> Option<u64> {
        let out = std::process::Command::new("xprintidle").output().ok()?;
        if !out.status.success() {
            return None;
        }
        let ms: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
        Some(ms / 1000)
    }
}

#[cfg(not(any(windows, unix)))]
mod imp {
    pub fn idle_seconds() -> Option<u64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_is_optional_and_sane() {
        // We can't assert a value (depends on OS + headless CI), but the call
        // must not panic and any value returned is a plausible second count.
        if let Some(s) = idle_seconds() {
            assert!(s < 60 * 60 * 24 * 365);
        }
        // is_afk mirrors idle availability.
        assert_eq!(is_afk(AFK_THRESHOLD_SECONDS).is_some(), idle_seconds().is_some());
    }
}
