//! Embedded web browser backed by a **real native child webview**.
//!
//! The previous built-in browser used an `<iframe>`, which is bound by the web
//! platform's framing rules: any site that sends `X-Frame-Options: deny` or a
//! `Content-Security-Policy: frame-ancestors` header (Google, YouTube, GitHub,
//! X, Reddit, most of the modern web) simply refuses to render and the user
//! sees a dead "refused to connect" page. An iframe *cannot* override that — it
//! is a browser security rule, not a Luxor bug.
//!
//! The fix is to stop framing entirely. A child webview created with
//! [`tauri::window::Window::add_child`] loads the page as a **top-level
//! document**, exactly like a normal browser tab, so X-Frame-Options /
//! frame-ancestors never apply and every site loads. The webview is overlaid on
//! top of the `BrowserPanel`'s viewport rectangle (Electron-`BrowserView`
//! style); the frontend streams the panel's on-screen rectangle to
//! [`browser_embed_set_bounds`] every animation frame so it tracks resizes,
//! sidebar animations, docking and window moves pixel-for-pixel.
//!
//! The child webview gets **no** Tauri capabilities (its label does not match
//! any capability window filter), so remote web content can never reach the IPC
//! bridge — it is sandboxed to plain web APIs.
//!
//! Requires the `unstable` Cargo feature on `tauri` (multi-webview API).

use luxor_core::Error;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Stable label of the single embedded browser webview.
const EMBED_LABEL: &str = "luxor-embed";
/// Event the frontend listens on for navigation / load-state updates.
const NAV_EVENT: &str = "browser://nav";

/// Payload pushed to the frontend whenever the embedded page navigates or
/// changes load state, so the address bar + spinner stay in sync with reality
/// (clicks inside the page, redirects, `history.back()`, etc).
#[derive(Clone, serde::Serialize)]
struct NavPayload {
    url: String,
    /// `true` while a page is loading, `false` once it finished.
    loading: bool,
}

/// Validate + parse an http(s) URL, rejecting everything else (file://, etc).
fn parse_http_url(url: &str) -> Result<tauri::Url, Error> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| Error::InvalidInput(format!("invalid url: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(Error::InvalidInput(format!(
            "refusing to open non-http url: {url}"
        )));
    }
    Ok(parsed)
}

/// Create (if needed), position, navigate and show the embedded browser webview.
///
/// `x`/`y`/`width`/`height` are CSS pixels relative to the window's content area
/// (i.e. `getBoundingClientRect()` of the panel viewport). `url` is loaded only
/// when the webview is first created or when it differs from the current page,
/// so repeated calls from the bounds-tracking loop are cheap no-ops.
///
/// MUST stay `async`: building a webview from a *sync* command deadlocks on
/// Windows (the command blocks the main thread the webview creation needs).
#[tauri::command(async)]
pub fn browser_embed_show(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: Option<String>,
) -> Result<(), Error> {
    // Clamp to sane minimums — a zero/negative size makes the platform webview
    // misbehave; the frontend hides instead of showing a degenerate rect.
    let w = width.max(1.0);
    let h = height.max(1.0);

    if let Some(view) = window.get_webview(EMBED_LABEL) {
        // Already exists: just reposition + show, and navigate if a new URL was
        // requested (cheap-skip when it matches the current page).
        let _ = view.set_position(LogicalPosition::new(x, y));
        let _ = view.set_size(LogicalSize::new(w, h));
        if let Some(target) = url {
            let parsed = parse_http_url(&target)?;
            let current = view.url().ok();
            if current.as_ref() != Some(&parsed) {
                view.navigate(parsed)
                    .map_err(|e| Error::InvalidInput(format!("navigate failed: {e}")))?;
            }
        }
        let _ = view.show();
        return Ok(());
    }

    // First creation: a URL is required so the webview has something to load.
    let target = url.ok_or_else(|| Error::InvalidInput("missing url for new embed".into()))?;
    let parsed = parse_http_url(&target)?;

    // No `auto_resize()`: the frontend streams exact bounds every animation
    // frame, so letting the platform also auto-scale the webview would fight it.
    let builder = tauri::webview::WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(parsed))
        .on_page_load(move |view, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let _ = view.app_handle().emit(
                NAV_EVENT,
                NavPayload {
                    url: payload.url().to_string(),
                    loading,
                },
            );
        });

    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| Error::InvalidInput(format!("failed to create embedded browser: {e}")))?;
    Ok(())
}

/// Cheap reposition/resize for the bounds-tracking animation loop. Silently
/// succeeds when the webview does not exist yet (race with first show).
#[tauri::command(async)]
pub fn browser_embed_set_bounds(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), Error> {
    if let Some(view) = window.get_webview(EMBED_LABEL) {
        let _ = view.set_position(LogicalPosition::new(x, y));
        let _ = view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)));
    }
    Ok(())
}

/// Navigate the embedded browser to a new URL (address-bar / quick-link / link).
#[tauri::command(async)]
pub fn browser_embed_navigate(window: tauri::Window, url: String) -> Result<(), Error> {
    let parsed = parse_http_url(&url)?;
    let view = window
        .get_webview(EMBED_LABEL)
        .ok_or_else(|| Error::InvalidInput("embedded browser not open".into()))?;
    view.navigate(parsed)
        .map_err(|e| Error::InvalidInput(format!("navigate failed: {e}")))
}

/// Back / forward / reload via the webview's real, native session history.
#[tauri::command(async)]
pub fn browser_embed_back(window: tauri::Window) -> Result<(), Error> {
    embed_eval(&window, "history.back()")
}

#[tauri::command(async)]
pub fn browser_embed_forward(window: tauri::Window) -> Result<(), Error> {
    embed_eval(&window, "history.forward()")
}

#[tauri::command(async)]
pub fn browser_embed_reload(window: tauri::Window) -> Result<(), Error> {
    embed_eval(&window, "location.reload()")
}

fn embed_eval(window: &tauri::Window, js: &str) -> Result<(), Error> {
    if let Some(view) = window.get_webview(EMBED_LABEL) {
        view.eval(js)
            .map_err(|e| Error::InvalidInput(format!("eval failed: {e}")))?;
    }
    Ok(())
}

/// Hide the embedded webview without destroying it (overlay open, panel on an
/// inactive tab, etc) — re-showing keeps the page + scroll position.
#[tauri::command(async)]
pub fn browser_embed_hide(window: tauri::Window) -> Result<(), Error> {
    if let Some(view) = window.get_webview(EMBED_LABEL) {
        let _ = view.hide();
    }
    Ok(())
}

/// Fully tear the embedded webview down (panel closed / app shutting the tab).
#[tauri::command(async)]
pub fn browser_embed_close(window: tauri::Window) -> Result<(), Error> {
    if let Some(view) = window.get_webview(EMBED_LABEL) {
        let _ = view.close();
    }
    Ok(())
}
