import { create } from "zustand";

import { logActivity } from "@/lib/activityLog";
import { registerMigration } from "@/lib/stateMigration";
import { hintFor } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";

import * as ipc from "@/lib/ipc";
import { onColor, resolveTheme, themeMeta } from "@/lib/themes";
import { crossfadeTheme } from "@/lib/themeCrossfade";
import { applyZoomFactor, clampZoom } from "@/lib/zoom";
import type { AppConfig } from "@/lib/types";
import { errorMessage } from "@/lib/types";

// Phase 23: Register state migration for the app config.
// Version 1: initial versioned state (no migration needed yet, but the
// infrastructure is in place for future schema changes).
registerMigration<AppConfig>("luxor.appConfig", 1, {});

export type ToastKind = "info" | "success" | "warning" | "error";

interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  /** Toasts with the same key replace each other (e.g. zoom level). */
  key?: string;
  /** Auto-dismiss delay, retained so hover-pause can re-arm the timer. */
  ttl: number;
  /** Exit phase: the toast is animating out and will be removed shortly. */
  leaving?: boolean;
}

/** How long the toast exit animation runs before the element is removed. */
const TOAST_LEAVE_MS = 200;

interface AppStore {
  config: AppConfig | null;
  toasts: ToastMessage[];
  /** Zen mode hides the top bar and status bar for distraction-free work. */
  zenMode: boolean;
  toggleZen: () => void;
  paletteOpen: boolean;
  settingsOpen: boolean;
  /** Section the settings modal should open at (deep link). */
  settingsSection: string | null;
  switcherOpen: boolean;

  init: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
  toast: (text: string, kind?: ToastKind, key?: string) => void;
  dismissToast: (id: number) => void;
  /** Freeze all auto-dismiss timers (while the pointer is over the stack). */
  pauseToasts: () => void;
  /** Re-arm auto-dismiss timers after the pointer leaves the stack. */
  resumeToasts: () => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, section?: string) => void;
  setSwitcherOpen: (open: boolean) => void;
  /** Apply + persist (debounced) a new zoom factor. */
  setZoom: (factor: number) => void;
}

let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  config: null,
  toasts: [],
  zenMode: false,
  toggleZen: () => {
    const entering = !get().zenMode;
    set({ zenMode: entering });
    // Zen hides the top bar and status bar, so the only way back is the
    // shortcut. Surfacing it on entry stops the "my UI vanished" panic
    // (P2SH-03). Hint reflects the live (possibly remapped) binding.
    if (entering) {
      const chord = hintFor("zen.toggle", get().config);
      get().toast(
        chord
          ? `${t("Zen mode on —")} ${chord} ${t("to exit")}`
          : t("Zen mode on — use the command palette to exit"),
        "info",
      );
    }
  },
  paletteOpen: false,
  settingsOpen: false,
  settingsSection: null,
  switcherOpen: false,

  init: async () => {
    try {
      const config = await ipc.configGet();
      set({ config });
      applyAppearance(config);
      void applyZoomFactor(config.ui.zoom ?? 1);
    } catch (e) {
      get().toast(`Failed to load config: ${errorMessage(e)}`, "error");
    }
  },

  saveConfig: async (config) => {
    try {
      const prevZoom = get().config?.ui.zoom;
      await ipc.configSet(config);
      set({ config });
      applyAppearance(config);
      if (config.ui.zoom !== prevZoom) void applyZoomFactor(config.ui.zoom);
    } catch (e) {
      get().toast(`Failed to save settings: ${errorMessage(e)}`, "error");
    }
  },

  toast: (text, kind = "info", key) => {
    // Everything worth telling the user is also worth remembering.
    logActivity(kind === "warning" ? "info" : kind, text);
    const ttl = kind === "error" ? 8000 : key ? 1600 : 4000;
    // A repeating identical message (error loops, spammy listeners) refreshes
    // the existing toast instead of stacking an endless column.
    if (!key) {
      const dup = get().toasts.find((t) => t.text === text && t.kind === kind);
      if (dup) {
        // A re-fired toast that was mid-exit snaps back to fully visible.
        if (dup.leaving) {
          set((s) => ({ toasts: s.toasts.map((t) => (t.id === dup.id ? { ...t, leaving: false } : t)) }));
        }
        const timer = toastTimers.get(dup.id);
        if (timer) clearTimeout(timer);
        toastTimers.set(
          dup.id,
          setTimeout(() => get().dismissToast(dup.id), ttl),
        );
        return;
      }
    }
    if (key) {
      const existing = get().toasts.find((t) => t.key === key);
      if (existing) {
        set((s) => ({
          toasts: s.toasts.map((t) => (t.key === key ? { ...t, text, kind, leaving: false } : t)),
        }));
        const timer = toastTimers.get(existing.id);
        if (timer) clearTimeout(timer);
        toastTimers.set(
          existing.id,
          setTimeout(() => get().dismissToast(existing.id), ttl),
        );
        return;
      }
    }
    const id = ++toastSeq;
    set((s) => {
      // Hard cap the stack (SH-05): drop the oldest so a burst of events can't
      // grow an endless column. The Overlays layer renders the newest 5 and a
      // "+N more" chip for anything beyond that.
      const MAX = 8;
      const next = [...s.toasts, { id, kind, text, key, ttl }];
      if (next.length > MAX) {
        for (const stale of next.slice(0, next.length - MAX)) {
          const timer = toastTimers.get(stale.id);
          if (timer) clearTimeout(timer);
          toastTimers.delete(stale.id);
        }
        return { toasts: next.slice(next.length - MAX) };
      }
      return { toasts: next };
    });
    toastTimers.set(
      id,
      setTimeout(() => get().dismissToast(id), ttl),
    );
  },

  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.delete(id);
    const target = get().toasts.find((t) => t.id === id);
    if (!target) return;
    // Two-phase removal: mark the toast as leaving so the UI can play its
    // exit animation, then actually drop it once the animation has finished.
    if (target.leaving) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      return;
    }
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    toastTimers.set(
      id,
      setTimeout(() => get().dismissToast(id), TOAST_LEAVE_MS),
    );
  },

  pauseToasts: () => {
    // Freeze every pending auto-dismiss so users can read/hover a toast.
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
  },

  resumeToasts: () => {
    // Re-arm from each toast's stored ttl. Errors keep their longer dwell.
    // Leaving toasts finish their short exit instead of restarting the ttl.
    for (const t of get().toasts) {
      if (toastTimers.has(t.id)) continue;
      toastTimers.set(
        t.id,
        setTimeout(() => get().dismissToast(t.id), t.leaving ? TOAST_LEAVE_MS : t.ttl),
      );
    }
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen, section) =>
    set({ settingsOpen, settingsSection: settingsOpen ? (section ?? null) : null }),
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),

  setZoom: (factor) => {
    const config = get().config;
    if (!config) return;
    const zoom = clampZoom(factor);
    const next = { ...config, ui: { ...config.ui, zoom } };
    set({ config: next });
    void applyZoomFactor(zoom);
    get().toast(`Zoom ${Math.round(zoom * 100)}%`, "info", "zoom");
    // Persist after the user stops zooming (wheel events come in bursts).
    if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
    zoomSaveTimer = setTimeout(() => {
      const cfg = get().config;
      if (cfg) void ipc.configSet(cfg).catch(() => {});
    }, 600);
  },
}));

export function applyTheme(theme: AppConfig["theme"]) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  const prev = root.dataset.theme;
  // Phase 9: smooth crossfade between themes (skipped on reduced-motion).
  if (prev && prev !== resolved) {
    crossfadeTheme(prev, resolved, 300);
  } else {
    root.dataset.theme = resolved;
  }
}

/** Apply theme + accent color. An invalid accent falls back to the theme default. */
/**
 * Read a CSS custom property off `el` and normalize it to a 6-digit hex.
 * Custom properties are returned as-authored, so theme tokens like
 * `--lx-danger: #f7768e` come back as hex directly; we also parse `rgb()`
 * just in case. Returns null when the value can't be interpreted.
 */
function readComputedHex(el: HTMLElement, prop: string): string | null {
  const raw = getComputedStyle(el).getPropertyValue(prop).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const m = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0"))
        .join("")
    );
  }
  return null;
}

export function applyAppearance(config: AppConfig) {
  applyTheme(config.theme);
  const root = document.documentElement;
  const accent = (config.accent_color?.trim() ?? "").toLowerCase();
  const themeDefault = themeMeta(resolveTheme(config.theme)).accent.toLowerCase();
  // Apply any valid hex that differs from THIS theme's default. (The old check
  // also skipped the global default #e8b059, so choosing that gold accent on a
  // non-gold theme like Tokyo Night silently did nothing — fixed.)
  if (/^#[0-9a-f]{6}$/.test(accent) && accent !== themeDefault) {
    root.style.setProperty("--lx-accent", accent);
  } else {
    // Matches the theme default (or invalid) — let the per-theme CSS value win.
    root.style.removeProperty("--lx-accent");
  }

  // Keep text/icons placed on the accent fill legible across every theme AND
  // any custom accent. Computed from the *effective* accent (custom when valid,
  // else this theme's default) so `text-on-accent` always has enough contrast.
  const effectiveAccent = /^#[0-9a-f]{6}$/.test(accent) ? accent : themeDefault;
  root.style.setProperty("--lx-on-accent", onColor(effectiveAccent));

  // Same treatment for the danger fill: light danger palettes (e.g. Tokyo
  // Night #f7768e, Rosé Pine #eb6f92) made the hard-coded white label on
  // danger buttons ~2.6:1. --lx-danger lives in per-theme CSS, so read its
  // computed value (after applyTheme above) and derive a legible foreground.
  const dangerHex = readComputedHex(root, "--lx-danger");
  if (dangerHex) root.style.setProperty("--lx-on-danger", onColor(dangerHex));
  else root.style.removeProperty("--lx-on-danger");

  // Custom fonts and UI text scale (Settings → Appearance). Empty/default
  // values remove the override so the CSS defaults take over.
  const ui = config.ui;
  const uiFont = ui?.ui_font?.trim();
  if (uiFont) root.style.setProperty("--lx-font-ui", uiFont);
  else root.style.removeProperty("--lx-font-ui");

  const monoFont = ui?.mono_font?.trim();
  if (monoFont) root.style.setProperty("--lx-font-mono", monoFont);
  else root.style.removeProperty("--lx-font-mono");

  const scale = Math.min(130, Math.max(80, ui?.ui_font_scale ?? 100));
  root.style.fontSize = scale === 100 ? "" : `${((16 * scale) / 100).toFixed(2)}px`;

  const tabRadius = Math.min(18, Math.max(0, Math.round(ui?.tab_radius ?? 7)));
  root.style.setProperty("--lx-tab-radius", `${tabRadius}px`);

  // Active-tab outline: off = selection by background colour only (default),
  // on = visible border + soft lift. Toggled in Settings → Interface.
  root.dataset.tabOutline = ui?.tab_outline ? "on" : "off";

  // Glass mode (Settings → Appearance): semi-transparent UI surfaces with
  // backdrop blur. The CSS keys off `data-glass="on"` and reads the strength
  // from `--lx-glass-alpha` (surface opacity, derived from the 0–60% slider).
  // Default ON — matches the app's original translucent look.
  const glassOn = ui?.glass_enabled ?? true;
  root.dataset.glass = glassOn ? "on" : "off";
  if (glassOn) {
    const strength = Math.min(60, Math.max(0, ui?.glass_opacity ?? 20));
    root.style.setProperty("--lx-glass-alpha", `${100 - strength}%`);
  } else {
    root.style.removeProperty("--lx-glass-alpha");
  }
}

