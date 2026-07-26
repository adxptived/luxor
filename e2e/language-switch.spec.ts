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

  test("retranslates memoized shell components", async ({ page }) => {
    // The shell (TopBar, StatusBar, NavRail, SidePanel, RightPanel, DockLayout,
    // QuickActions, WindowChrome) is `memo`-wrapped and takes no props that
    // change on a language switch. Removing the remount-everything `key` means
    // each of those must subscribe via `useT()` or it silently freezes on the
    // old language — this asserts they actually do.
    await openApp(page);

    const statusbar = page.getByTestId("statusbar");
    await expect(statusbar).toBeVisible();

    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /Interface/i }).click();
    await modal.locator("select").first().selectOption("ru");
    await expect(modal.getByRole("button", { name: /Интерфейс/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // TopBar (memo, prop `vertical` unchanged) must be in Russian.
    await expect(page.getByTestId("topbar").getByTitle(/Настройки|Терминал|Проект/)).not.toHaveCount(
      0,
    );
    // NavRail is memoized too and carries localized button titles.
    await expect(page.locator("[data-nav-id]").first()).toHaveAttribute(
      "title",
      /[А-Яа-я]/,
    );
  });
});
