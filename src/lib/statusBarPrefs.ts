/**
 * Status-bar layout preference (persisted in localStorage).
 *
 * Controls where the status-bar segment cluster sits inside the bar:
 *   - "spread": left + right groups separated by the spacer (classic default)
 *   - "left" / "center" / "right": the whole cluster hugs that edge / centers
 *
 * Stored client-side (no backend config round-trip needed) so it is instant
 * and never blocks on the settings file.
 */

export type StatusBarAlign = "spread" | "left" | "center" | "right";

const KEY = "luxor.statusBarAlign";

export const STATUS_ALIGN_OPTIONS: { id: StatusBarAlign; label: string }[] = [
  { id: "spread", label: "Spread (left + right)" },
  { id: "left", label: "Align left" },
  { id: "center", label: "Align center" },
  { id: "right", label: "Align right" },
];

export function loadStatusBarAlign(): StatusBarAlign {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "left" || v === "center" || v === "right" || v === "spread") return v;
  } catch {
    // ignore — storage unavailable
  }
  return "spread";
}

export function saveStatusBarAlign(align: StatusBarAlign): void {
  try {
    localStorage.setItem(KEY, align);
  } catch {
    // ignore — won't persist
  }
}

/** CSS `justify-content` value for the segment cluster.
 *  "spread" uses the spacer flex item to push right-side segments to the edge;
 *  the outer container stays "flex-start" so the spacer can grow freely.
 *  All four cases are explicit to avoid accidental fall-through bugs. */
export function alignToJustify(align: StatusBarAlign): string {
  switch (align) {
    case "center":
      return "center";
    case "right":
      return "flex-end";
    case "spread":
      // The spacer element handles separation — outer container is flex-start.
      return "flex-start";
    case "left":
    default:
      // Unknown persisted values (e.g. from a newer/older build) must never
      // yield `undefined` — fall back to the safe default.
      return "flex-start";
  }
}
