import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

test.describe("activity log", () => {
  test("opens from the sidebar and records toasts", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "activity");
    await expect(dockTab(page, "Activity")).toBeVisible();
    await expect(page.getByTestId("activity-panel")).toBeVisible();

    // Trigger a toast (zoom reset writes one) and expect it in the log.
    await page.keyboard.press("Control+Equal");
    await expect(page.getByTestId("activity-item").first()).toBeVisible();
    await expect(
      page.getByTestId("activity-panel").getByText("Zoom", { exact: false }).first(),
    ).toBeVisible();
  });

  test("filter and clear work", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+Equal"); // produce at least one event
    await clickNav(page, "activity");
    const panel = page.getByTestId("activity-panel");
    await expect(panel.getByTestId("activity-item").first()).toBeVisible();

    await panel.getByPlaceholder("Filter activity…").fill("no-such-event-zzz");
    await expect(panel.getByText("No events match the current filter.")).toBeVisible();
    await panel.getByPlaceholder("Filter activity…").fill("");

    await panel.getByText("Clear", { exact: true }).click();
    await expect(panel.getByText("Nothing logged yet", { exact: false })).toBeVisible();
  });

  test("opens from the command palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+Shift+KeyP");
    await page.getByTestId("palette-input").fill("activity");
    await page.getByText("Activity: Open activity log").click();
    await expect(page.getByTestId("activity-panel")).toBeVisible();
  });
});

test.describe("status bar AI agents segment", () => {
  test("shows the mock agents with usage totals", async ({ page }) => {
    await openApp(page);
    const seg = page.getByTestId("status-agents");
    await expect(seg).toBeVisible();
    await expect(seg).toContainText("3 agents"); // 2× Claude Code + 1× Codex CLI
    await expect(seg).toContainText("%");
  });
});

test.describe("git blame tab", () => {
  test("blames a file with mock data", async ({ page }) => {
    await openApp(page);
    // Add a folder-backed project (mock pickDirectory uses window.prompt).
    page.on("dialog", (d) => void d.accept("/mock/repo"));
    await page.getByTestId("tab-add").click();
    await page.getByText("Open folder…").click();
    await clickNav(page, "git");
    await expect(dockTab(page, "Git")).toBeVisible();
    await page.getByRole("button", { name: "blame", exact: true }).click();

    const view = page.getByTestId("blame-view");
    await expect(view).toBeVisible();
    await view.getByTestId("blame-file-input").fill("README.md");
    await view.getByRole("button", { name: "Blame", exact: true }).click();

    await expect(view.getByText("Ada Lovelace").first()).toBeVisible();
    await expect(view.getByText("Grace Hopper").first()).toBeVisible();
    await expect(view.getByTestId("blame-line").first()).toContainText("aaaaaaa");
  });
});

test.describe("terminal CPU/RAM badge", () => {
  test("shows mock process-tree stats on a terminal", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "terminal");
    const badge = page.getByTestId("terminal-stats");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("3%"); // 2.5% rounded
    await expect(badge).toContainText("86M");
  });
});

test.describe("settings additions", () => {
  test("search finds the new toggles", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "settings");
    const modal = page.getByTestId("settings-modal");
    const search = modal.getByPlaceholder("Search…");

    await search.fill("minimap");
    await expect(modal.getByText("Editor minimap").first()).toBeVisible();

    await search.fill("bell");
    await expect(modal.getByText("Bell notifications").first()).toBeVisible();

    await search.fill("badge");
    await expect(modal.getByText("CPU / RAM badge").first()).toBeVisible();
  });
});
