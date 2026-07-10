/**
 * Terminal shell profiles.
 *
 * Named presets for shell environments: shell binary, args, env vars,
 * working directory, and display label. Stored in localStorage so they
 * survive reloads and are independent of the Rust config.
 */

export interface ShellProfile {
  id: string;
  name: string;
  /** Shell binary path (e.g. "/bin/zsh", "powershell.exe"). */
  shell: string;
  /** Extra args to pass to the shell. */
  args: string[];
  /** Environment variables to set. */
  env: Record<string, string>;
  /** Working directory (empty = project root). */
  cwd: string;
  /** Icon name from lucide. */
  icon: string;
}

const STORAGE_KEY = "luxor.shellProfiles";

/** Default profiles for common shells. */
export function defaultProfiles(): ShellProfile[] {
  const isWin = typeof navigator !== "undefined" && /win/i.test(navigator.platform);
  if (isWin) {
    return [
      { id: "pwsh", name: "PowerShell", shell: "powershell.exe", args: ["-NoLogo"], env: {}, cwd: "", icon: "SquareTerminal" },
      { id: "cmd", name: "Command Prompt", shell: "cmd.exe", args: [], env: {}, cwd: "", icon: "SquareTerminal" },
      { id: "gitbash", name: "Git Bash", shell: "bash", args: ["-i"], env: {}, cwd: "", icon: "SquareTerminal" },
    ];
  }
  return [
    { id: "bash", name: "Bash", shell: "/bin/bash", args: ["-i"], env: {}, cwd: "", icon: "SquareTerminal" },
    { id: "zsh", name: "Zsh", shell: "/bin/zsh", args: ["-i"], env: {}, cwd: "", icon: "SquareTerminal" },
    { id: "fish", name: "Fish", shell: "/usr/bin/fish", args: ["-i"], env: {}, cwd: "", icon: "SquareTerminal" },
  ];
}

/** Load saved profiles, merging with defaults. */
export function loadProfiles(): ShellProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfiles();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultProfiles();
    return parsed.filter((p): p is ShellProfile =>
      typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.shell === "string",
    );
  } catch {
    return defaultProfiles();
  }
}

/** Save profiles to localStorage. */
export function saveProfiles(profiles: ShellProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch { /* best effort */ }
}

/** Generate a unique profile id. */
export function newProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}