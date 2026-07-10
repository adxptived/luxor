/**
 * Central registry of every localStorage key used by Luxor (audit 5.4).
 *
 * Rules:
 *  - Every persisted key MUST be listed here, with its schema version.
 *  - Bump `version` when the stored shape changes, and register a migrator
 *    in `stateMigration.ts` for the old→new step.
 *  - New code should read/write via `loadState`/`saveState` (versioned
 *    envelope + migrations) or, for trivial scalar flags, `safeParse`.
 *
 * The unit test in `storageKeys.test.ts` greps the source tree and fails when
 * a key is used in code but missing here — keeping this list honest.
 */

export interface StorageKeySpec {
  /** The literal localStorage key. */
  key: string;
  /** Schema version of the stored value (1 = initial shape). */
  version: number;
  /** What the value holds, for maintainers. */
  description: string;
}

export const STORAGE_KEYS: readonly StorageKeySpec[] = [
  // App-level flags
  { key: "luxor.updateCheckDone", version: 1, description: "Session flag: update check already ran" },
  { key: "luxor.navDefaultsV2", version: 2, description: "One-shot flag: v2 nav defaults applied" },
  { key: "luxor.onboarding", version: 1, description: "Onboarding step progress" },
  { key: "luxor.onboarding.completed", version: 1, description: "Onboarding finished flag" },

  // Editor preferences
  { key: "luxor.editor.fontSize", version: 1, description: "Editor font size (number)" },
  { key: "luxor.editor.wordWrap", version: 1, description: "Editor word wrap (boolean)" },
  { key: "luxor.editor.renderWhitespace", version: 1, description: "Editor whitespace rendering (boolean)" },

  // Panel state
  { key: "luxor.files.showHidden", version: 1, description: "Files panel: show hidden files" },
  { key: "luxor.dbSqlHistory", version: 1, description: "DB panel: SQL query history" },
  { key: "luxor.httpHistory", version: 1, description: "HTTP panel: request history" },
  { key: "luxor.httpBlockPrivate", version: 1, description: "HTTP panel: SSRF guard toggle ('0'/'1')" },
  { key: "luxor.skills.lastInstallTarget", version: 1, description: "Skills panel: last install target" },
  { key: "luxor.skills.favorites", version: 1, description: "Skills panel: favorite skill ids" },
  { key: "luxor.rightPanel.notes", version: 1, description: "Right panel: scratch notes text" },
  { key: "luxor.settingsScale", version: 1, description: "Settings modal: window scale factor (number)" },

  // Stores (versioned via stateMigration envelopes where suffixed .vN)
  { key: "luxor.activeProject", version: 1, description: "Active project id" },
  { key: "luxor.tabGroups.v1", version: 1, description: "Tab groups store state" },
  { key: "luxor.focusTimer.v1", version: 1, description: "Focus timer store state" },
  { key: "luxor.searchHistory.v1", version: 1, description: "Search panel query history" },
  { key: "luxor.terminalSessions", version: 1, description: "Terminal session restore data" },
  { key: "luxor.cmdHistory", version: 1, description: "Terminal command history" },
  { key: "luxor.paletteRecents", version: 1, description: "Command palette recent actions" },
  { key: "luxor.activity-log", version: 1, description: "Activity log entries" },
  { key: "luxor.modelRoutes", version: 1, description: "Agent router model routes" },
  { key: "luxor.settingsProfiles", version: 1, description: "Saved settings profiles" },
  { key: "luxor.shellProfiles", version: 1, description: "Saved shell profiles" },

  // Window / layout
  { key: "luxor.compactMode", version: 1, description: "Compact window mode flag" },
  { key: "luxor.windows", version: 1, description: "Auxiliary window positions" },
  { key: "luxor.browserMode", version: 1, description: "Browser panel mode preference" },
  { key: "luxor.browserSession", version: 1, description: "Browser panel last URL and history (survives panel re-mounts)" },
  { key: "luxor.statusBarAlign", version: 1, description: "Status bar alignment preference" },

  // Analytics / telemetry
  { key: "luxor.discord.settings", version: 1, description: "Discord webhook settings" },
  { key: "luxor.telemetry.prefs", version: 1, description: "Telemetry opt-in preferences" },
] as const;

/** Fast lookup of a spec by key. */
export function storageKeySpec(key: string): StorageKeySpec | undefined {
  return STORAGE_KEYS.find((s) => s.key === key);
}
