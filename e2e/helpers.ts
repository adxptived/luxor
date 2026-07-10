import { expect, type Page } from "@playwright/test";

/** Load the app and wait until the dock UI is interactive. */
export async function openApp(page: Page): Promise<void> {
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
