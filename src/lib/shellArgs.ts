/** Parse a command-line argument string into argv-style tokens.
 *
 * This is intentionally small and predictable for Settings UI input, not a full
 * shell language evaluator: it supports whitespace splitting, single/double
 * quotes, and backslash escaping the next character. It never executes or
 * expands variables; it only turns user text into a string array for process
 * spawn options.
 */
export type ShellArgsParseResult =
  | { ok: true; args: string[] }
  | { ok: false; error: string };

export function parseShellArgs(input: string): ShellArgsParseResult {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaping) {
      current += ch;
      tokenStarted = true;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      tokenStarted = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += ch;
    tokenStarted = true;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote) {
    return { ok: false, error: `Unclosed ${quote === '"' ? "double" : "single"} quote in shell arguments.` };
  }
  if (tokenStarted) args.push(current);
  return { ok: true, args };
}

export function formatShellArgs(args: string[]): string {
  return args.map(formatShellArg).join(" ");
}

function formatShellArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"'\\]/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** True when the shell program is a PowerShell executable (name or full path). */
export function isPowerShell(shell: string): boolean {
  const base = (shell.toLowerCase().split(/[\\/]/).pop() ?? shell.toLowerCase()).trim();
  return base === "powershell" || base === "powershell.exe" || base === "pwsh" || base === "pwsh.exe";
}

/** Effective arguments Luxor injects for a new embedded terminal.
 *
 * Mirrors `default_shell_args` in `crates/luxor-core/src/pty.rs` so the Settings
 * preview matches what actually launches: explicit args always win; otherwise
 * PowerShell gets `-NoLogo -NoProfile` (fast start) or just `-NoLogo` (profile
 * mode, which loads the user's PowerShell profile). Non-PowerShell shells get
 * no injected arguments.
 */
export function effectiveShellArgs(
  shell: string,
  configuredArgs: string[],
  fastPowershellStartup: boolean,
): string[] {
  if (configuredArgs.length > 0) return configuredArgs;
  if (!isPowerShell(shell)) return [];
  return fastPowershellStartup ? ["-NoLogo", "-NoProfile"] : ["-NoLogo"];
}
