import { expect, test, type Page } from "@playwright/test";

import { openApp } from "./helpers";

/** Path served by the mock backend's demo project (src/lib/ipcMockFs.ts). */
const DEMO = "/home/dev/aurora-shop";

async function openDemoProject(page: Page): Promise<void> {
  page.on("dialog", (d) => void d.accept(DEMO));
  await page.getByTestId("tab-add").click();
  await page.getByText("Open folder…").click();
  await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
}

const tree = (page: Page) => page.getByTestId("files-sidebar").getByRole("tree");
const row = (page: Page, name: string) =>
  tree(page).getByRole("treeitem").filter({ has: page.getByText(name, { exact: true }) }).first();
const tab = (page: Page, title: string) => page.locator(".dv-tab", { hasText: title }).first();

/**
 * Terminal output as the restore snapshot saw it (xterm draws on a WebGL
 * canvas, so the DOM has no text to read). Saved on a ~2.5 s throttle.
 */
async function terminalText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("luxor.term."))
      .map((k) => (JSON.parse(localStorage.getItem(k) as string) as { data?: string }).data ?? "")
      .join("\n"),
  );
}

test.describe("workbench: explorer side bar", () => {
  test("a project opens with its file tree beside an empty editor area", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await expect(row(page, "README.md")).toBeVisible();
    await expect(row(page, "src")).toBeVisible();
    // The editor area teaches the core shortcuts instead of showing a void.
    await expect(page.getByTestId("empty-dock-shortcuts")).toBeVisible();
    // Folders before files, git changes marked.
    await row(page, "src").click();
    await expect(row(page, "App.tsx")).toBeVisible();
  });

  test("single click previews a file; double click keeps the tab", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await row(page, "README.md").click();
    await expect(tab(page, "README.md")).toBeVisible();
    await expect(tab(page, "README.md").locator("[data-preview]")).toHaveCount(1);

    // The next single click replaces the preview tab…
    await row(page, "package.json").click();
    await expect(tab(page, "package.json")).toBeVisible();
    await expect(page.locator(".dv-tab", { hasText: "README.md" })).toHaveCount(0);

    // …and a double click pins it.
    await row(page, "package.json").dblclick();
    await expect(tab(page, "package.json").locator("[data-preview]")).toHaveCount(0);
    await row(page, "tsconfig.json").click();
    await expect(tab(page, "package.json")).toBeVisible();
    await expect(tab(page, "tsconfig.json")).toBeVisible();
  });

  test("Ctrl+B hides and shows the side bar", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await page.keyboard.press("Control+KeyB");
    await expect(page.getByTestId("workbench-sidebar")).toHaveCount(0);
    await page.getByTestId("statusbar-toggle-sidebar").click();
    await expect(page.getByTestId("workbench-sidebar")).toBeVisible();
  });

  test("a new file is named inline and opens in the editor", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await page.getByTestId("files-new-file").click();
    const input = page.getByTestId("files-inline-input");
    await expect(input).toBeVisible();
    await input.fill("notes.md");
    await input.press("Enter");
    await expect(row(page, "notes.md")).toBeVisible();
    await expect(tab(page, "notes.md")).toBeVisible();
  });

  test("F2 renames inline", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await row(page, "README.md").click({ button: "right" });
    await page.getByTestId("context-menu").getByText("Rename…").click();
    const input = page.getByTestId("files-inline-input");
    await expect(input).toHaveValue("README.md");
    await input.fill("GUIDE.md");
    await input.press("Enter");
    await expect(row(page, "GUIDE.md")).toBeVisible();
    await expect(tree(page).getByText("README.md", { exact: true })).toHaveCount(0);
  });

  test("the search view finds text across the project", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await page.getByTestId("sidebar-tab-search").click();
    const box = page.getByTestId("workbench-sidebar").locator("input").first();
    await box.fill("formatPrice");
    await box.press("Enter");
    await expect(page.getByTestId("workbench-sidebar").getByText("Cart.tsx").first()).toBeVisible();
  });
});

test.describe("workbench: terminal panel", () => {
  test("Ctrl+` opens a terminal below the editor and toggles it", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await row(page, "README.md").dblclick();
    await expect(tab(page, "README.md")).toBeVisible();

    await page.keyboard.press("Control+Backquote");
    const xterm = page.locator(".xterm").first();
    await expect(xterm).toBeVisible();
    // The browser mock runs a tiny simulated shell; its OSC title names the tab.
    await expect(tab(page, "aurora-shop")).toBeVisible({ timeout: 10_000 });
    const panel = page.getByTestId("statusbar-toggle-panel");
    await expect(panel).toHaveAttribute("aria-pressed", "true");

    // The terminal sits in its own group, not between the editor tabs.
    const editorBox = await tab(page, "README.md").boundingBox();
    const termBox = await xterm.boundingBox();
    expect(termBox!.y).toBeGreaterThan(editorBox!.y + 40);

    // Focused terminal + Ctrl+` → hidden; again → back.
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveAttribute("aria-pressed", "true");
  });

  test("the simulated shell answers commands and the tab is named after its folder", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await page.keyboard.press("Control+Backquote");
    await expect(tab(page, "aurora-shop")).toBeVisible({ timeout: 10_000 });
    await page.locator(".xterm-helper-textarea").first().focus();
    await page.keyboard.type("ls");
    await page.keyboard.press("Enter");
    await expect.poll(() => terminalText(page), { timeout: 10_000 }).toContain("package.json");
    // `cd src` changes the folder the tab is named after.
    await page.keyboard.type("cd src");
    await page.keyboard.press("Enter");
    await expect(tab(page, "src")).toBeVisible();
  });
});

test.describe("workbench: go to file", () => {
  test("Ctrl+P opens the palette on files and opens the pick", async ({ page }) => {
    await openApp(page);
    await openDemoProject(page);
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    await page.keyboard.press("Control+KeyP");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await page.getByTestId("palette-input").fill("Cart.tsx");
    await expect(palette.getByRole("option").first()).toContainText("Cart.tsx");
    await page.keyboard.press("Enter");
    await expect(tab(page, "Cart.tsx")).toBeVisible();
  });
});
