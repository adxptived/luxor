/**
 * Project-tab icons. Two storage formats in `project.icon`:
 *   - `"lucide:<name>"` → a curated built-in SVG icon (preferred)
 *   - anything else     → treated as a literal emoji/text glyph (legacy)
 */

export interface ParsedTabIcon {
  kind: "lucide" | "emoji";
  /** Lucide icon id, or the emoji text. */
  value: string;
}

const LUCIDE_PREFIX = "lucide:";

/** Curated icon set shown in the tab-icon picker (ids match `TAB_ICON_COMPONENTS`). */
export const TAB_ICON_IDS = [
  "rocket",
  "star",
  "flame",
  "zap",
  "bug",
  "heart",
  "folder",
  "terminal",
  "globe",
  "book",
  "wrench",
  "flask",
  "shield",
  "database",
  "cloud",
  "music",
] as const;

export type TabIconId = (typeof TAB_ICON_IDS)[number];

/** Serialize a curated icon for storage in `project.icon`. */
export function lucideIcon(id: TabIconId): string {
  return `${LUCIDE_PREFIX}${id}`;
}

/** Parse a stored icon string; null/empty → no icon. */
export function parseTabIcon(stored: string | null | undefined): ParsedTabIcon | null {
  const raw = (stored ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith(LUCIDE_PREFIX)) {
    const id = raw.slice(LUCIDE_PREFIX.length);
    // Unknown lucide ids (from a future version) degrade to no icon, not text.
    return (TAB_ICON_IDS as readonly string[]).includes(id) ? { kind: "lucide", value: id } : null;
  }
  return { kind: "emoji", value: raw };
}
