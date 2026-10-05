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

import { t } from "@/lib/i18n";
import { useUiStore } from "@/state/uiStore";

const approvedPanels = new Set<string>();

/** Mark a panel id as user-initiated (call at creation time, same tick). */
export function approveAutorun(panelId: string): void {
  approvedPanels.add(panelId);
}

/** True if this panel's autorun was user-initiated in this session. */
export function isAutorunApproved(panelId: string): boolean {
  return approvedPanels.has(panelId);
}

// The app's confirm dialog is a single slot: a second `confirm()` while one is
// open would orphan the first promise. A preset with several autorun terminals
// asks for each, so the prompts are serialised.
let askQueue: Promise<unknown> = Promise.resolve();

/**
 * Gate autorun commands for a terminal panel. Resolves to the commands to run:
 * the original list when trusted/confirmed, or `[]` when the user declined.
 */
export function gateAutorun(panelId: string, commands: string[]): Promise<string[]> {
  if (commands.length === 0 || isAutorunApproved(panelId)) return Promise.resolve(commands);
  const ask = async (): Promise<string[]> => {
    if (isAutorunApproved(panelId)) return commands; // approved while queued
    const ok = await useUiStore.getState().confirm({
      title: t("autorun.title", "Run saved commands in this terminal?"),
      message: `${commands.map((c) => `  ${c}`).join("\n")}\n\n${t(
        "autorun.note",
        "They come from a saved layout or preset, not a direct action.",
      )}`,
      confirmLabel: t("autorun.run", "Run"),
      danger: true,
    });
    if (!ok) return [];
    // Remember the consent so a manual "restart shell" doesn't re-ask.
    approveAutorun(panelId);
    return commands;
  };
  const result = askQueue.then(ask, ask);
  askQueue = result.catch(() => undefined);
  return result;
}
