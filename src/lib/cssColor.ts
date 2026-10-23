/**
 * Resolve CSS colour expressions (`var(--x)`, `color-mix(…)`, named colours…)
 * into plain `#rrggbb` strings for libraries that need a literal colour, such
 * as xterm.js themes. Resolution happens from a given element so scoped
 * custom properties (e.g. the layered dock surface) are honoured.
 */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, "0");

/** Parse a computed colour (`rgb()`, `rgba()`, `color(srgb …)`, `#hex`) into `#rrggbb`. */
export function computedColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (m) return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(v);
  if (m) return `#${hex2(+m[1] * 255)}${hex2(+m[2] * 255)}${hex2(+m[3] * 255)}`;
  return null;
}

/** The colour `expr` resolves to inside `scope`, as `#rrggbb` (or `fallback`). */
export function resolveCssColor(scope: Element | null, expr: string, fallback: string): string {
  if (!scope || typeof getComputedStyle !== "function") return fallback;
  try {
    const probe = scope.ownerDocument.createElement("span");
    probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";
    probe.style.color = expr;
    scope.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computedColorToHex(computed) ?? fallback;
  } catch {
    return fallback;
  }
}
