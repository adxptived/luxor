/**
 * File-type icons for the explorer, tabs and quick-open.
 *
 * Pure data + lookup (no React) so the mapping is unit-testable. A file maps
 * to a small coloured "badge" (2–3 letter label on a rounded square); a folder
 * maps to a colour. Special file names win over extensions, extensions win
 * over the generic fallback.
 */

export interface FileBadge {
  /** 1–3 character label drawn inside the badge. */
  label: string;
  /** Badge background. */
  bg: string;
  /** Label colour (chosen for contrast on `bg`). */
  fg: string;
  /** Stable kind id, handy for tests and styling hooks. */
  kind: string;
}

const LIGHT = "#ffffff";
const DARK = "#14120c";

function b(kind: string, label: string, bg: string, fg: string = LIGHT): FileBadge {
  return { kind, label, bg, fg };
}

/** Exact (lower-case) file names. */
const BY_NAME: Record<string, FileBadge> = {
  "package.json": b("npm", "{}", "#d6c84a", DARK),
  "package-lock.json": b("lock", "LK", "#6b6b78"),
  "bun.lock": b("lock", "LK", "#6b6b78"),
  "bun.lockb": b("lock", "LK", "#6b6b78"),
  "yarn.lock": b("lock", "LK", "#6b6b78"),
  "pnpm-lock.yaml": b("lock", "LK", "#6b6b78"),
  "cargo.lock": b("lock", "LK", "#6b6b78"),
  "cargo.toml": b("cargo", "RS", "#dea584", "#1a1208"),
  "tsconfig.json": b("tsconfig", "TS", "#3178c6"),
  "dockerfile": b("docker", "DK", "#2f81d0"),
  "docker-compose.yml": b("docker", "DK", "#2f81d0"),
  "docker-compose.yaml": b("docker", "DK", "#2f81d0"),
  "makefile": b("make", "MK", "#6a8f3a"),
  "license": b("license", "LI", "#8a8a96"),
  "readme.md": b("readme", "MD", "#6cb6d9", "#08161d"),
  ".gitignore": b("git", "GT", "#e8734a", "#1d0c05"),
  ".gitattributes": b("git", "GT", "#e8734a", "#1d0c05"),
  ".env": b("env", "EN", "#c9a227", DARK),
  ".editorconfig": b("config", "CF", "#7d7d89"),
  ".prettierrc": b("config", "CF", "#7d7d89"),
  ".npmrc": b("config", "CF", "#7d7d89"),
  ".nvmrc": b("config", "CF", "#7d7d89"),
};

/** Extensions (lower-case, no dot). */
const BY_EXT: Record<string, FileBadge> = {
  ts: b("ts", "TS", "#3178c6"),
  tsx: b("tsx", "TX", "#2f9bc6"),
  js: b("js", "JS", "#d6c84a", DARK),
  jsx: b("jsx", "JX", "#d6c84a", DARK),
  mjs: b("js", "JS", "#d6c84a", DARK),
  cjs: b("js", "JS", "#d6c84a", DARK),
  json: b("json", "{}", "#d6c84a", DARK),
  jsonc: b("json", "{}", "#d6c84a", DARK),
  rs: b("rust", "RS", "#dea584", "#1a1208"),
  toml: b("toml", "TM", "#9c6b4a"),
  py: b("python", "PY", "#3b7bbf"),
  go: b("go", "GO", "#2fb5c9", DARK),
  java: b("java", "JV", "#d9763a"),
  kt: b("kotlin", "KT", "#8f6bd1"),
  swift: b("swift", "SW", "#e8734a", "#1d0c05"),
  c: b("c", "C", "#5a7fb5"),
  h: b("c", "H", "#5a7fb5"),
  cpp: b("cpp", "C+", "#4a6fa5"),
  cs: b("csharp", "C#", "#6a4fb0"),
  rb: b("ruby", "RB", "#c2403a"),
  php: b("php", "PH", "#6c78b5"),
  sh: b("shell", "SH", "#4a9a5a"),
  bash: b("shell", "SH", "#4a9a5a"),
  zsh: b("shell", "SH", "#4a9a5a"),
  fish: b("shell", "SH", "#4a9a5a"),
  ps1: b("shell", "PS", "#2f6fbd"),
  bat: b("shell", "BT", "#4a9a5a"),
  html: b("html", "<>", "#e8734a", "#1d0c05"),
  htm: b("html", "<>", "#e8734a", "#1d0c05"),
  css: b("css", "#", "#8f6bd1"),
  scss: b("css", "#", "#c2609a"),
  less: b("css", "#", "#4a6fa5"),
  vue: b("vue", "VU", "#3fa56a"),
  svelte: b("svelte", "SV", "#e8734a", "#1d0c05"),
  md: b("markdown", "MD", "#6cb6d9", "#08161d"),
  mdx: b("markdown", "MD", "#6cb6d9", "#08161d"),
  txt: b("text", "TX", "#7d7d89"),
  rst: b("text", "RS", "#7d7d89"),
  yml: b("yaml", "YM", "#c2403a"),
  yaml: b("yaml", "YM", "#c2403a"),
  xml: b("xml", "XM", "#c98a1b", DARK),
  svg: b("image", "SG", "#d98a2b", DARK),
  png: b("image", "IMG", "#a8572a"),
  jpg: b("image", "IMG", "#a8572a"),
  jpeg: b("image", "IMG", "#a8572a"),
  gif: b("image", "GIF", "#a8572a"),
  webp: b("image", "IMG", "#a8572a"),
  avif: b("image", "IMG", "#a8572a"),
  bmp: b("image", "IMG", "#a8572a"),
  ico: b("image", "ICO", "#a8572a"),
  pdf: b("pdf", "PDF", "#c2403a"),
  sql: b("sql", "SQ", "#2f8fa5"),
  db: b("database", "DB", "#2f8fa5"),
  sqlite: b("database", "DB", "#2f8fa5"),
  sqlite3: b("database", "DB", "#2f8fa5"),
  db3: b("database", "DB", "#2f8fa5"),
  zip: b("archive", "ZIP", "#8a6a3a"),
  gz: b("archive", "GZ", "#8a6a3a"),
  tar: b("archive", "TAR", "#8a6a3a"),
  "7z": b("archive", "7Z", "#8a6a3a"),
  lock: b("lock", "LK", "#6b6b78"),
  log: b("log", "LG", "#7d7d89"),
  env: b("env", "EN", "#c9a227", DARK),
  ini: b("config", "CF", "#7d7d89"),
  cfg: b("config", "CF", "#7d7d89"),
  conf: b("config", "CF", "#7d7d89"),
  mp3: b("audio", "AU", "#8f6bd1"),
  wav: b("audio", "AU", "#8f6bd1"),
  mp4: b("video", "VD", "#8f6bd1"),
  mov: b("video", "VD", "#8f6bd1"),
  exe: b("binary", "EX", "#5a5a66"),
  dll: b("binary", "DL", "#5a5a66"),
  wasm: b("binary", "WA", "#6a4fb0"),
};

const GENERIC: FileBadge = b("file", "", "#55555f");

/** Lower-case extension without the dot ("a.tar.gz" → "gz", ".env" → "env"). */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Badge for a file name. Unknown extensions get a neutral badge with the extension as label. */
export function fileBadge(name: string): FileBadge {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  const byName = BY_NAME[base];
  if (byName) return byName;
  // `.env.local`, `.env.production`, …
  if (base.startsWith(".env")) return BY_NAME[".env"];
  const ext = extensionOf(base);
  const byExt = ext ? BY_EXT[ext] : undefined;
  if (byExt) return byExt;
  if (!ext) return GENERIC;
  return { ...GENERIC, label: ext.slice(0, 3).toUpperCase() };
}

/** Folder colours by well-known name; everything else uses `DEFAULT_FOLDER`. */
export const DEFAULT_FOLDER = "#7aa2f7";
/** Folders that hold generated / vendored content are dimmed. */
const DIM_FOLDER = "#55555f";

const FOLDER_BY_NAME: Record<string, string> = {
  src: "#e8b059",
  source: "#e8b059",
  lib: "#7aa2f7",
  components: "#7aa2f7",
  panels: "#7aa2f7",
  crates: "#dea584",
  "src-tauri": "#dea584",
  tests: "#3fb950",
  test: "#3fb950",
  e2e: "#3fb950",
  __tests__: "#3fb950",
  docs: "#6cb6d9",
  doc: "#6cb6d9",
  scripts: "#4a9a5a",
  bin: "#4a9a5a",
  public: "#c98a1b",
  assets: "#c98a1b",
  static: "#c98a1b",
  ".github": "#e8734a",
  ".vscode": "#2f81d0",
  ".git": DIM_FOLDER,
  node_modules: DIM_FOLDER,
  target: DIM_FOLDER,
  dist: DIM_FOLDER,
  build: DIM_FOLDER,
  out: DIM_FOLDER,
  ".next": DIM_FOLDER,
  ".cache": DIM_FOLDER,
  coverage: DIM_FOLDER,
  __pycache__: DIM_FOLDER,
  ".venv": DIM_FOLDER,
  venv: DIM_FOLDER,
};

export function folderColor(name: string): string {
  return FOLDER_BY_NAME[name.toLowerCase()] ?? DEFAULT_FOLDER;
}

/** True for folders that hold generated or vendored content (rendered dimmed). */
export function isDimmedFolder(name: string): boolean {
  return folderColor(name) === DIM_FOLDER;
}
