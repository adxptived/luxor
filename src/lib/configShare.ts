/**
 * Export / import of the whole app config as a shareable JSON file.
 *
 * Export wraps the config in an envelope with a marker + version so import
 * can validate the file. Import deep-merges only *known* keys over the
 * current config — unknown junk is dropped and missing keys keep their
 * current values, so files from older/newer Luxor versions stay safe.
 */

import type { AppConfig } from "./types";

const MARKER = "luxor-settings";

export interface ConfigEnvelope {
  kind: typeof MARKER;
  /** App version that produced the export (informational). */
  app_version: string;
  exported_at: string;
  config: AppConfig;
}

/** Pretty JSON for a settings export file. */
export function serializeConfig(config: AppConfig, appVersion: string): string {
  const envelope: ConfigEnvelope = {
    kind: MARKER,
    app_version: appVersion,
    exported_at: new Date().toISOString(),
    config,
  };
  return JSON.stringify(envelope, null, 2);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown[]): boolean {
  return v.every((item) => typeof item === "string");
}

function isHotkeyArray(v: unknown[]): boolean {
  return v.every(
    (item) => isPlainObject(item) && typeof item.action === "string" && typeof item.chord === "string",
  );
}

function isIdeArray(v: unknown[]): boolean {
  return v.every(
    (item) => isPlainObject(item) && typeof item.label === "string" && typeof item.command === "string",
  );
}

function configKey(path: string[]): string {
  return path.join(".");
}

function isNullableStringKey(path: string[]): boolean {
  return configKey(path) === "terminal.shell" || configKey(path) === "terminal.external_terminal" || configKey(path) === "default_ide";
}

function arrayTypeMatches(path: string[], base: unknown[], incoming: unknown[]): boolean {
  const key = configKey(path);
  if (
    key === "terminal.shell_args" ||
    key === "preferred_editors" ||
    key === "ui.chrome_actions" ||
    key === "ui.nav_order" ||
    key === "ui.nav_hidden" ||
    key === "ui.nav_sidebar" ||
    key === "ui.nav_chrome" ||
    key === "ui.nav_topbar_left" ||
    key === "ui.nav_topbar_center" ||
    key === "ui.side_panel_widgets" ||
    key === "ui.right_panel_widgets" ||
    key === "ui.plus_menu_hidden" ||
    key === "status_bar.segment_order"
  ) {
    return isStringArray(incoming);
  }
  if (key === "hotkeys") return isHotkeyArray(incoming);
  if (key === "custom_ides") return isIdeArray(incoming);

  const sample = base.find((item) => item !== null && item !== undefined);
  if (sample === undefined) return true;
  if (isPlainObject(sample)) return incoming.every(isPlainObject);
  return incoming.every((item) => typeof item === typeof sample);
}

/** Recursively copy keys that exist in `base` from `incoming` (type-checked). */
function mergeKnown<T>(base: T, incoming: unknown, path: string[] = []): T {
  if (!isPlainObject(base) || !isPlainObject(incoming)) {
    // Leaf: accept the incoming value only when the primitive type matches.
    // Arrays replace arrays, but only when the incoming item shape matches the
    // known config field. This keeps old/shared configs from poisoning runtime
    // fields like terminal.shell_args with non-string values.
    if (Array.isArray(base)) {
      if (!Array.isArray(incoming)) return base;
      return arrayTypeMatches(path, base, incoming) ? (incoming as T) : base;
    }
    if (incoming === undefined) return base;
    if (base === null) {
      if (incoming === null) return incoming as T;
      return isNullableStringKey(path) && typeof incoming === "string" ? (incoming as T) : base;
    }
    if (incoming === null) return isNullableStringKey(path) ? (incoming as T) : base;
    return (typeof incoming === typeof base ? incoming : base) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base)) {
    if (key in incoming) out[key] = mergeKnown(base[key], incoming[key], [...path, key]);
  }
  return out as T;
}

/**
 * Parse an exported settings file and merge it over `current`.
 * Throws with a human-readable message when the file is not a Luxor export.
 */
export function parseConfigImport(text: string, current: AppConfig): AppConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  if (!isPlainObject(data)) throw new Error("Not a Luxor settings file");
  // Accept both the envelope and a bare config object (hand-edited files).
  const cfg = data.kind === MARKER ? data.config : data;
  // Accept any plain object containing at least one recognised Luxor config key.
  // Requiring "theme" is too strict — partial exports (e.g. only terminal
  // settings) are valid and mergeKnown will safely ignore unknown keys.
  const KNOWN_LUXOR_KEYS = [
    "theme",
    "tab_bar_position",
    "accent_color",
    "confirm_destructive",
    "terminal",
    "git",
    "notifications",
    "status_bar",
    "hotkeys",
    "preferred_editors",
    "custom_ides",
    "default_ide",
    "ui",
  ];
  if (!isPlainObject(cfg) || !KNOWN_LUXOR_KEYS.some((k) => k in cfg)) {
    throw new Error("Not a Luxor settings file");
  }
  return mergeKnown(current, cfg);
}
