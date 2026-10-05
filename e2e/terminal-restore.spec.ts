import { expect, test, type Page } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

/** Saved terminal snapshots (`luxor.term.*`) currently in localStorage. */
async function snapshots(page: Page): Promise<Record<string, { draft: string; data: string }>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("luxor.term."))
        .map((k) => [k, JSON.parse(localStorage.getItem(k) as string)]),
    ),
  );
}

test.describe("terminal restore", () => {
  test("the unsent input line is saved, and removed when the terminal is closed", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    await expect(dockTab(page, "Terminal")).toBeVisible();

    await page.locator(".xterm-helper-textarea").first().focus();
    await page.keyboard.type("git sta");

    // Saved on a short throttle, without needing an Enter or a reload.
    await expect.poll(async () => Object.values(await snapshots(page)).map((s) => s.draft), { timeout: 8000 }).toEqual(["git sta"]);

    await dockTab(page, "Terminal").getByRole("button").first().click();
    await expect.poll(async () => Object.keys(await snapshots(page)), { timeout: 5000 }).toEqual([]);
  });

  test("turning the Settings toggle off deletes what was saved", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    await page.locator(".xterm-helper-textarea").first().focus();
    await page.keyboard.type("ls");
    await expect.poll(async () => Object.keys(await snapshots(page)).length, { timeout: 8000 }).toBe(1);

    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Terminal", exact: true }).first().click();
    await page.getByText("Restore terminals on startup").waitFor();
    await page.locator("div", { hasText: /^Restore terminals on startup/ }).last().getByRole("switch").click();

    expect(await snapshots(page)).toEqual({});
    expect(await page.evaluate(() => localStorage.getItem("luxor.terminalRestore"))).toBe("0");
  });
});
