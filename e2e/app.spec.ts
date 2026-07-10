import { expect, test } from "@playwright/test";

import { openApp } from "./helpers";

test.describe("app shell", () => {
  test("loads the welcome screen with discoverability tips", async ({ page }) => {
    await openApp(page);
    await expect(page.getByText("Luxor").first()).toBeVisible();
    await expect(page.getByText("Tips")).toBeVisible();
    await expect(page.getByText("built-in DB viewer", { exact: false })).toBeVisible();
    await expect(page.getByText("split the layout", { exact: false })).toBeVisible();
  });

  test("status bar shows default segments", async ({ page }) => {
    await openApp(page);
    const bar = page.getByTestId("statusbar");
    await expect(bar.getByText("no project")).toBeVisible();
    await expect(bar.getByTitle("CPU usage")).toBeVisible();
  });

  test("no unexpected console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await openApp(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});
