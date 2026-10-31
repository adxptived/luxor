// Temporary screenshot driver for the probe workflow (not part of the PR).
import { chromium } from "@playwright/test";

const OUT = "probe-out/shots";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("dialog", (d) => void d.accept("/home/dev/aurora-shop"));

let n = 0;
async function shot(name) {
  n += 1;
  const file = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`;
  try {
    await page.screenshot({ path: file });
    console.log("shot", file);
  } catch (e) {
    console.log("shot failed", name, e.message);
  }
}
async function step(name, fn) {
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    console.log("FAIL", name, e.message.split("\n")[0]);
  }
}
const wait = (ms) => page.waitForTimeout(ms);
const treeRow = (name) =>
  page.getByTestId("files-sidebar").getByRole("treeitem").filter({ has: page.getByText(name, { exact: true }) }).first();

await page.addInitScript(() => {
  localStorage.setItem("luxor.onboarding.completed", "true");
});
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await wait(1500);
await shot("welcome");

await step("open project", async () => {
  await page.getByTestId("tab-add").click();
  await page.getByText("Open folder…").click();
  await page.getByTestId("workbench-sidebar").waitFor({ timeout: 8000 });
  await wait(1200);
});
await shot("project-default");

await step("preview App.tsx", async () => {
  await treeRow("src").click();
  await wait(400);
  await treeRow("App.tsx").click();
  await wait(1800);
});
await shot("preview-tab");

await step("pin Cart.tsx", async () => {
  await treeRow("components").click();
  await wait(400);
  await treeRow("Cart.tsx").dblclick();
  await wait(1500);
});

await step("terminal panel", async () => {
  await page.keyboard.press("Control+Backquote");
  await wait(1500);
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.type("ls");
  await page.keyboard.press("Enter");
  await wait(300);
  await page.keyboard.type("git status");
  await page.keyboard.press("Enter");
  await wait(300);
  await page.keyboard.type("bun test");
  await page.keyboard.press("Enter");
  await wait(800);
});
await shot("workbench");

await step("second terminal + split", async () => {
  await page.keyboard.press("Control+Shift+Backquote");
  await wait(1200);
});
await shot("two-terminals");

await step("go to file", async () => {
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+KeyP");
  await wait(700);
  await page.getByTestId("palette-input").fill("form");
  await wait(600);
});
await shot("go-to-file");
await step("close palette", async () => {
  await page.keyboard.press("Escape");
  await wait(400);
});

await step("search view", async () => {
  await page.getByTestId("sidebar-tab-search").click();
  await wait(600);
  const box = page.getByTestId("workbench-sidebar").getByRole("textbox").first();
  await box.fill("formatPrice");
  await box.press("Enter");
  await wait(900);
});
await shot("sidebar-search");

await step("back to explorer + context menu", async () => {
  await page.getByTestId("sidebar-tab-explorer").click();
  await wait(600);
  await treeRow("README.md").click({ button: "right" });
  await wait(400);
});
await shot("context-menu");

await step("inline rename", async () => {
  await page.getByTestId("context-menu").getByText("Rename…").click();
  await wait(500);
});
await shot("inline-rename");
await step("cancel rename", async () => {
  await page.keyboard.press("Escape");
  await wait(300);
});

await step("maximize terminal group", async () => {
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.press("Control+Shift+KeyM");
  await wait(800);
});
await shot("maximized-terminal");
await step("restore + hide terminal panel", async () => {
  await page.keyboard.press("Control+Shift+KeyM");
  await wait(500);
  await page.keyboard.press("Control+Backquote");
  await wait(700);
});
await shot("terminal-hidden");

await step("light theme", async () => {
  await page.keyboard.press("Control+Backquote");
  await wait(500);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await wait(700);
});
await shot("light");

await step("narrow", async () => {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.setViewportSize({ width: 1000, height: 700 });
  await wait(900);
});
await shot("narrow");

console.log("console errors:", JSON.stringify(errors.slice(0, 40), null, 1));
await browser.close();
