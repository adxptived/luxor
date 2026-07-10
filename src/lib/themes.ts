/** Theme registry: metadata for every built-in theme. */

import type { Theme } from "./types";

export interface ThemeMeta {
  id: Theme;
  label: string;
  light: boolean;
  /** Default accent of the theme (accent overrides compare against this). */
  accent: string;
  /** Swatch colors for the settings picker: [surface, raised, accent]. */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: "dark", label: "Luxor Dark", light: false, accent: "#e8b059", swatch: ["#101014", "#1a1a21", "#e8b059"] },
  { id: "light", label: "Luxor Light", light: true, accent: "#b07818", swatch: ["#fafafa", "#ededf0", "#b07818"] },
  { id: "system", label: "System", light: false, accent: "#e8b059", swatch: ["#101014", "#fafafa", "#e8b059"] },
  { id: "tokyo_night", label: "Tokyo Night", light: false, accent: "#7aa2f7", swatch: ["#1a1b26", "#24283b", "#7aa2f7"] },
  { id: "catppuccin_mocha", label: "Catppuccin Mocha", light: false, accent: "#cba6f7", swatch: ["#1e1e2e", "#313244", "#cba6f7"] },
  { id: "catppuccin_latte", label: "Catppuccin Latte", light: true, accent: "#8839ef", swatch: ["#eff1f5", "#e0e3ec", "#8839ef"] },
  { id: "dracula", label: "Dracula", light: false, accent: "#bd93f9", swatch: ["#282a36", "#343746", "#bd93f9"] },
  { id: "nord", label: "Nord", light: false, accent: "#88c0d0", swatch: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "gruvbox_dark", label: "Gruvbox Dark", light: false, accent: "#fabd2f", swatch: ["#282828", "#3c3836", "#fabd2f"] },
  { id: "one_dark", label: "One Dark", light: false, accent: "#61afef", swatch: ["#282c34", "#333842", "#61afef"] },
  { id: "solarized_light", label: "Solarized Light", light: true, accent: "#b58900", swatch: ["#fdf6e3", "#ece5cf", "#b58900"] },
  { id: "rose_pine", label: "Rosé Pine", light: false, accent: "#ebbcba", swatch: ["#191724", "#26233a", "#ebbcba"] },
  { id: "everforest_dark", label: "Everforest Dark", light: false, accent: "#a7c080", swatch: ["#2d353b", "#3d484d", "#a7c080"] },
  { id: "ayu_mirage", label: "Ayu Mirage", light: false, accent: "#ffcc66", swatch: ["#1f2430", "#232834", "#ffcc66"] },
  { id: "github_light", label: "GitHub Light", light: true, accent: "#0969da", swatch: ["#ffffff", "#f6f8fa", "#0969da"] },
];

/** Resolve "system" against the OS preference. */
export function resolveTheme(theme: Theme): Exclude<Theme, "system"> {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function isLightTheme(theme: Theme): boolean {
  const resolved = resolveTheme(theme);
  return THEMES.find((t) => t.id === resolved)?.light ?? false;
}

export function themeMeta(theme: Theme): ThemeMeta {
  return THEMES.find((t) => t.id === theme) ?? THEMES[0];
}

/** WCAG relative luminance (0..1) of a `#rgb` / `#rrggbb` color. */
function relativeLuminance(hex: string): number {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0;
  const lin = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

/**
 * Pick a readable foreground (near-black or white) for text/icons sitting on
 * top of `bg`, by comparing WCAG contrast ratios. Drives `--lx-on-accent` so
 * accent buttons stay legible on *any* theme accent — and on custom user
 * accents, which per-theme CSS can't anticipate.
 */
export function onColor(bg: string, dark = "#0b0b0e", light = "#ffffff"): string {
  const L = relativeLuminance(bg);
  const contrastDark = (L + 0.05) / 0.05; // vs ~black
  const contrastLight = 1.05 / (L + 0.05); // vs white
  return contrastDark >= contrastLight ? dark : light;
}
