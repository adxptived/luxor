/**
 * "Run file" in the terminal: the command that runs a single source file with
 * its usual interpreter. Pure (unit-tested); the platform is a parameter.
 */

import { shellQuote } from "./shellQuote";

type Runner = (file: string, windows: boolean) => string;

const RUNNERS: Record<string, Runner> = {
  py: (f, win) => `${win ? "python" : "python3"} ${f}`,
  js: (f) => `node ${f}`,
  mjs: (f) => `node ${f}`,
  cjs: (f) => `node ${f}`,
  ts: (f) => `npx tsx ${f}`,
  mts: (f) => `npx tsx ${f}`,
  sh: (f) => `bash ${f}`,
  bash: (f) => `bash ${f}`,
  zsh: (f) => `zsh ${f}`,
  fish: (f) => `fish ${f}`,
  ps1: (f, win) => `${win ? "powershell -ExecutionPolicy Bypass -File" : "pwsh -File"} ${f}`,
  bat: (f) => f,
  cmd: (f) => f,
  go: (f) => `go run ${f}`,
  rb: (f) => `ruby ${f}`,
  php: (f) => `php ${f}`,
  pl: (f) => `perl ${f}`,
  lua: (f) => `lua ${f}`,
  r: (f) => `Rscript ${f}`,
  java: (f) => `java ${f}`,
  kts: (f) => `kotlin ${f}`,
  dart: (f) => `dart run ${f}`,
  swift: (f) => `swift ${f}`,
  exs: (f) => `elixir ${f}`,
  jl: (f) => `julia ${f}`,
};

/** File extension, lower-case, without the dot ("" when there is none). */
function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** True when "Run file" knows how to run this file. */
export function canRunFile(path: string): boolean {
  return extOf(path) in RUNNERS;
}

/**
 * The shell command that runs `path`, relative to `cwd` when the file lives
 * below it (shorter, and what you would type yourself); null for file types
 * without a runner.
 */
export function runFileCommand(path: string, cwd: string | null, windows: boolean): string | null {
  const runner = RUNNERS[extOf(path)];
  if (!runner) return null;
  let target = path;
  if (cwd) {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = norm(cwd);
    const full = norm(path);
    const same = windows ? full.toLowerCase().startsWith(`${base.toLowerCase()}/`) : full.startsWith(`${base}/`);
    if (base && same) {
      const rel = full.slice(base.length + 1);
      target = windows ? rel.replace(/\//g, "\\") : rel;
    }
  }
  // PowerShell and cmd need ".\" to run a script from the current folder.
  const ext = extOf(path);
  if ((ext === "bat" || ext === "cmd") && target === path.split(/[\\/]/).pop()) target = `.\\${target}`;
  return runner(shellQuote(target), windows);
}
