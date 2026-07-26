import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp, openCommandPalette } from "./helpers";

test.describe("kanban task board", () => {
  test("opens from the sidebar and shows the seeded board", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "tasks");
    await expect(dockTab(page, "Tasks")).toBeVisible();
    const panel = page.getByTestId("tasks-panel");
    await expect(panel.getByTestId("task-col-backlog")).toBeVisible();
    await expect(panel.getByTestId("task-col-done")).toBeVisible();
    await expect(panel.getByText("Wire up the deploy script")).toBeVisible();
    await expect(panel.getByText("Fix flaky terminal resize")).toBeVisible();
  });

  test("adds a task via the inline composer", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "tasks");
    const todo = page.getByTestId("task-col-todo");
    await todo.getByText("Add task").click();
    await todo.getByPlaceholder("Task title — Enter to add").fill("Write the release notes");
    await page.keyboard.press("Enter");
    await expect(todo.getByText("Write the release notes")).toBeVisible();
  });

  test("moves a task to another column via the context menu", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "tasks");
    const card = page.getByTestId("tasks-panel").getByText("Wire up the deploy script");
    await card.click({ button: "right" });
    await page.getByTestId("context-menu").getByText("Move to Done").click();
    await expect(
      page.getByTestId("task-col-done").getByText("Wire up the deploy script"),
    ).toBeVisible();
  });

  test("opens from the command palette", async ({ page }) => {
    await openApp(page);
    await openCommandPalette(page);
    await page.keyboard.type("kanban");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tasks-panel")).toBeVisible();
  });

  test("filter narrows cards across columns and clears via Esc", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "tasks");
    const panel = page.getByTestId("tasks-panel");
    await expect(panel.getByText("Wire up the deploy script")).toBeVisible();

    const filter = panel.getByTestId("task-filter");
    await filter.fill("flaky");
    await expect(panel.getByText("Fix flaky terminal resize")).toBeVisible();
    await expect(panel.getByText("Wire up the deploy script")).toHaveCount(0);

    // Description text is searched too.
    await filter.fill("deploy script");
    await expect(panel.getByText("Wire up the deploy script")).toBeVisible();

    // Esc clears the filter (and does not bubble into other popups).
    await filter.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(panel.getByText("Fix flaky terminal resize")).toBeVisible();
    await expect(panel.getByText("Wire up the deploy script")).toBeVisible();
  });
});

test.describe("skills panel", () => {
  test("opens from the sidebar with manager and market tabs", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "skills");
    await expect(dockTab(page, "Skills")).toBeVisible();
    const panel = page.getByTestId("skills-panel");
    // No project in mock mode -> manager shows a hint.
    await expect(panel.getByText("Open a project folder", { exact: false })).toBeVisible();
    // Market tab lists the catalog from the mock IPC.
    await panel.getByRole("button", { name: "Market" }).click();
    await expect(panel.getByTestId("skills-market")).toBeVisible();
    await expect(panel.getByText("find-skills")).toBeVisible();
    await expect(panel.getByText("frontend-design")).toBeVisible();
    await expect(panel.getByText("vercel-labs/skills", { exact: false }).first()).toBeVisible();
  });

  test("market catalog can be filtered", async ({ page }) => {
    await openApp(page);
    await clickNav(page, "skills");
    const panel = page.getByTestId("skills-panel");
    await panel.getByRole("button", { name: "Market" }).click();
    await panel.getByPlaceholder("Search all of skills.sh…").fill("frontend");
    await expect(panel.getByText("frontend-design")).toBeVisible();
    await expect(panel.getByText("find-skills")).toHaveCount(0);
  });
});
