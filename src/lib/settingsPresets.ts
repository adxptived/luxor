/**
 * Built-in settings presets + shareable custom presets.
 *
 * Built-in presets are *partial* config patches: they change only the fields
 * that define the preset and keep everything else (hotkeys, paths, shells)
 * untouched. They are applied through the same type-checked merge as settings
 * import (`parseConfigImport`), so a preset can never poison the config.
 *
 * Custom presets (user profiles) can be shared as a compact `luxor://preset#…`
 * string that carries the name, description and config — recipients paste it
 * and get the preset saved into their own profile list.
 */

import type { AppConfig } from "./types";

export interface BuiltinPreset {
  id: string;
  name: string;
  description: string;
  /** Partial config patch — only known keys survive the merge. */
  patch: Record<string, unknown>;
}

/**
 * Curated quick-setup presets. Each patch only contains fields recognised by
 * the config merger; unknown keys would be dropped silently, so keep these in
 * sync with AppConfig.
 */
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: "focus",
    name: "Focus",
    description: "Hide distractions: no side panels, minimal status bar, notifications off.",
    patch: {
      notifications: { enabled: false, command_done: false, agent_done: false },
      status_bar: {
        show_cpu: false,
        show_ram: false,
        show_net: false,
        show_ping: false,
        show_tasks: false,
        show_agents: false,
      },
      ui: { side_panel_enabled: false, right_panel_enabled: false },
    },
  },
  {
    id: "presentation",
    name: "Presentation",
    description: "Large readable text for demos and screen sharing.",
    patch: {
      terminal: { font_size: 18 },
      ui: { ui_font_scale: 120, zoom: 1.15 },
    },
  },
  {
    id: "compact",
    name: "Compact",
    description: "Dense layout: smaller text, tighter chrome, everything visible.",
    patch: {
      terminal: { font_size: 12 },
      ui: { ui_font_scale: 90, zoom: 1, side_panel_enabled: true, right_panel_enabled: true },
    },
  },
  {
    id: "quiet-terminal",
    name: "Quiet terminal",
    description: "Terminal without bell, blink, or stats overlays.",
    patch: {
      terminal: { cursor_blink: false, bell_notifications: false, show_stats: false },
      notifications: { command_done: false },
    },
  },
];

// ---------------------------------------------------------------------------
// Shareable custom presets
// ---------------------------------------------------------------------------

const PRESET_SCHEME = "luxor://preset#";

export interface SharedPreset {
  name: string;
  description?: string;
  /** Full or partial config — merged type-safely on import. */
  config: Record<string, unknown>;
}

/** Encode a named preset into a compact URL-safe share string. */
export function encodePresetToUrl(name: string, config: AppConfig, description?: string): string {
  try {
    const payload: SharedPreset = { name, description, config: config as unknown as Record<string, unknown> };
    const json = JSON.stringify(payload);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${PRESET_SCHEME}${urlSafe}`;
  } catch {
    return "";
  }
}

/** Decode a shared preset string. Returns null for anything that isn't one. */
export function decodePresetFromUrl(url: string): SharedPreset | null {
  try {
    const trimmed = url.trim();
    if (!trimmed.startsWith(PRESET_SCHEME)) return null;
    const encoded = trimmed.slice(PRESET_SCHEME.length);
    if (!encoded || encoded.length > 512 * 1024) return null;
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as SharedPreset).name !== "string" ||
      !(parsed as SharedPreset).name.trim() ||
      typeof (parsed as SharedPreset).config !== "object" ||
      (parsed as SharedPreset).config === null
    ) {
      return null;
    }
    const preset = parsed as SharedPreset;
    return {
      name: preset.name.trim().slice(0, 80),
      description: typeof preset.description === "string" ? preset.description.slice(0, 200) : undefined,
      config: preset.config,
    };
  } catch {
    return null;
  }
}
