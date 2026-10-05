import type { AppConfig, UpdateInfo } from "./types";

/** Repository checked for new releases when the user has not set their own. */
export const DEFAULT_UPDATE_REPO = "adxptived/luxor";

/** Effective `owner/repo` for update checks (empty setting = the default). */
export function updateRepo(config: AppConfig | null | undefined): string {
  return config?.ui.update_repo?.trim() || DEFAULT_UPDATE_REPO;
}

/** Toast text + persistent "open release" action for an available update. */
export function updateToast(
  info: UpdateInfo,
  text: string,
  actionLabel: string,
  open: (url: string) => void,
): { text: string; action?: { label: string; run: () => void } } {
  return {
    text: `${text}: ${info.latest}`,
    action: info.html_url ? { label: actionLabel, run: () => open(info.html_url) } : undefined,
  };
}
