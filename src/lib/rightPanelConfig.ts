/**
 * Rich right-sidebar customization model (order, per-widget enabled/accent/
 * options, panel-wide accent, density). Persisted as a JSON blob in
 * `config.ui.right_panel_config`; the legacy `ui.right_panel_widgets` string
 * list is kept in sync as a mirror so config sharing and older builds keep
 * working. Pure functions only — unit-tested in `rightPanelConfig.test.ts`.
 */

/** All widget ids the right panel can show, in the default order. */
export const RIGHT_WIDGET_IDS = [
  "project",
  "git",
  "tasks",
  "launch",
  "favorites",
  "notes",
  "clock",
  "timer",
  "system",
  "agents",
  "recents",
  "embed",
] as const;

export type RightWidgetId = (typeof RIGHT_WIDGET_IDS)[number];

/** Per-widget tweakable options. Every field is optional — absent means the
 *  widget default. Unknown keys from older/newer builds are preserved. */
export interface RightWidgetOptions {
  /** clock: 12-hour format (default false = 24h locale). */
  hour12?: boolean;
  /** clock: show seconds (default true). */
  show_seconds?: boolean;
  /** clock: show the date line (default true). */
  show_date?: boolean;
  /** tasks / recents / favorites / agents: max visible rows. */
  max_items?: number;
  /** timer: preset lengths in minutes (max 4 kept). */
  presets?: number[];
  /** notes: textarea height in px. */
  height?: number;
  /** system: hide the CPU / RAM rows individually. */
  show_cpu?: boolean;
  show_ram?: boolean;
  /** git: show the ahead/behind + changes counters line. */
  show_counts?: boolean;
  [key: string]: unknown;
}

export interface RightWidgetConfig {
  id: RightWidgetId;
  enabled: boolean;
  /** Widget accent color (hex) or null = panel/app accent. */
  accent: string | null;
  options: RightWidgetOptions;
}

/** Panel font size presets: "sm" is the classic default. */
export type RightPanelFontSize = "xs" | "sm" | "md";

export interface RightPanelConfig {
  /** Order = display order; contains ALL known widgets (enabled or not). */
  widgets: RightWidgetConfig[];
  /** Panel-wide accent (hex) or null = the app accent color. */
  accent: string | null;
  density: "comfortable" | "compact";
  /** Show the small uppercase title above each widget (default true). */
  show_titles: boolean;
  /** Draw separator lines between widgets (default true). */
  dividers: boolean;
  /** Panel font size (default "sm" = the classic size). */
  font_size: RightPanelFontSize;
}

/** Widgets enabled on a fresh install (mirrors the old DEFAULT_RIGHT_WIDGETS). */
export const DEFAULT_ENABLED: RightWidgetId[] = ["clock", "git", "notes", "launch"];

/** Curated accent presets offered in the pickers (any hex is allowed too). */
export const ACCENT_PRESETS = [
  "#e8590c",
  "#e03131",
  "#f08c00",
  "#2f9e44",
  "#0ca678",
  "#1971c2",
  "#0c8599",
  "#e64980",
  "#846358",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeAccent(value: unknown): string | null {
  return typeof value === "string" && HEX_RE.test(value) ? value.toLowerCase() : null;
}

function defaultWidget(id: RightWidgetId, enabled: boolean): RightWidgetConfig {
  return { id, enabled, accent: null, options: {} };
}

export function defaultRightPanelConfig(): RightPanelConfig {
  return {
    widgets: RIGHT_WIDGET_IDS.map((id) => defaultWidget(id, DEFAULT_ENABLED.includes(id))),
    accent: null,
    density: "comfortable",
    show_titles: true,
    dividers: true,
    font_size: "sm",
  };
}

/** Normalize a stored font-size value to a known preset. */
export function normalizeFontSize(value: unknown): RightPanelFontSize {
  return value === "xs" || value === "md" ? value : "sm";
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Clamp/normalize per-widget options so a hand-edited or stale config can't
 *  produce a broken widget (negative row counts, 0-minute timers, …). */
export function sanitizeOptions(id: RightWidgetId, raw: unknown): RightWidgetOptions {
  const o: RightWidgetOptions =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as RightWidgetOptions) } : {};
  if (o.max_items !== undefined) o.max_items = clampInt(o.max_items, 1, 20, 6);
  if (o.height !== undefined) o.height = clampInt(o.height, 60, 400, 112);
  if (o.presets !== undefined) {
    const list = Array.isArray(o.presets) ? o.presets : [];
    o.presets = list
      .map((m) => clampInt(m, 1, 240, 25))
      .filter((m, i, a) => a.indexOf(m) === i)
      .slice(0, 4);
    if ((o.presets as number[]).length === 0) delete o.presets;
  }
  for (const key of ["hour12", "show_seconds", "show_date", "show_cpu", "show_ram", "show_counts"] as const) {
    if (o[key] !== undefined && typeof o[key] !== "boolean") delete o[key];
  }
  void id;
  return o;
}

/**
 * Parse the persisted JSON blob, falling back to (and migrating from) the
 * legacy `right_panel_widgets` string list when the blob is empty/invalid.
 * The result always contains every known widget exactly once, in a valid
 * order, so callers never need to defend against missing/duplicated entries.
 */
export function parseRightPanelConfig(json: string, legacyWidgets: string[]): RightPanelConfig {
  let raw: unknown = null;
  if (json.trim() !== "") {
    try {
      raw = JSON.parse(json);
    } catch {
      raw = null;
    }
  }

  if (raw === null || typeof raw !== "object") {
    // Migrate: the legacy list is "ordered, visible widget ids".
    const legacy = legacyWidgets.filter((id): id is RightWidgetId =>
      (RIGHT_WIDGET_IDS as readonly string[]).includes(id),
    );
    if (legacy.length === 0) return defaultRightPanelConfig();
    const rest = RIGHT_WIDGET_IDS.filter((id) => !legacy.includes(id));
    return {
      widgets: [
        ...legacy.map((id) => defaultWidget(id, true)),
        ...rest.map((id) => defaultWidget(id, false)),
      ],
      accent: null,
      density: "comfortable",
      show_titles: true,
      dividers: true,
      font_size: "sm",
    };
  }

  const obj = raw as Record<string, unknown>;
  const seen = new Set<RightWidgetId>();
  const widgets: RightWidgetConfig[] = [];
  if (Array.isArray(obj.widgets)) {
    for (const item of obj.widgets) {
      if (item === null || typeof item !== "object") continue;
      const w = item as Record<string, unknown>;
      const id = w.id as RightWidgetId;
      if (!(RIGHT_WIDGET_IDS as readonly string[]).includes(id) || seen.has(id)) continue;
      seen.add(id);
      widgets.push({
        id,
        enabled: typeof w.enabled === "boolean" ? w.enabled : false,
        accent: normalizeAccent(w.accent),
        options: sanitizeOptions(id, w.options),
      });
    }
  }
  // Append any widget ids this build knows about but the stored config doesn't
  // (new widgets added in an update show up disabled at the end).
  for (const id of RIGHT_WIDGET_IDS) {
    if (!seen.has(id)) widgets.push(defaultWidget(id, false));
  }
  // A config where nothing is enabled renders an empty panel — treat it like a
  // fresh install instead (matches the legacy `[] = defaults` behavior).
  if (!widgets.some((w) => w.enabled)) {
    for (const w of widgets) w.enabled = DEFAULT_ENABLED.includes(w.id);
  }
  return {
    widgets,
    accent: normalizeAccent(obj.accent),
    density: obj.density === "compact" ? "compact" : "comfortable",
    show_titles: obj.show_titles !== false,
    dividers: obj.dividers !== false,
    font_size: normalizeFontSize(obj.font_size),
  };
}

export function serializeRightPanelConfig(config: RightPanelConfig): string {
  return JSON.stringify(config);
}

/** The legacy mirror: ordered ids of the enabled widgets. */
export function toLegacyWidgetList(config: RightPanelConfig): string[] {
  return config.widgets.filter((w) => w.enabled).map((w) => w.id);
}

// ---- pure update helpers (used by the panel edit mode & Settings) --------

export function moveWidget(config: RightPanelConfig, id: RightWidgetId, toIndex: number): RightPanelConfig {
  const from = config.widgets.findIndex((w) => w.id === id);
  if (from < 0) return config;
  const clamped = Math.min(config.widgets.length - 1, Math.max(0, toIndex));
  if (clamped === from) return config;
  const widgets = [...config.widgets];
  const [item] = widgets.splice(from, 1);
  widgets.splice(clamped, 0, item);
  return { ...config, widgets };
}

export function setWidgetEnabled(config: RightPanelConfig, id: RightWidgetId, enabled: boolean): RightPanelConfig {
  return {
    ...config,
    widgets: config.widgets.map((w) => (w.id === id ? { ...w, enabled } : w)),
  };
}

export function setWidgetAccent(config: RightPanelConfig, id: RightWidgetId, accent: string | null): RightPanelConfig {
  return {
    ...config,
    widgets: config.widgets.map((w) => (w.id === id ? { ...w, accent: normalizeAccent(accent) } : w)),
  };
}

export function setWidgetOptions(
  config: RightPanelConfig,
  id: RightWidgetId,
  patch: RightWidgetOptions,
): RightPanelConfig {
  return {
    ...config,
    widgets: config.widgets.map((w) =>
      w.id === id ? { ...w, options: sanitizeOptions(id, { ...w.options, ...patch }) } : w,
    ),
  };
}
