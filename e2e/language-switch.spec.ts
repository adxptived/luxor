import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

/**
 * Regression guard for the audit's P0 finding: `<div key={getLanguage()}>` on the
 * App root remounted the ENTIRE tree whenever the UI language changed. Because
 * TerminalPanel's unmount cleanup calls `ipc.ptyKill(sessionId)`, switching
 * language silently killed every running shell — `cargo watch`, dev servers, any
 * long-lived process — and threw away the dock layout with it.
 *
 * The test asserts *DOM identity*, not just "a terminal is visible": a remount
 * would tear down xterm and build a fresh element, so a marker written onto the
 * live node is the sharpest available signal that no remount happened.
 */
test.describe("UI language switch", () => {
  test("does not remount the tree or destroy running terminals", async ({ page }) => {
    await openApp(page);

    // Two terminals, so the assertion also covers layout preservation.
    await clickNav(page, "terminal");
    await expect(dockTab(page, "Terminal")).toBeVisible();
    const actions = page.getByTestId("group-actions").first();
    await actions.getByTitle("Split right with a new terminal").click();
    await expect(page.locator(".dv-tab", { hasText: "Terminal" })).toHaveCount(2);

    const xterms = page.locator(".xterm");
    await expect(xterms.first()).toBeVisible();
    const countBefore = await xterms.count();
    expect(countBefore).toBeGreaterThan(0);

    // Brand every live xterm node. Survival of these markers == no remount.
    await page.evaluate(() => {
      document
        .querySelectorAll(".xterm")
        .forEach((el, i) => el.setAttribute("data-remount-probe", `probe-${i}`));
    });
    await expect(page.locator("[data-remount-probe]")).toHaveCount(countBefore);

    // Switch English -> Русский through the real settings UI.
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /Interface/i }).click();
    await modal.locator("select").first().selectOption("ru");

    // Wait for the language to actually apply: the section list re-labels itself
    // once the RU dictionary chunk has loaded.
    await expect(modal.getByRole("button", { name: /Интерфейс/ })).toBeVisible();

    await page.keyboard.press("Escape");

    // The markers must still be on the ORIGINAL nodes.
    await expect(page.locator("[data-remount-probe]")).toHaveCount(countBefore);
    // And the layout must be intact.
    await expect(page.locator(".dv-tab", { hasText: /Terminal|Терминал/ })).toHaveCount(2);
  });
});
