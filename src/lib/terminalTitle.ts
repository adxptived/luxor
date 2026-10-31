/**
 * Tab title for a terminal, from what the shell reports.
 *
 * Every terminal tab used to be called "Terminal", so with three of them open
 * the only way to find the dev server was to click through them. Shells tell
 * us more: the window title (OSC 0/2 — "user@host: ~/proj", or the path of the
 * executable on Windows), the working folder (OSC 7, or the OS fallback) and
 * the AI agent running in them (process-tree probe). Pure for unit tests.
 */

export interface TerminalTitleInput {
  /** Last OSC 0/2 window title, "" when the shell never set one. */
  shellTitle: string;
  /** Current working folder, when known. */
  cwd: string | null;
  /** Labels of AI agents running in this terminal ("Claude Code", …). */
  agents?: readonly string[];
  /** Fallback when nothing better is known (localized "Terminal"). */
  fallback: string;
}

const MAX = 32;

/** Titles that only name the shell itself — the folder is more useful. */
const SHELL_NAMES = new Set([
  "windows powershell",
  "powershell",
  "pwsh",
  "command prompt",
  "cmd",
  "bash",
  "zsh",
  "fish",
  "sh",
  "nu",
  "nushell",
  "git bash",
]);

const basename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "") return path.startsWith("/") ? "/" : path;
  if (trimmed === "~") return "~";
  return trimmed.split(/[\\/]/).pop() || trimmed;
};

/** Reduce a raw shell title to something tab-sized; "" when it says nothing. */
export function cleanShellTitle(raw: string): { text: string; isExecutable: boolean } {
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!title) return { text: "", isExecutable: false };
  // "Administrator: C:\Windows\System32\cmd.exe", "C:\Program Files\PowerShell\7\pwsh.exe"
  const exe = /(?:^|[\\/\s:])([^\\/:]+?)\.(?:exe|com|bat|cmd)$/i.exec(title);
  if (exe) return { text: exe[1], isExecutable: true };
  if (SHELL_NAMES.has(title.toLowerCase())) return { text: title, isExecutable: true };
  // "/usr/bin/zsh", "/bin/bash"
  if (/^\/[^\s]*\/[^/\s]+$/.test(title) && /\/(?:s?bin)\//.test(title)) {
    return { text: basename(title), isExecutable: true };
  }
  // bash/zsh default prompts: "user@host: ~/projects/app" → "app"
  const prompt = /^[^@\s]+@[^:\s]+:\s*(.+)$/.exec(title);
  if (prompt) return { text: basename(prompt[1]), isExecutable: false };
  return { text: title, isExecutable: false };
}

const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

export function terminalTitle({ shellTitle, cwd, agents = [], fallback }: TerminalTitleInput): string {
  const shell = cleanShellTitle(shellTitle);
  const dir = cwd ? basename(cwd) : "";
  // A meaningful title from the shell (a prompt's folder, a running program
  // like "vim file.ts" or "htop") wins; a bare executable path loses to the
  // folder, which tells tabs apart better than "pwsh", "pwsh", "pwsh".
  const base = (!shell.isExecutable && shell.text) || dir || shell.text || fallback;
  const agent = agents[0];
  return clip(agent ? `${agent} · ${base}` : base);
}
