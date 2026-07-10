/**
 * Theme crossfade utility.
 *
 * Smoothly transitions between themes by crossfading CSS custom properties.
 * The old theme's colors are captured, the new theme is applied, and the
 * properties are interpolated over `duration` ms using requestAnimationFrame.
 *
 * Only color properties (--lx-*) are crossfaded; structural properties
 * (heights, radii) switch instantly to avoid layout jumps.
 */

const COLOR_PROPS = [
  "--lx-surface",
  "--lx-raised",
  "--lx-bar",
  "--lx-edge",
  "--lx-strong",
  "--lx-muted",
  "--lx-accent",
];

interface ColorValue {
  r: number;
  g: number;
  b: number;
}

function parseColor(value: string): ColorValue | null {
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[1] + hex[1], 16),
      g: parseInt(hex[2] + hex[2], 16),
      b: parseInt(hex[3] + hex[3], 16),
    };
  }
  return null;
}

function toHex(c: ColorValue): string {
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Crossfade from the current theme to the new theme.
 * Call this AFTER setting the data-theme attribute, passing the OLD values.
 */
export function crossfadeTheme(
  _fromTheme: string,
  toTheme: string,
  duration = 300,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const computed = getComputedStyle(root);

  // Capture the "from" colors (current computed values before theme switch).
  const fromColors: Record<string, ColorValue | null> = {};
  for (const prop of COLOR_PROPS) {
    fromColors[prop] = parseColor(computed.getPropertyValue(prop));
  }

  // Switch to the new theme.
  root.dataset.theme = toTheme;

  // Force a reflow to get the new theme's computed values.
  void root.offsetHeight;
  const newComputed = getComputedStyle(root);

  // Capture the "to" colors.
  const toColors: Record<string, ColorValue | null> = {};
  for (const prop of COLOR_PROPS) {
    toColors[prop] = parseColor(newComputed.getPropertyValue(prop));
  }

  // If any color failed to parse, skip the animation for that property.
  const animatable = COLOR_PROPS.filter(
    (p) => fromColors[p] && toColors[p],
  );

  if (animatable.length === 0) return;

  // Check for reduced motion preference.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return; // Instant switch, no animation.
  }

  const start = performance.now();
  let rafId = 0;

  function tick(now: number) {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / duration);
    const t = easeInOutCubic(progress);

    for (const prop of animatable) {
      const from = fromColors[prop]!;
      const to = toColors[prop]!;
      root.style.setProperty(
        prop,
        toHex({
          r: lerp(from.r, to.r, t),
          g: lerp(from.g, to.g, t),
          b: lerp(from.b, to.b, t),
        }),
      );
    }

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      // Clean up: remove inline overrides so the CSS defaults take over.
      for (const prop of animatable) {
        root.style.removeProperty(prop);
      }
    }
  }

  rafId = requestAnimationFrame(tick);

  // Safety: clear after 2x duration in case rAF is throttled.
  setTimeout(() => {
    if (rafId) cancelAnimationFrame(rafId);
    for (const prop of animatable) {
      root.style.removeProperty(prop);
    }
  }, duration * 2 + 100);
}