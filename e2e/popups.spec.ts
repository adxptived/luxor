import { expect, test } from "@playwright/test";

import { clickNav, openApp } from "./helpers";

test.describe("popup dismissal (Esc + outside click)", () => {
  test("settings closes on Esc and on outside click", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "settings");
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-modal")).toHaveCount(0);

    await clickNav(page, "settings");
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await page.mouse.click(5, 300); // outside the modal
    await expect(page.getByTestId("settings-modal")).toHaveCount(0);
  });

  test("command palette opens with Ctrl+Shift+P, runs commands, closes on Esc", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+Shift+KeyP");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);

    // Run a command end-to-end.
    await page.keyboard.press("Control+Shift+KeyP");
    await page.keyboard.type("git: open");
    await page.keyboard.press("Enter");
    await expect(page.locator(".dv-tab", { hasText: "Git" }).first()).toBeVisible();
  });

  test("context menu closes on Esc and on outside click", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("statusbar").click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);

    await page.getByTestId("statusbar").click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.mouse.click(400, 200);
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
  });

  test("prompt dialog closes on Esc", async ({ page }) => {
    await openApp(page);
    // The palette's "Layout: Save as preset…" opens an internal prompt dialog.
    await page.keyboard.press("Control+Shift+KeyP");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.type("save as preset");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Preset name")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Preset name")).toHaveCount(0);
  });
});
