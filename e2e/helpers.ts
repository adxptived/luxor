import { expect, type Page } from "@playwright/test";

/**
 * Load the app and wait until the dock UI is interactive.
 *
 * Onboarding is marked complete BEFORE the first script runs. The first-run tour
 * renders a full-window `inset-0` modal overlay, which intercepts pointer events
 * and made every `clickNav()` in the suite time out — the whole e2e suite had
 * been failing since the tour landed. Tests that want to exercise the tour
 * itself should call `openApp(page, { onboarding: true })`.
 */
export async function openApp(page: Page, opts: { onboarding?: boolean } = {}): Promise<void> {
  if (!opts.onboarding) {
    await page.addInitScript(() => {
      // Must be the literal "true": onboarding.ts compares
      // `localStorage.getItem(COMPLETED_KEY) === "true"`.
      window.localStorage.setItem("luxor.onboarding.completed", "true");
      // Skip the one-time "v2 nav defaults" migration, which collapses the nav
      // to terminal/git/files/settings and hides the other ten buttons. The
      // suite drives panels through `clickNav`, so without this every
      // `[data-nav-id="skills|agents|analytics|…"]` locator waits forever.
      // Setting the latch leaves `nav_hidden` empty, i.e. all buttons visible.
      window.localStorage.setItem("luxor.navDefaultsV2", "1");
    });
  }
  await page.goto("/");
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("statusbar")).toBeVisible();
  // Welcome panel is the default dock content in browser/mock mode.
  await expect(page.getByText("A desktop cockpit for code", { exact: false })).toBeVisible();
}

/** Click a sidebar/topbar nav button by its id (terminal, git, files, …). */
export async function clickNav(page: Page, id: string): Promise<void> {
  await page.locator(`[data-nav-id="${id}"]`).click();
}

/** Locator for a dockview panel tab with the given title. */
export function dockTab(page: Page, title: string) {
  return page.locator(".dv-tab", { hasText: title }).first();
}

/**
 * Open the command palette and wait until it can accept input.
 *
 * `CommandPalette` is `lazy()`-loaded, so on first open the chunk may still be
 * in flight when the chord fires. Several specs pressed Ctrl+Shift+P and typed
 * immediately, which dropped the keystrokes onto nothing and produced failures
 * that looked like broken commands.
 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByTestId("palette-input")).toBeVisible();
}
