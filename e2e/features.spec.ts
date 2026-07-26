import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp, openCommandPalette } from "./helpers";

test.describe("splitting & layout discoverability", () => {
  test("group header split buttons create new terminals", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    await expect(dockTab(page, "Terminal")).toBeVisible();
    const actions = page.getByTestId("group-actions").first();
    await actions.getByTitle("Split right with a new terminal").click();
    await expect(page.locator(".dv-tab", { hasText: "Terminal" })).toHaveCount(2);
    await actions.getByTitle("Split down with a new terminal").click();
    await expect(page.locator(".dv-tab", { hasText: "Terminal" })).toHaveCount(3);
  });

  test("tab-strip plus adds a terminal; right-click lists all panels", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    await expect(dockTab(page, "Terminal")).toBeVisible();
    const add = page.getByTestId("group-add").first().locator("button");
    // The "+" opens a picker now ("New terminal or panel…") instead of adding a
    // terminal directly, so the terminal has to be chosen from the menu.
    await add.click();
    await page.getByTestId("context-menu").getByText("New terminal").click();
    await expect(page.locator(".dv-tab", { hasText: "Terminal" })).toHaveCount(2);
    await add.click({ button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu.getByText("New terminal")).toBeVisible();
    await menu.getByText("Skills", { exact: true }).click();
    await expect(dockTab(page, "Skills")).toBeVisible();
  });

  test("palette split commands work", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    await openCommandPalette(page);
    const input = page.getByTestId("command-palette").locator("input");
    await input.fill("split right");
    await input.press("Enter");
    await expect(page.locator(".dv-tab", { hasText: "Terminal" })).toHaveCount(2);
  });

  test("tab context menu offers split actions", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "git");
    await dockTab(page, "Git").click({ button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Split right (new terminal)")).toBeVisible();
    await menu.getByText("Split right (new terminal)").click();
    await expect(dockTab(page, "Terminal")).toBeVisible();
  });
});

test.describe("status bar customization", () => {
  test("segments can be toggled from the right-click menu", async ({ page }) => {
    await openApp(page);
    const bar = page.getByTestId("statusbar");
    await bar.click({ button: "right" });
    await page.getByTestId("context-menu").getByText("CPU usage").click();
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
    // Toggle it back on.
    await bar.click({ button: "right" });
    await page.getByTestId("context-menu").getByText("CPU usage").click();
  });
});

test.describe("app zoom", () => {
  test("Ctrl +/- zooms the app and Ctrl+0 resets", async ({ page }) => {
    await openApp(page);
    const zoom = () => page.evaluate(() => document.documentElement.style.zoom || "");
    await page.keyboard.press("Control+=");
    expect(parseFloat(await zoom())).toBeCloseTo(1.1, 5);
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Control+-");
    expect(parseFloat(await zoom())).toBeCloseTo(0.9, 5);
    await page.keyboard.press("Control+0");
    // Factor 1 clears the inline zoom style entirely.
    expect(await zoom()).toBe("");
  });
});

test.describe("IDE launch group", () => {
  test("chevron sits right of the IDE launch icon", async ({ page }) => {
    await openApp(page);

    // The IDE launch group lives in <QuickActions>, which TopBar renders only in
    // side-tab mode (`quickActionsHere = quick_actions === "top" && vertical`).
    // In the default top-tab layout <ChromeQuickActions> renders instead and has
    // no ide-launch/ide-chevron, so this assertion had nothing to measure.
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /^Interface$/ }).click();
    await modal
      .locator("select")
      .filter({ has: page.locator('option[value="side"]') })
      .first()
      .selectOption("side");
    await page.keyboard.press("Escape");

    const chevron = page.getByTestId("ide-chevron");
    await expect(chevron).toBeVisible();
    const chevronBox = await chevron.boundingBox();
    const launchBox = await page.getByTestId("ide-launch").boundingBox();
    expect(chevronBox).toBeTruthy();
    expect(launchBox).toBeTruthy();
    // The chevron follows the launch icon (right of it horizontally, or below
    // it in the vertical sidebar layout) — changed by user request in v0.4.1.
    expect(
      (chevronBox?.x ?? 0) > (launchBox?.x ?? 0) || (chevronBox?.y ?? 0) > (launchBox?.y ?? 0),
    ).toBe(true);
  });
});

test.describe("markdown preview", () => {
  test("opening a .md file shows rendered preview with raw/preview toggle", async ({ page }) => {
    await openApp(page);
    page.on("dialog", (d) => void d.accept("/mock/README.md"));
    await openCommandPalette(page);
    await page.keyboard.type("open file in viewer");
    await page.keyboard.press("Enter");
    // Mock fs_read_text returns markdown; preview is on by default for .md.
    await expect(page.getByTestId("md-preview")).toBeVisible();
    await expect(page.getByTestId("md-preview").locator("h1")).toHaveText("Mock file");
    await page.getByTestId("md-toggle").click();
    await expect(page.getByTestId("md-preview")).toHaveCount(0);
  });
});
