import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

test.describe("nav buttons", () => {
  test("every visible nav button registers a single click", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "git");
    await expect(dockTab(page, "Git")).toBeVisible();
    await clickNav(page, "files");
    await expect(dockTab(page, "Files")).toBeVisible();
    await clickNav(page, "agents");
    await expect(dockTab(page, "Agents")).toBeVisible();
    await clickNav(page, "settings");
    await expect(page.getByTestId("settings-modal")).toBeVisible();
  });

  test("clicks register immediately after an open dropdown (no swallowed first click)", async ({ page }) => {
    await openApp(page);
    // Open a dropdown, then click a nav button directly: the first click must
    // both dismiss the menu AND activate the button.
    //
    // This used to drive the presets dropdown via `clickNav(page, "presets")`,
    // but that nav action now opens the Launcher panel by design
    // (navActions.ts: `presets: () => openPanel("launcher")`), so no dropdown
    // appeared. The tab-strip "+" menu exercises the same swallowed-click path.
    await page.getByTitle("Add tab").click();
    await expect(page.getByTestId("tab-add-menu")).toBeVisible();
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
    await modal.getByRole("button", { name: /^Interface$/ }).click();
    await expect(modal.getByText("Sidebar / nav buttons")).toBeVisible();
    const navIds = () =>
      page
        .locator("[data-nav-id]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));

    const before = await navIds();
    const gitIndex = before.indexOf("git");
    expect(gitIndex).toBeGreaterThan(0);

    // Addressed by testid: the old `locator("div", { hasText: /^Git$/ })`
    // required a div whose entire text was "Git", but the row also holds a
    // placement <select> and three buttons, so it never matched.
    const gitRow = modal.getByTestId("nav-row-git");
    await gitRow.getByTitle("Move up").click();
    // Settings persist immediately (`set()` calls saveConfig on every patch);
    // there is no longer a Save button to click.
    await page.keyboard.press("Escape");

    // Assert the RELATIVE move rather than "git ends up first": the default
    // order gained `ide` and `filemanager` ahead of git, so one nudge no longer
    // reaches position 0 and the old absolute assertion had silently rotted.
    await expect
      .poll(async () => (await navIds()).indexOf("git"))
      .toBe(gitIndex - 1);
  });
});
