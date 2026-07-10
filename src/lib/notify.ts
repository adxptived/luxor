/**
 * Completion notifications: in-app toast always, plus an OS-native
 * notification (Windows toast / macOS banner) when the window is hidden or
 * unfocused — that is exactly when the user can't see the in-app toast.
 *
 * Gated by `config.notifications`; OS notifications go through
 * `@tauri-apps/plugin-notification` under Tauri (WebView2 has no
 * `window.Notification`), with the Web Notification API as a browser fallback.
 */

import type { NotificationsConfig } from "./types";

import { isTauri } from "./ipc";
import { useAppStore } from "@/state/appStore";

/** Pure decision: should this event produce an OS-native notification? */
export function shouldNotifyOs(
  cfg: NotificationsConfig | undefined,
  windowFocused: boolean,
  documentHidden: boolean,
): boolean {
  if (!cfg || !cfg.enabled || !cfg.os_native) return false;
  // The user is already looking at the app — a toast is enough.
  return documentHidden || !windowFocused;
}

let osNotifyPermission: boolean | null = null;

async function sendOsNotification(title: string, body: string): Promise<void> {
  if (isTauri) {
    const plugin = await import("@tauri-apps/plugin-notification");
    if (osNotifyPermission === null) {
      let granted = await plugin.isPermissionGranted();
      if (!granted) granted = (await plugin.requestPermission()) === "granted";
      osNotifyPermission = granted;
    }
    if (osNotifyPermission) plugin.sendNotification({ title, body });
    return;
  }
  // Browser dev mode fallback.
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body });
}

/**
 * OS-only notification when the user is away from the window (no toast) —
 * used where an in-app toast is already shown by other code (terminal bell).
 */
export function osNotifyIfAway(title: string, body: string): void {
  const cfg = useAppStore.getState().config?.notifications;
  if (shouldNotifyOs(cfg, document.hasFocus(), document.hidden)) {
    void sendOsNotification(title, body).catch(() => {});
  }
}

/**
 * Notify about a finished command / agent response: toast + OS notification
 * when appropriate. Never throws.
 */
export function notifyDone(title: string, body: string): void {
  const cfg = useAppStore.getState().config?.notifications;
  if (!cfg?.enabled) return;
  useAppStore.getState().toast(body ? `${title} — ${body}` : title, "info");
  if (shouldNotifyOs(cfg, document.hasFocus(), document.hidden)) {
    void sendOsNotification(title, body).catch(() => {
      // OS notifications are best-effort.
    });
  }
}
