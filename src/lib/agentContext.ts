/**
 * Build clipboard-ready context blocks from selected files so they can be
 * pasted straight into an AI agent prompt (Files panel multi-select).
 *
 * Also supports building context from git diffs and active editor content,
 * so the AI agent can be given the current working state of the project.
 */

export interface AgentFile {
  /** Path relative to the project root (preferred) or absolute. */
  path: string;
  /** File content; `null` for binary/unreadable files (listed path-only). */
  content: string | null;
}

/** A git diff hunk for the agent context. */
export interface AgentDiffHunk {
  file: string;
  /** Unified diff text for this file. */
  diff: string;
  /** Whether this file is staged, unstaged, or untracked. */
  status: "staged" | "unstaged" | "untracked";
}

/** Context block types that can be assembled into a full agent prompt. */
export type ContextBlock =
  | { type: "files"; files: AgentFile[] }
  | { type: "paths"; paths: string[] }
  | { type: "diff"; hunks: AgentDiffHunk[] }
  | { type: "selection"; file: string; text: string; startLine: number; endLine: number };

const FENCE_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
};

export function fenceLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FENCE_BY_EXT[ext] ?? "";
}

/** A short prompt that just lists the selected paths. */
export function buildPathsPrompt(paths: string[]): string {
  if (paths.length === 0) return "";
  const list = paths.map((p) => `- ${p}`).join("\n");
  return `Please look at these files:\n${list}`;
}

/** A full prompt embedding file contents in fenced code blocks. */
export function buildContentsPrompt(files: AgentFile[]): string {
  if (files.length === 0) return "";
  const parts: string[] = ["Please look at these files:"];
  for (const f of files) {
    if (f.content === null) {
      parts.push(`## ${f.path}\n(binary or unreadable — inspect on disk)`);
      continue;
    }
    // Grow the fence if the content itself contains backtick fences.
    let fence = "```";
    while (f.content.includes(fence)) fence += "`";
    const lang = fenceLang(f.path);
    parts.push(`## ${f.path}\n${fence}${lang}\n${f.content.replace(/\n$/, "")}\n${fence}`);
  }
  return parts.join("\n\n");
}

/** Build a prompt from git diff hunks. */
export function buildDiffPrompt(hunks: AgentDiffHunk[]): string {
  if (hunks.length === 0) return "";
  const parts: string[] = ["Here are my current uncommitted changes:"];
  for (const h of hunks) {
    parts.push(`### ${h.file} (${h.status})\n\`\`\`diff\n${h.diff}\n\`\`\``);
  }
  parts.push("\nPlease review these changes and suggest improvements.");
  return parts.join("\n\n");
}

/** Build a prompt from an editor selection. */
export function buildSelectionPrompt(file: string, text: string, startLine: number, endLine: number): string {
  if (!text.trim()) return "";
  const lang = fenceLang(file);
  return `Please look at this selection from \`${file}\` (lines ${startLine}-${endLine}):\n\n\`\`\`${lang}\n${text}\n\`\`\``;
}

/** Assemble multiple context blocks into a single prompt. */
export function buildContextPrompt(blocks: ContextBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "files") {
      const p = buildContentsPrompt(block.files);
      if (p) parts.push(p);
    } else if (block.type === "paths") {
      const p = buildPathsPrompt(block.paths);
      if (p) parts.push(p);
    } else if (block.type === "diff") {
      const p = buildDiffPrompt(block.hunks);
      if (p) parts.push(p);
    } else if (block.type === "selection") {
      const p = buildSelectionPrompt(block.file, block.text, block.startLine, block.endLine);
      if (p) parts.push(p);
    }
  }
  return parts.join("\n\n---\n\n");
}
