/**
 * Lightweight, synchronous platform detection for the webview.
 *
 * The app ships a custom titlebar, so we can't rely on native decorations to
 * know where window controls belong. This reads the user-agent (works both in
 * the Tauri webview and the browser mock) so UI like the Settings nav preview
 * can render macOS traffic lights on the left vs. Windows-style controls on the
 * right without an async round-trip to the OS plugin.
 */

export type Platform = "macos" | "windows" | "linux";

/** Detect the host OS from the user agent. Falls back to "linux". */
export function detectPlatform(): Platform {
  if (typeof navigator !== "undefined") {
    // `userAgentData.platform` is the modern, spoofing-resistant source when
    // present (Chromium ≥ 90, which the Tauri webview uses on Win/Linux).
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const hint = (uaData?.platform ?? "").toLowerCase();
    if (hint) {
      if (hint.includes("mac")) return "macos";
      if (hint.includes("win")) return "windows";
      if (hint.includes("linux") || hint.includes("android")) return "linux";
    }
    const ua = navigator.userAgent ?? "";
    if (/mac|iphone|ipad|ipod/i.test(ua)) return "macos";
    if (/win/i.test(ua)) return "windows";
  }
  return "linux";
}

/** Memoized platform — the host OS never changes during a session. */
export const PLATFORM: Platform = detectPlatform();

export const isMac = PLATFORM === "macos";
export const isWindows = PLATFORM === "windows";
export const isLinux = PLATFORM === "linux";
