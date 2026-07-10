/** Editor language detection and language picker options.
 *  Kept pure so the CodeMirror editor panels and tests share the same mapping.
 *  Every id this module returns has a matching grammar in
 *  `codemirrorLanguages.ts` (unknown ids fall back to plaintext). */

export interface EditorLanguageOption {
  id: string;
  label: string;
}

/** Languages we expose in the editor footer/toolbar. Keeping this curated (and
 *  in sync with the grammars wired up in `codemirrorLanguages.ts`) makes the
 *  picker feel IDE-grade. */
export const EDITOR_LANGUAGE_OPTIONS: EditorLanguageOption[] = [
  { id: "plaintext", label: "Plain Text" },
  { id: "typescript", label: "TypeScript" },
  { id: "tsx", label: "TSX" },
  { id: "javascript", label: "JavaScript" },
  { id: "jsx", label: "JSX" },
  { id: "json", label: "JSON" },
  { id: "jsonc", label: "JSON with Comments" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "scss", label: "SCSS" },
  { id: "less", label: "Less" },
  { id: "markdown", label: "Markdown" },
  { id: "yaml", label: "YAML" },
  { id: "toml", label: "TOML" },
  { id: "ini", label: "INI / ENV / Conf" },
  { id: "xml", label: "XML" },
  { id: "shell", label: "Shell" },
  { id: "powershell", label: "PowerShell" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "swift", label: "Swift" },
  { id: "kotlin", label: "Kotlin" },
  { id: "sql", label: "SQL" },
  { id: "dockerfile", label: "Dockerfile" },
];

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  pyw: "python",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  toml: "toml",
  ini: "ini",
  env: "ini",
  conf: "ini",
  cfg: "ini",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  vue: "html",
  svelte: "html",
  dockerfile: "dockerfile",
  // Extra ext → language. Not all of these appear in the picker; ids without a
  // dedicated grammar in codemirrorLanguages.ts render as clean plaintext.
  bat: "bat",
  cmd: "bat",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  pl: "perl",
  pm: "perl",
  r: "r",
  gradle: "groovy",
  groovy: "groovy",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
  hcl: "hcl",
  tf: "hcl",
  patch: "diff",
  diff: "diff",
};

const NAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  "dockerfile.dev": "dockerfile",
  "dockerfile.prod": "dockerfile",
  makefile: "shell",
  justfile: "shell",
  procfile: "shell",
  "cmakelists.txt": "cpp",
  ".env": "ini",
  ".env.local": "ini",
  ".env.example": "ini",
  ".gitignore": "ini",
  ".gitattributes": "ini",
  ".dockerignore": "ini",
  ".npmrc": "ini",
  ".editorconfig": "ini",
  ".bashrc": "shell",
  ".bash_profile": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
};

// Git hook samples ship without a "real" extension (e.g. `commit-msg.sample`,
// `pre-commit`). They are shell scripts — recognise the well-known hook names.
const GIT_HOOK_NAMES = new Set([
  "applypatch-msg", "pre-applypatch", "post-applypatch", "pre-commit",
  "pre-merge-commit", "prepare-commit-msg", "commit-msg", "post-commit",
  "pre-rebase", "post-checkout", "post-merge", "pre-push", "pre-receive",
  "update", "post-update", "push-to-checkout", "pre-auto-gc", "post-rewrite",
  "sendemail-validate", "fsmonitor-watchman", "post-receive",
]);

export function languageForPath(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (NAME_LANG[file]) return NAME_LANG[file];
  if (file.startsWith(".env.")) return "ini";
  // `commit-msg`, `pre-commit.sample`, … → shell.
  const hookBase = file.endsWith(".sample") ? file.slice(0, -".sample".length) : file;
  if (GIT_HOOK_NAMES.has(hookBase)) return "shell";
  const ext = file.includes(".") ? file.split(".").pop() ?? "" : "";
  return EXT_LANG[ext] ?? "plaintext";
}

/** Map a shebang line (`#!/usr/bin/env python3`) to an editor language id. */
export function languageFromShebang(firstLine: string): string | null {
  const m = firstLine.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
  if (!m) return null;
  const bin = ((m[1].includes("env") && m[2]) ? m[2] : m[1]).split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (/^(ba|da|k|z|a|tc|c)?sh$|^fish$|^busybox$/.test(bin)) return "shell";
  if (bin.startsWith("python")) return "python";
  if (bin === "node" || bin === "nodejs" || bin === "bun" || bin === "deno") return "javascript";
  if (bin === "ts-node" || bin === "tsx") return "typescript";
  if (bin === "ruby") return "ruby";
  if (bin === "php") return "php";
  if (bin === "perl") return "perl";
  if (bin === "lua") return "lua";
  if (bin === "rscript" || bin === "r") return "r";
  if (bin === "pwsh" || bin === "powershell") return "powershell";
  return null;
}

/** Best-effort language: extension/name first, then the file's shebang line. */
export function detectLanguage(path: string, content?: string): string {
  const byPath = languageForPath(path);
  if (byPath !== "plaintext") return byPath;
  if (content) {
    const firstLine = content.slice(0, 256).split(/\r?\n/, 1)[0] ?? "";
    const byShebang = languageFromShebang(firstLine);
    if (byShebang) return byShebang;
  }
  return "plaintext";
}

export function languageLabel(id: string): string {
  return EDITOR_LANGUAGE_OPTIONS.find((l) => l.id === id)?.label ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Plain Text");
}
