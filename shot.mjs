import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

async function theme(t) {
  await page.evaluate((x) => document.documentElement.setAttribute("data-theme", x), t);
  await page.waitForTimeout(300);
}

// 1) Toggle the right panel ON via the status-bar button, dark theme.
await theme("luxor-dark");
const toggle = page.locator('[data-testid="statusbar"] button[title="Toggle right panel"]');
await toggle.click();
await page.waitForTimeout(900);
console.log("right-panel present:", await page.locator('[data-testid="right-panel"]').count());
await page.screenshot({ path: "/tmp/shot_right_dark.png" });

// 2) A light theme to show theming holds.
await theme("luxor-light");
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/shot_right_light.png" });

// 3) Double-click a nav button → new tab. Open Git twice via dblclick.
await theme("luxor-dark");
const gitNav = page.locator('[data-nav-id="git"]').first();
if (await gitNav.count()) {
  await gitNav.dblclick();
  await page.waitForTimeout(600);
  await gitNav.dblclick();
  await page.waitForTimeout(800);
  const tabs = await page.locator(".dv-tab, [class*='dv-tab']").count();
  console.log("git nav dblclicked twice; dockview tab nodes:", tabs);
}
await page.screenshot({ path: "/tmp/shot_dblclick.png" });

console.log("console errors:", errors.filter((e) => !/dimensions/.test(e)));
await browser.close();
