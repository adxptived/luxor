import { expect, test } from "@playwright/test";

import { openApp } from "./helpers";

test.describe("browser-style project tab shortcuts", () => {
  test("Ctrl+Tab and Ctrl+Shift+Tab switch project tabs forward and backward", async ({ page }) => {
    await openApp(page);

    const tabs = page.getByTestId("project-tab");
    const initial = await tabs.count();

    for (let i = 0; i < 2; i++) {
      await page.getByTestId("tab-add").click();
      await page.getByText("Blank workspace", { exact: true }).click();
    }

    await expect(tabs).toHaveCount(initial + 2);
    await expect(tabs.nth(initial + 1)).toHaveClass(/bg-surface/);

    await page.keyboard.press("Control+Tab");
    await expect(tabs.nth(0)).toHaveClass(/bg-surface/);

    await page.keyboard.press("Control+Shift+Tab");
    await expect(tabs.nth(initial + 1)).toHaveClass(/bg-surface/);
  });

  test("Ctrl+Shift+T reopens the most recently closed project tab", async ({ page }) => {
    await openApp(page);

    const tabs = page.getByTestId("project-tab");
    const initial = await tabs.count();
    await page.getByTestId("tab-add").click();
    await page.getByText("Blank workspace", { exact: true }).click();
    await expect(tabs).toHaveCount(initial + 1);

    await tabs.nth(initial).click({ modifiers: ["Shift"] });
    await expect(tabs).toHaveCount(initial);

    await page.keyboard.press("Control+Shift+T");
    await expect(tabs).toHaveCount(initial + 1);
    await expect(tabs.nth(initial)).toHaveClass(/bg-surface/);
  });
});
