/**
 * App-wide zoom (Ctrl +/-, Ctrl+0, Ctrl+wheel). Uses the native webview zoom
 * under Tauri and falls back to CSS zoom in the browser. The factor is
 * persisted in `config.ui.zoom`.
 */

import { isTauri } from "./ipc";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

/** Clamp + round a zoom factor to a sane, stable value. */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  return Math.round(clamped * 100) / 100;
}

export function zoomIn(factor: number): number {
  return clampZoom(factor + ZOOM_STEP);
}

export function zoomOut(factor: number): number {
  return clampZoom(factor - ZOOM_STEP);
}

/** Apply a zoom factor to the window (idempotent, never throws). */
export async function applyZoomFactor(factor: number): Promise<void> {
  const z = clampZoom(factor);
  if (isTauri) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(z);
      return;
    } catch {
      // setZoom unsupported on this platform — fall through to CSS zoom.
    }
  }
  try {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom =
      z === 1 ? "" : String(z);
  } catch {
    // Zoom is best-effort.
  }
}
