/** Pure helpers for the editor footer status bar (Ln/Col, selection,
 *  language label). Kept free of editor (CodeMirror) types so they're easy to unit-test. */

/** Human-readable names for the editor language ids used in this app. */
export const LANG_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  python: "Python",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
  ini: "INI / TOML",
  yaml: "YAML",
  shell: "Shell",
  go: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  sql: "SQL",
  xml: "XML",
  jsonc: "JSON with Comments",
  scss: "SCSS",
  less: "Less",
  powershell: "PowerShell",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  dockerfile: "Dockerfile",
  plaintext: "Plain Text",
};

/** Pretty language name; falls back to a capitalised id. */
export function langLabel(id: string): string {
  if (LANG_LABELS[id]) return LANG_LABELS[id];
  if (!id) return "Plain Text";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** "Ln 12, Col 5" — 1-based, matches VS Code. */
export function cursorLabel(line: number, col: number): string {
  return `Ln ${line}, Col ${col}`;
}

/**
 * VS Code-style selection summary appended after the cursor label.
 * - no selection -> ""
 * - one range    -> " (12 selected)"
 * - many ranges  -> " (12 selected in 3 ranges)"
 */
export function selectionLabel(chars: number, ranges: number): string {
  if (chars <= 0 || ranges <= 0) return "";
  if (ranges === 1) return ` (${chars} selected)`;
  return ` (${chars} selected in ${ranges} ranges)`;
}
