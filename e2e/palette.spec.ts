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
    await page.getByPlaceholder("Type a command…").fill("gexp");
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByRole("button").first()).toContainText("Git: Open explorer");
  });

  test("multi-word query matches words in any order", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByPlaceholder("Type a command…").fill("split layout");
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("Layout: Split right with new terminal")).toBeVisible();
  });

  test("non-matching query shows the empty state", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByPlaceholder("Type a command…").fill("zzzzqqq");
    await expect(page.getByText("No matching commands.")).toBeVisible();
  });
});

test.describe("command palette recents", () => {
  test("a run command floats to the top on next open", async ({ page }) => {
    await openApp(page);

    // Run a command via the palette.
    await openPalette(page);
    await page.getByPlaceholder("Type a command…").fill("kanban");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tasks-panel")).toBeVisible();

    // Reopen: the command is listed under "Recently used", on top.
    await openPalette(page);
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("Recently used")).toBeVisible();
    await expect(palette.getByText("All commands")).toBeVisible();
    await expect(palette.getByRole("button").first()).toContainText("Tasks: Open kanban board");
  });

  test("recents survive a reload (persisted)", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByPlaceholder("Type a command…").fill("kanban");
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
    await expect(palette.getByRole("button").first()).toContainText("Tasks: Open kanban board");
  });

  test("typing a query hides the recents grouping", async ({ page }) => {
    await openApp(page);
    await openPalette(page);
    await page.getByPlaceholder("Type a command…").fill("kanban");
    await page.keyboard.press("Enter");
    await openPalette(page);
    await expect(page.getByText("Recently used")).toBeVisible();
    await page.getByPlaceholder("Type a command…").fill("git");
    await expect(page.getByText("Recently used")).toHaveCount(0);
  });
});
