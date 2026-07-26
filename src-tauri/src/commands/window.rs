//! Window lifecycle commands.
//!
//! The main window starts hidden (`visible: false` in `tauri.conf.json`) so the
//! user never sees an unstyled white flash; the frontend calls
//! [`window_ready`] once React has mounted and the theme is applied.

use luxor_core::Error;
use tauri::Manager;

use crate::state::AppState;

#[tauri::command]
pub fn window_ready(window: tauri::Window) -> Result<(), Error> {
    // Show the window that actually invoked us (the second app window calls
    // this too — revealing "main" instead left it permanently invisible).
    if let Some(me) = window.app_handle().get_webview_window(window.label()) {
        let _ = me.show();
        let _ = me.set_focus();
    }
    Ok(())
}

/// Open `url` in a dedicated native webview window — a lightweight built-in
/// browser (YouTube & co work here, unlike inside an iframe). The window is
/// fully independent: closing it frees all its resources.
///
/// MUST stay `async`: on Windows, building a webview window from a *sync*
/// command deadlocks the app (the command blocks the main thread that the
/// window creation needs — documented Tauri behavior). This deadlock is what
/// made the built-in browser appear completely broken in v0.6.5.
#[tauri::command(async)]
pub fn browser_open_window(app: tauri::AppHandle, url: String) -> Result<(), Error> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| Error::InvalidInput(format!("invalid url: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(Error::InvalidInput(format!(
            "refusing to open non-http url: {url}"
        )));
    }
    let title = parsed.host_str().unwrap_or("Browser").to_string();
    // Reuse a single persistent browser window: navigating it is much faster
    // than spawning a fresh webview for every link, and avoids window litter.
    if let Some(existing) = app.get_webview_window("luxor-browser") {
        if existing.navigate(parsed.clone()).is_ok() {
            let _ = existing.set_title(&format!("Luxor Browser — {title}"));
            let _ = existing.show();
            let _ = existing.unminimize();
            let _ = existing.set_focus();
            return Ok(());
        }
        // Navigation failed (window half-dead) — drop it and build a new one.
        let _ = existing.close();
    }
    tauri::WebviewWindowBuilder::new(&app, "luxor-browser", tauri::WebviewUrl::External(parsed))
        .title(format!("Luxor Browser — {title}"))
        .inner_size(1100.0, 750.0)
        .build()
        .map_err(|e| Error::InvalidInput(format!("failed to open browser window: {e}")))?;
    Ok(())
}

/// First free label of the `main-N` family (the second/third app window).
fn next_window_label(app: &tauri::AppHandle) -> String {
    for n in 2..32 {
        let label = format!("main-{n}");
        if app.get_webview_window(&label).is_none() {
            return label;
        }
    }
    "main-32".to_string()
}

/// Open another full Luxor window (shared by the IPC command and the tray
/// menu). Gated by `ui.allow_second_window`; by default only one window is
/// allowed.
pub fn open_new_window(app: &tauri::AppHandle) -> Result<(), Error> {
    let allowed = {
        let state = app.state::<AppState>();
        let cfg = state
            .config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        cfg.ui.allow_second_window
    };
    if !allowed {
        return Err(Error::InvalidInput(
            "Opening a second window is disabled. Enable it in Settings → Interface first.".into(),
        ));
    }
    let label = next_window_label(app);
    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Luxor")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .visible(false)
        .background_color(tauri::window::Color(0x10, 0x10, 0x14, 0xff))
        .build()
        .map_err(|e| Error::InvalidInput(format!("failed to open window: {e}")))?;
    Ok(())
}

/// IPC wrapper for [`open_new_window`].
/// Async for the same Windows deadlock reason as [`browser_open_window`].
#[tauri::command(async)]
pub fn window_open_new(app: tauri::AppHandle) -> Result<(), Error> {
    open_new_window(&app)
}

/// Quit the entire application (called from the tray popup's Quit button).
/// Performs the same cleanup as the tray menu quit: kill PTYs, stop
/// managed PTYs, remove the pid file, then exit.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) -> Result<(), Error> {
    crate::cleanup_before_exit(&app);
    app.exit(0);
    Ok(())
}

/// Resize the tray popup to fit its measured content and re-anchor it near the
/// last tray click. Called by the popup frontend once it knows the menu's real
/// height (which depends on the user's tray config and project count), so the
/// window matches the visible menu exactly — no transparent dead-zone that
/// would otherwise swallow "click outside to dismiss".
#[tauri::command(async)]
pub fn tray_popup_fit(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    width: f64,
    height: f64,
) -> Result<(), Error> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("tray-popup") {
        let w = width.clamp(200.0, 420.0);
        let h = height.clamp(80.0, 640.0);
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        let cursor = state.tray_cursor.lock().map(|g| *g).unwrap_or(None);
        if let Some(c) = cursor {
            crate::position_tray_popup(&win, c, w, h);
        }
    }
    Ok(())
}

/// Hide the tray popup when the cursor is outside its native window bounds.
/// This is the reliable cross-window counterpart to the frontend's DOM
/// pointerdown handler: clicks in other windows are not delivered to the popup
/// webview, but the backend can still compare the global cursor against the
/// popup rectangle shortly after the click/blur.
#[tauri::command(async)]
pub fn tray_popup_hide_if_cursor_outside(
    app: tauri::AppHandle,
    padding: Option<f64>,
) -> Result<bool, Error> {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("tray-popup") else {
        return Ok(false);
    };
    if !win.is_visible().unwrap_or(false) {
        return Ok(false);
    }
    // Right after the popup is shown the cursor is still at the tray icon —
    // which is *outside* the popup bounds (the menu is anchored above it).
    // The frontend's blur watchdog fires during the show/focus churn, so
    // without this grace the menu was hidden before it ever painted.
    if crate::tray_popup_in_grace(&app) {
        return Ok(false);
    }
    let pad = padding.unwrap_or(2.0).max(0.0);
    let pos = match win.outer_position() {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    let size = match win.outer_size() {
        Ok(s) => s,
        Err(_) => return Ok(false),
    };
    let cursor = match win.cursor_position() {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };
    let left = pos.x as f64 - pad;
    let top = pos.y as f64 - pad;
    let right = pos.x as f64 + size.width as f64 + pad;
    let bottom = pos.y as f64 + size.height as f64 + pad;
    let outside = cursor.x < left || cursor.x > right || cursor.y < top || cursor.y > bottom;
    if outside {
        let _ = win.hide();
        return Ok(true);
    }
    Ok(false)
}

/// A `(id, name)` project row for the tray "Projects" submenu.
#[derive(serde::Deserialize)]
pub struct TrayProject {
    pub id: String,
    pub name: String,
}

/// Update the recent-projects list shown in the tray menu. Called by the
/// frontend whenever the project list changes.
#[tauri::command(async)]
pub fn tray_set_projects(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    projects: Vec<TrayProject>,
) -> Result<(), Error> {
    {
        let mut guard = state
            .tray_projects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = projects.into_iter().map(|p| (p.id, p.name)).collect();
    }
    crate::refresh_tray_menu(&app);
    Ok(())
}
