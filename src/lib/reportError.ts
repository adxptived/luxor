import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";

/**
 * `.catch(reportError("Open in file manager"))` — surface a failed user action
 * as an error toast instead of swallowing it ("I clicked and nothing happened").
 * Background polling should keep its quiet `.catch(() => {})`; this is for
 * things the user explicitly asked for. `key` coalesces repeats (autosave loops).
 */
export const reportError =
  (what: string, key?: string) =>
  (e: unknown): void => {
    useAppStore.getState().toast(`${what}: ${errorMessage(e)}`, "error", key);
  };
