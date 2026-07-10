import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

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
];
