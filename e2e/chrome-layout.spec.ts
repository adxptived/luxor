import { expect, test } from "@playwright/test";

import { openApp } from "./helpers";

/** Open N extra blank workspaces through the "+" menu (mock mode has no picker). */
async function addBlankTabs(page: import("@playwright/test").Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.getByTestId("tab-add").click();
    await page.getByTestId("tab-add-menu").getByText("Blank workspace", { exact: true }).click();
  }
}

test.describe("top bar layout", () => {
  /**
   * Regression: the nav-button cluster is `shrink-0`, so with every button
   * visible it squeezed the project tabs into a ~100px slit — narrower than a
   * single tab. Buttons that no longer fit belong in the "⋯" menu instead.
   */
  test("nav buttons never squeeze the project tabs below one tab wide", async ({ page }) => {
    await openApp(page);
    await addBlankTabs(page, 3);

    const strip = page.getByTestId("tab-strip");
    for (const width of [1280, 900, 700]) {
      await page.setViewportSize({ width, height: 700 });
      // Let the capacity measurement settle (rAF + ResizeObserver).
      await expect
        .poll(async () => Math.round((await strip.boundingBox())!.width), { timeout: 5000 })
        .toBeGreaterThanOrEqual(240);

      // One whole project tab always fits inside the visible strip.
      const stripBox = (await strip.boundingBox())!;
      const tabs = await page
        .getByTestId("project-tab")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      const whole = tabs.filter((r) => r.left >= stripBox.x - 1 && r.right <= stripBox.x + stripBox.width + 1);
      expect(whole.length).toBeGreaterThanOrEqual(1);
    }

    // At the narrow end the cluster has handed buttons to the overflow menu.
    await expect(page.getByTestId("nav-more")).toBeVisible();
    await page.getByTestId("nav-more").click();
    await expect(page.getByTestId("context-menu")).toBeVisible();
  });

  /**
   * Regression: the "all tabs" button used to be the tab strip's last child, so
   * it scrolled out of view precisely when the tabs overflowed and it appeared.
   */
  test("the all-tabs button stays reachable while the tabs overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await openApp(page);
    await addBlankTabs(page, 6);

    const more = page.getByTestId("tab-more");
    await expect(more).toBeVisible();
    // Inside the viewport without scrolling anything.
    const box = (await more.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);

    await more.click();
    await expect(page.getByText("All tabs", { exact: true })).toBeVisible();
  });
});

test.describe("status bar", () => {
  /**
   * Regression: the segment row spanned the full bar while the version /
   * right-panel cluster was painted on top of it, so the last segment (the
   * clock, in the default order) was invisible behind "v0.1.1".
   */
  test("no segment is hidden behind the version cluster", async ({ page }) => {
    await openApp(page);
    const bar = page.getByTestId("statusbar");

    // Turn on the segments that are off by default, clock included.
    for (const label of ["Project name", "Clock", "Network throughput", "Ping", "Open tasks"]) {
      await bar.click({ button: "right", position: { x: 400, y: 3 } });
      const item = page.getByTestId("context-menu").getByText(label, { exact: true });
      if (await item.count()) await item.first().click();
      else await page.keyboard.press("Escape");
    }

    const covered = await page.evaluate(() => {
      const barEl = document.querySelector('[data-testid="statusbar"]')!;
      const meta = barEl.querySelector('[data-testid="statusbar-meta"]')!.getBoundingClientRect();
      return [...barEl.querySelectorAll("[data-segment]")]
        .filter((el) => el.getBoundingClientRect().right > meta.left + 1)
        .map((el) => el.getAttribute("data-segment"));
    });
    expect(covered).toEqual([]);
  });

  test("centre alignment stays centred", async ({ page }) => {
    await openApp(page);
    const bar = page.getByTestId("statusbar");
    await bar.click({ button: "right", position: { x: 400, y: 3 } });
    await page.getByTestId("context-menu").getByText("Align center", { exact: true }).click();

    const gaps = await page.evaluate(() => {
      const segs = [...document.querySelectorAll("[data-segment]")];
      const first = segs[0].getBoundingClientRect();
      const last = segs[segs.length - 1].getBoundingClientRect();
      return { left: Math.round(first.left), right: Math.round(window.innerWidth - last.right) };
    });
    // Reserving the cluster width on both sides keeps the centre axis intact.
    expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2);
  });
});

test.describe("overlays on short windows", () => {
  /**
   * Regression: the palette sized its result list against the viewport but not
   * itself, so on a short window it ran past the bottom edge and took the
   * shortcut footer (and the last results) with it.
   */
  for (const height of [480, 380]) {
    test(`the command palette fits a ${height}px-tall window`, async ({ page }) => {
      await page.setViewportSize({ width: 900, height });
      await openApp(page);
      await page.keyboard.press("Control+Shift+P");
      const palette = page.getByTestId("command-palette");
      await expect(palette).toBeVisible();

      const box = (await palette.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      // The footer is the last child and must stay on screen.
      const footerBottom = await palette.evaluate((el) => el.lastElementChild!.getBoundingClientRect().bottom);
      expect(footerBottom).toBeLessThanOrEqual(height + 1);
      // …and the search input keeps its full height instead of being squashed.
      const input = (await page.getByTestId("palette-input").boundingBox())!;
      expect(input.height).toBeGreaterThanOrEqual(40);
    });
  }

  /**
   * Regression: the settings section list had no scroll of its own, so on a
   * short window everything past "Status bar" (Hotkeys, Developer, About) was
   * clipped away with no way to reach it but the search box.
   */
  test("every settings section is reachable on a short window", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 420 });
    await openApp(page);
    await page.keyboard.press("Control+Comma");

    const modal = page.getByTestId("settings-modal");
    await expect(modal).toBeVisible();
    const list = modal.locator("nav .lx-sidebar-scroll");
    await expect
      .poll(async () => list.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);

    await modal.getByRole("button", { name: /^About$/ }).scrollIntoViewIfNeeded();
    await modal.getByRole("button", { name: /^About$/ }).click();
    await expect(modal.getByText("Cockpit for AI-assisted coding")).toBeVisible();
  });
});

test.describe("side panels on small windows", () => {
  /**
   * Regression: below the adaptive breakpoints the panels were force-hidden, so
   * their toggles became dead controls — the button reported "on" while nothing
   * appeared and nothing said why.
   */
  test("the right-panel toggle works on a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 850, height: 700 });
    await openApp(page);

    await page.locator('[data-testid="statusbar"] button[title="Toggle right panel"]').click();
    const panel = page.getByTestId("right-panel");
    await expect(panel).toBeVisible();

    // And it leaves the dock the larger share of a narrow window.
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.width).toBeLessThanOrEqual(850 * 0.35);
  });
});
