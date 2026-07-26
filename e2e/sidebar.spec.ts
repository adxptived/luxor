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

  /**
   * Regression: in side-tab mode the vertical sidebar stacks the project tab
   * strip above the nav-button stack. The strip scrolls, so its automatic
   * minimum height is 0 — and the nav stack used to be unbounded, so every
   * button moved into the sidebar stole height from the tabs until they
   * collapsed to nothing and the projects became unreachable.
   */
  test("a full nav stack cannot squeeze the project tabs out of the sidebar", async ({ page }) => {
    await openApp(page);

    // Mock mode starts without projects — add two so the strip has content.
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("tab-add").click();
      await page.getByTestId("tab-add-menu").getByText("Blank workspace", { exact: true }).click();
    }

    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await modal.getByRole("button", { name: /^Appearance$/ }).click();
    // The "Project tabs" position select — the only top/side one without a
    // "hidden" option (that one is the quick-actions placement).
    await modal
      .locator('select:has(option[value="side"]):not(:has(option[value="hidden"]))')
      .selectOption("side");
    await page.keyboard.press("Escape");

    // Side-tab mode puts every visible nav button into the sidebar.
    const sidebar = page.getByTestId("topbar");
    const strip = page.getByTestId("tab-strip");
    const navStack = page.getByTestId("nav-buttons");
    await expect(page.getByTestId("project-tab").first()).toBeVisible();

    const sidebarBox = (await sidebar.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    const navBox = (await navStack.boundingBox())!;
    // Nav stack capped at 45%, so the tabs always keep the majority.
    expect(navBox.height).toBeLessThanOrEqual(sidebarBox.height * 0.46);
    expect(stripBox.height).toBeGreaterThan(sidebarBox.height * 0.5);
    // And nothing is clipped away: the stack scrolls instead.
    const scrollable = await navStack.evaluate((el) => el.scrollHeight > el.clientHeight);
    const overflow = await navStack.evaluate((el) => getComputedStyle(el).overflowY);
    expect(scrollable).toBe(true);
    expect(overflow).toBe("auto");
  });

  /**
   * Regression: the left icon rail had no overflow handling, so on a short
   * window every icon past the bottom edge was clipped and unreachable.
   */
  test("icon rail moves the icons that do not fit into a ⋯ menu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await openApp(page);

    // Move every nav button into the left rail.
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await modal.getByRole("button", { name: /^Interface$/ }).click();
    const rows = modal.locator('[data-testid^="nav-row-"]');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await rows.nth(i).locator("select").selectOption("sidebar");
    }
    await page.keyboard.press("Escape");

    const rail = page.getByTestId("nav-rail");
    const more = page.getByTestId("nav-rail-more");
    await expect(more).toBeVisible();

    // Every rendered icon stays inside the rail — nothing is cut off.
    const railBox = (await rail.boundingBox())!;
    const iconBottoms = await rail
      .locator("button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
    for (const bottom of iconBottoms) {
      expect(bottom).toBeLessThanOrEqual(railBox.y + railBox.height + 1);
    }

    // The overflow menu reaches the buttons that were left out.
    await more.click();
    await expect(page.getByTestId("context-menu")).toBeVisible();
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
