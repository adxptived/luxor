/**
 * Quit guard: before the app exits (window close with "keep running in the
 * tray" off, or Quit from the tray) ask the user if that would lose work —
 * unsaved editor changes, or terminals that are running something.
 *
 * The backend only hands the decision to the UI while this guard is installed
 * (`close_guard_set`), so a crashed or still-loading UI can never block exit.
 */

import { dirtyPanelIds } from "@/lib/dirtyGuard";
import { t } from "@/lib/i18n";
import * as ipc from "@/lib/ipc";
import { useUiStore } from "@/state/uiStore";

export const CLOSE_REQUESTED_EVENT = "app:close-requested";

/** Terminals whose shell currently has a child process (a build, a server, an agent). */
export async function busyTerminalCount(): Promise<number> {
  try {
    const sessions = await ipc.ptyList();
    const stats = await Promise.all(
      sessions.map((s) => (s.pid ? ipc.ptyTreeStats(s.pid).catch(() => null) : Promise.resolve(null))),
    );
    return stats.filter((st) => st !== null && st.processes > 1).length;
  } catch {
    return 0;
  }
}

/** Build the confirm text, or `null` when quitting loses nothing. */
export function quitWarning(unsavedFiles: number, busyTerminals: number): string | null {
  const parts: string[] = [];
  if (unsavedFiles > 0) parts.push(`${t("quit.unsaved", "Unsaved files")}: ${unsavedFiles}`);
  if (busyTerminals > 0) parts.push(`${t("quit.busy", "Terminals still running something")}: ${busyTerminals}`);
  return parts.length ? parts.join("\n") : null;
}

async function onCloseRequested(): Promise<void> {
  const warning = quitWarning(dirtyPanelIds().length, await busyTerminalCount());
  if (warning) {
    const ok = await useUiStore.getState().confirm({
      title: t("quit.title", "Quit Luxor?"),
      message: `${warning}\n\n${t("quit.note", "Quitting closes every terminal and discards unsaved changes.")}`,
      confirmLabel: t("quit.confirm", "Quit"),
      danger: true,
    });
    if (!ok) return;
  }
  await ipc.quitApp();
}

/** Install the guard. Returns a disposer. No-op outside Tauri. */
export async function installQuitGuard(): Promise<() => void> {
  if (!ipc.isTauri) return () => {};
  const unlisten = await ipc.listen(CLOSE_REQUESTED_EVENT, () => void onCloseRequested());
  await ipc.closeGuardSet(true).catch(() => {});
  return () => {
    unlisten();
    void ipc.closeGuardSet(false).catch(() => {});
  };
}
