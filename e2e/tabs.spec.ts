import { expect, test } from "@playwright/test";

import { openApp } from "./helpers";

/** Regression test for the v0.4.0 "frozen window" bug: after switching
 *  project tabs, the previously active dock must not cover the new one
 *  (it used `visibility`, which dockview re-overrides on inner nodes). */
test.describe("project tab switching", () => {
  test("inactive dock cannot intercept input after switching", async ({ page }) => {
    await openApp(page);

    // Mock mode starts without projects; openApp waited for the Welcome panel.
    const tabs = page.getByTestId("project-tab");
    const docks = page.locator('[data-testid^="dock-"]');
    const initial = await tabs.count();
    const initialDocks = await docks.count();

    // Two extra blank workspaces via the "+" menu (no folder picker in mock mode).
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("tab-add").click();
      await page.getByText("Blank workspace", { exact: true }).click();
    }
    await expect(tabs).toHaveCount(initial + 2);

    // Switch back to the first project.
    await tabs.first().click();

    await expect(docks).toHaveCount(initialDocks + 2);

    // Exactly one dock is interactive; the other must be transparent to input.
    const states = await docks.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return { pe: cs.pointerEvents, op: cs.opacity, z: cs.zIndex };
      }),
    );
    const active = states.filter((s) => s.pe !== "none");
    const inactive = states.filter((s) => s.pe === "none");
    expect(active).toHaveLength(1);
    expect(inactive.length).toBe(states.length - 1);
    expect(Number(active[0].op)).toBe(1);
    for (const s of inactive) {
      expect(Number(s.op)).toBe(0);
      expect(Number(active[0].z)).toBeGreaterThan(Number(s.z));
    }

    // And the active dock actually receives clicks (welcome action works).
    await tabs.nth(1).click();
    await expect(page.getByText("Your cockpit for AI-assisted coding").first()).toBeVisible();
  });
});
