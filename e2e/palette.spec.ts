import { expect, test } from "@playwright/test";

import { openApp } from "./helpers";

async function openPalette(page: import("@playwright/test").Page) {
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByTestId("command-palette")).toBeVisible();
}

test.describe("command palette fuzzy search", () => {
  test("subsequence query finds and ranks the intuitive command first", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("gexp");
    const palette = page.getByTestId("command-palette");
    const first = palette.getByRole("option").first();
    await expect(first).toContainText("Open explorer");
    await expect(first).toContainText("Git");
  });

  test("multi-word query matches words in any order", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("split layout");
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByRole("option").filter({ hasText: "Split right with new terminal" })).toHaveCount(1);
  });

  test("non-matching query shows the empty state", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("zzzzqqq");
    await expect(page.getByText("No matching commands")).toBeVisible();
  });
});

test.describe("command palette recents", () => {
  test("a run command floats to the top on next open", async ({ page }) => {
    await openApp(page);

    // Run a command via the palette.
    await openPalette(page);
    await page.getByTestId("palette-input").fill("kanban");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tasks-panel")).toBeVisible();

    // Reopen: the command is listed under "Recently used", on top.
    await openPalette(page);
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("Recently used")).toBeVisible();
    // The rest of the list is grouped by category now (Terminal, Git, Files, …)
    // rather than under a single "All commands" heading.
    await expect(palette.getByText("Terminal", { exact: true }).first()).toBeVisible();
    await expect(palette.getByRole("option").first()).toContainText("Open kanban board");
  });

  test("recents survive a reload (persisted)", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("kanban");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tasks-panel")).toBeVisible();

    await page.reload();
    // After a reload the persisted dock layout is restored, so the active tab
    // may be the kanban board instead of the welcome panel — wait for the
    // shell only instead of using openApp().
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page.getByTestId("statusbar")).toBeVisible();
    await openPalette(page);
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByRole("option").first()).toContainText("Open kanban board");
  });

  test("typing a query hides the recents grouping", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("kanban");
    await page.keyboard.press("Enter");
    // Wait for the command to actually run before reopening: the recents entry
    // is written as part of running it, so reopening immediately raced it.
    await expect(page.getByTestId("tasks-panel")).toBeVisible();
    await openPalette(page);
    await expect(page.getByText("Recently used")).toBeVisible();
    await page.getByTestId("palette-input").fill("git");
    await expect(page.getByText("Recently used")).toHaveCount(0);
  });
});
