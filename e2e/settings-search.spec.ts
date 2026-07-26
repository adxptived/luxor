import { expect, test } from "@playwright/test";

import { clickNav, openApp } from "./helpers";

test.describe("settings content search", () => {
  test("finds individual settings, not just section names", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();

    // "scrollback" is a Terminal *setting*, not a section name.
    await modal.getByPlaceholder("Search settings…").fill("scrollback");
    await expect(modal.getByRole("button", { name: /Terminal/ })).toBeVisible();
    await expect(page.getByTestId("settings-hit-terminal")).toContainText("Scrollback");
    // Non-matching sections are hidden.
    await expect(modal.getByRole("button", { name: /^Git$/ })).toHaveCount(0);

    // Garbage query → friendly empty state.
    await modal.getByPlaceholder("Search settings…").fill("zzzznothing");
    await expect(modal.getByText("No settings match")).toBeVisible();
  });

  test("export/import buttons live in Appearance", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await expect(modal.getByTestId("settings-export")).toBeVisible();
    await expect(modal.getByTestId("settings-import")).toBeVisible();
  });
});
