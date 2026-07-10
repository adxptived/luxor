import { expect, test } from "@playwright/test";

import { clickNav, openApp } from "./helpers";

test.describe("blank workspace folder CTA", () => {
  test("panels without a folder offer to attach one", async ({ page }) => {
    await openApp(page);
    // Create a blank workspace (no folder attached).
    await page.getByTestId("tab-add").click();
    await page.getByTestId("topbar").getByRole("button", { name: "Blank workspace" }).click();

    // Files panel shows the CTA instead of a dead-end message.
    await clickNav(page, "files");
    const cta = page.getByTestId("no-folder-cta").first();
    await expect(cta).toBeVisible();
    await expect(cta.getByText("This workspace has no folder")).toBeVisible();
    await expect(cta.getByRole("button", { name: /Choose folder/ })).toBeVisible();

    // Attaching a folder via the manual path field swaps in the file tree.
    await cta.getByPlaceholder(/paste a path/).fill("/tmp");
    await cta.getByPlaceholder(/paste a path/).press("Enter");
    await expect(page.getByTestId("no-folder-cta")).toHaveCount(0);
  });
});
