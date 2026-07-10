/**
 * Smoke tests: every dockable panel opens from the nav and renders without
 * crashing (audit 7.2). A crash is detected via the PanelErrorBoundary
 * fallback (`data-testid="panel-crashed"`), which catches render errors of
 * the panel component itself.
 *
 * Deeper interaction coverage for the complex panels (Files, Git, Search,
 * kanban, skills) lives in panels.spec.ts / features.spec.ts — this file
 * guarantees the baseline "opens and renders" invariant for ALL of them.
 */
import { expect, test } from "@playwright/test";

import { clickNav, dockTab, openApp } from "./helpers";

/** Nav id -> expected dock tab title (from PANEL_TITLES / NAV_BUTTONS). */
const PANELS: Array<{ nav: string; tab: string }> = [
  { nav: "terminal", tab: "Terminal" },
  { nav: "git", tab: "Git" },
  { nav: "files", tab: "Files" },
  { nav: "launcher", tab: "Launcher" },
  { nav: "tasks", tab: "Tasks" },
  { nav: "skills", tab: "Skills" },
  { nav: "agents", tab: "AI Agents" },
  { nav: "activity", tab: "Activity" },
  { nav: "analytics", tab: "Analytics" },
  { nav: "search", tab: "Search" },
  { nav: "snippets", tab: "Snippets" },
  { nav: "http", tab: "HTTP Client" },
  { nav: "docker", tab: "Docker" },
  { nav: "devtools", tab: "Dev Tools" },
  { nav: "github", tab: "GitHub" },
];

test.describe("panel smoke tests", () => {
  for (const { nav, tab } of PANELS) {
    test(`${nav} panel opens and renders without crashing`, async ({ page }) => {
      await openApp(page);
      await clickNav(page, nav);
      await expect(dockTab(page, tab)).toBeVisible();
      // The error boundary fallback must NOT be present anywhere in the dock.
      await expect(page.getByTestId("panel-crashed")).toHaveCount(0);
    });
  }

  test("opening every panel in sequence keeps the app alive", async ({ page }) => {
    await openApp(page);
    for (const { nav } of PANELS) {
      await clickNav(page, nav);
    }
    await expect(page.getByTestId("panel-crashed")).toHaveCount(0);
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page.getByTestId("statusbar")).toBeVisible();
  });
});
