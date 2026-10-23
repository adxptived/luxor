import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import iconButtonLabel from "./eslint-rules/icon-button-label.js";

// eslint-plugin-jsx-a11y is picked up automatically once it is installed
// (`bun add -d eslint-plugin-jsx-a11y`). Until then the local
// `luxor/icon-button-label` rule below still guards the most common
// regression the audit found: icon-only buttons with no accessible name.
const jsxA11y = await import("eslint-plugin-jsx-a11y").then((m) => m.default ?? m).catch(() => null);

// Focused flat config. The heavy lifting (types, unused vars) is owned by
// `tsc --noEmit`; ESLint here exists primarily to enforce the React Hooks
// rules statically, so the class of bug behind React error #310
// (a hook declared after an early `return`) fails CI before it ever ships.
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Catches conditional hooks / hooks after early return -> React #310.
      "react-hooks/rules-of-hooks": "error",
      // Stale-closure / missing-dependency hints (non-fatal).
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // ── Accessibility guard (audit P5) ───────────────────────────────────────
  // Icon-only <button>s must carry aria-label: `title` is only a tooltip and is
  // not reliably announced by screen readers. See eslint-rules/.
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx"],
    plugins: {
      luxor: { rules: { "icon-button-label": iconButtonLabel } },
      ...(jsxA11y ? { "jsx-a11y": jsxA11y } : {}),
    },
    rules: {
      "luxor/icon-button-label": "error",
      ...(jsxA11y
        ? {
            // Structural ARIA mistakes are hard errors; the interaction rules
            // start as warnings so they can be burned down without blocking CI.
            "jsx-a11y/aria-props": "error",
            "jsx-a11y/aria-proptypes": "error",
            "jsx-a11y/aria-role": "error",
            "jsx-a11y/role-has-required-aria-props": "error",
            "jsx-a11y/role-supports-aria-props": "error",
            "jsx-a11y/alt-text": "error",
            "jsx-a11y/iframe-has-title": "error",
            "jsx-a11y/tabindex-no-positive": "error",
            "jsx-a11y/control-has-associated-label": [
              "warn",
              { ignoreElements: ["input", "textarea", "select", "td", "th", "tr"], depth: 4 },
            ],
            "jsx-a11y/click-events-have-key-events": "warn",
            "jsx-a11y/no-static-element-interactions": "warn",
          }
        : {}),
    },
  },
  // ── Design-system guard (audit S1) ───────────────────────────────────────
  // Forbids raw Tailwind palette classes (text-red-400, bg-zinc-900/50, …) in
  // string and template literals. The design system exposes semantic tokens
  // (text-danger, bg-surface, text-success, …) and soft/-chart variants that
  // repaint with every theme; raw palettes don't, which is exactly the
  // "alien islands" problem the audit found. Theme/syntax data files that must
  // name concrete colors are exempted below.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/themes.ts",
      "src/lib/codemirrorThemes.ts",
      "src/lib/codemirrorThemeMeta.ts",
      "src/lib/codemirrorLanguages.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]/]",
          message:
            "Raw Tailwind palette class detected. Use a semantic design token instead (text-danger / text-success / text-warning / text-info, bg-surface/raised/bar, *-soft / *-soft-strong, text-chart-1..6, text-on-accent). See styles.css @theme and themes.ts.",
        },
        {
          selector:
            "TemplateElement[value.raw=/(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]/]",
          message:
            "Raw Tailwind palette class detected. Use a semantic design token instead (text-danger / text-success / text-warning / text-info, bg-surface/raised/bar, *-soft / *-soft-strong, text-chart-1..6, text-on-accent). See styles.css @theme and themes.ts.",
        },
      ],
    },
  },
  // ── Locale guard (audit 2026-07-26 §2.3) ─────────────────────────────────
  // `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` without an
  // explicit locale fall back to the HOST OS locale, not the app's language
  // setting. That made an English UI on a Russian Windows print "1 024" and
  // "26.07.2026", and made unit tests fail on any non-en-US machine.
  // `src/lib/format.ts` wraps them all with `getLocale()`; everything else must
  // go through it.
  //
  // Uses `no-restricted-properties` rather than `no-restricted-syntax` on
  // purpose: the design-system block above already owns `no-restricted-syntax`,
  // and in flat config a second block setting the same rule REPLACES it instead
  // of merging.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/format.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].map((property) => ({
          property,
          message:
            `${property}() follows the OS locale, not the app language. Use the helpers in ` +
            "@/lib/format (formatNumber / formatDate / formatTime / formatDateTime / " +
            "formatClock / formatUnixDate / formatUnixDateTime / formatBytes).",
        })),
      ],
    },
  },
];
