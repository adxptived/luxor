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
