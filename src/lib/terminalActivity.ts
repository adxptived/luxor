/** What a terminal is doing, shown as a dot on its tab. */
export type TerminalActivity = "idle" | "running" | "exited" | "failed";

/** Pure mapping from what the terminal panel knows to the tab's activity. */
export function activityOf(exitCode: number | null, foregroundProcesses: number | null): TerminalActivity {
  if (exitCode !== null) return exitCode === 0 ? "exited" : "failed";
  return foregroundProcesses !== null && foregroundProcesses > 1 ? "running" : "idle";
}
