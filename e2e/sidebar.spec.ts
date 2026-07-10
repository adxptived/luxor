import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

test.describe("nav buttons", () => {
  test("every visible nav button registers a single click", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "git");
    await expect(dockTab(page, "Git")).toBeVisible();
    await clickNav(page, "files");
    await expect(dockTab(page, "Files")).toBeVisible();
    await clickNav(page, "ai");
    await expect(dockTab(page, "AI Center")).toBeVisible();
    await clickNav(page, "settings");
    await expect(page.getByTestId("settings-modal")).toBeVisible();
  });

  test("clicks register immediately after an open dropdown (no swallowed first click)", async ({ page }) => {
    await openApp(page);
    // Open the presets dropdown, then click another nav button directly:
    // the first click must both dismiss the menu AND activate the button.
    await clickNav(page, "presets");
    await expect(page.getByPlaceholder("Save current as…")).toBeVisible();
    await clickNav(page, "git");
    await expect(dockTab(page, "Git")).toBeVisible();
  });

  test("rapid sequential clicks all register", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "git");
    await clickNav(page, "files");
    await clickNav(page, "launcher");
    await expect(dockTab(page, "Git")).toBeVisible();
    await expect(dockTab(page, "Files")).toBeVisible();
    await expect(dockTab(page, "Launcher")).toBeVisible();
  });

  test("right-click menu hides a button and reset restores it", async ({ page }) => {
    await openApp(page);
    await page.locator('[data-nav-id="git"]').click({ button: "right" });
    await page.getByText('Hide "Git" button').click();
    await expect(page.locator('[data-nav-id="git"]')).toHaveCount(0);
    // Restore via reset.
    await page.getByTestId("nav-buttons").click({ button: "right" });
    await page.getByText("Reset buttons to default").click();
    await expect(page.locator('[data-nav-id="git"]')).toBeVisible();
  });

  test("nav buttons can be reordered from Settings", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await modal.getByText("Interface").click();
    await expect(modal.getByText("Sidebar / nav buttons")).toBeVisible();
    // Move "Git" (second by default) up to first place, then save.
    const gitRow = modal.locator("div", { hasText: /^Git$/ }).first();
    await gitRow.getByTitle("Move up").click();
    await modal.getByRole("button", { name: "Save" }).click();
    const ids = await page
      .locator("[data-nav-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(ids[0]).toBe("git");
  });
});
