/**
 * Autorun guard (audit fix 2.3).
 *
 * `SpawnOptions.autorun` writes commands straight into the shell when a
 * terminal spawns. That is safe when the USER just clicked "run X" in the
 * launcher/devtools — but layout presets and restored layouts carry autorun
 * in serialized panel params, so opening a cloned repo (or a stale layout)
 * could execute arbitrary commands without consent.
 *
 * The rule: autorun runs silently only for panels created by a direct user
 * action IN THIS SESSION (registered here at creation time). Any other
 * source — preset restore, layout restore, tab reopen — must be confirmed
 * by the user first.
 *
 * The registry is session-scoped and in-memory on purpose: it can never be
 * smuggled in via serialized layout JSON.
 */

const approvedPanels = new Set<string>();

/** Mark a panel id as user-initiated (call at creation time, same tick). */
export function approveAutorun(panelId: string): void {
  approvedPanels.add(panelId);
}

/** True if this panel's autorun was user-initiated in this session. */
export function isAutorunApproved(panelId: string): boolean {
  return approvedPanels.has(panelId);
}

/**
 * Gate autorun commands for a terminal panel. Returns the commands to run:
 * the original list when trusted/confirmed, or `[]` when the user declined.
 */
export function gateAutorun(panelId: string, commands: string[]): string[] {
  if (commands.length === 0) return commands;
  if (isAutorunApproved(panelId)) return commands;
  const ok = window.confirm(
    `This terminal wants to auto-run the following command(s):\n\n${commands
      .map((c) => `  ${c}`)
      .join("\n")}\n\nRun them? (They come from a saved layout/preset, not a direct action.)`,
  );
  if (ok) {
    // Remember the consent so a manual "restart shell" doesn't re-ask.
    approveAutorun(panelId);
    return commands;
  }
  return [];
}
