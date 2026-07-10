import { test, expect } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Regression: the inline `#splash` overlay (index.html) is a full-window,
 * z-index:9999 cover. Its teardown used to be nested inside the Tauri-only
 * startup-telemetry block AND gated on a *successful* config load, so a failed
 * `get_config` (or a non-Tauri context) left the spinner covering the whole
 * app forever — the file editor worked but was invisible and unclickable
 * behind it. The splash must always come down once the shell is up.
 */
test.describe("splash teardown", () => {
  test("splash overlay is removed so the UI is reachable", async ({ page }) => {
    await openApp(page);
    // Removed shortly after the shell paints (config load OR fallback timeout).
    await expect.poll(
      () => page.evaluate(() => !document.getElementById("splash")),
      { timeout: 8_000 },
    ).toBe(true);
  });

  test("editor opened from the palette is visible and interactive", async ({ page }) => {
    await openApp(page);
    page.on("dialog", (d) => void d.accept("/mock/foo.ts"));
    await page.keyboard.press("F1");
    await page.getByTestId("command-palette").waitFor();
    await page.keyboard.type("open file in viewer");
    await page.keyboard.press("Enter");

    const cm = page.locator(".cm-editor").first();
    await expect(cm).toBeVisible({ timeout: 10_000 });
    const box = await cm.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(20);

    // Prove it is interactive (not covered by an overlay): click + type.
    await page.locator(".cm-content").first().click();
    await page.keyboard.type("ZZZ");
    await expect(page.locator(".cm-content").first()).toContainText("ZZZ");
  });

  test("markdown preview→source renders the text layer (not just the gutter)", async ({ page }) => {
    // The editor mounts inside the hidden (display:none) preview wrapper, so CM
    // must re-measure when switched to source or the text stays blank while the
    // line-number gutter shows ("line numbers but no text").
    await openApp(page);
    page.on("dialog", (d) => void d.accept("/mock/README.md"));
    await page.keyboard.press("F1");
    await page.getByTestId("command-palette").waitFor();
    await page.keyboard.type("open file in viewer");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("md-preview")).toBeVisible();
    await page.getByTestId("md-toggle").click();
    await expect(page.getByTestId("md-preview")).toHaveCount(0);

    const content = page.locator(".cm-content").first();
    await expect(content).toBeVisible({ timeout: 10_000 });
    await expect(content).toContainText("Mock file");
    const box = await content.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(8);
  });
});
