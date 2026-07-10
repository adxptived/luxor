import { expect, test } from "@playwright/test";

import { clickNav, openApp } from "./helpers";

/**
 * Startup performance budgets (browser/mock mode — no Tauri overhead, so
 * these guard the *frontend's* share of startup: bundle size, parse and
 * first render). A regression that drags Monaco or other heavyweights into
 * the entry path blows these budgets immediately.
 */

test("cold start: app is interactive within budget", async ({ page }) => {
  const t0 = Date.now();
  await openApp(page);
  const elapsed = Date.now() - t0;
  // The suite runs against the un-bundled Vite dev server (slowest possible
  // serving mode, parallel workers): the budget guards against hangs and
  // gross regressions, not absolute startup time.
  expect(elapsed).toBeLessThan(20_000);
});

test("entry HTML does not preload monaco or language workers", async ({ page }) => {
  const monacoRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    // Only the real heavyweights count: the monaco-editor package itself and
    // its worker bundles (app-level files like src/lib/monaco.ts are tiny
    // loader shims and load eagerly by design).
    if (/node_modules\/monaco-editor|monaco-editor\/esm|[.-]worker[-.]/i.test(url)) {
      monacoRequests.push(url);
    }
  });
  await openApp(page);
  // In browser mode the idle warmup is disabled, so any Monaco request during
  // startup means the editor leaked into the critical path.
  expect(monacoRequests).toEqual([]);
});

test("first terminal panel becomes visible quickly", async ({ page }) => {
  await openApp(page);
  const t0 = Date.now();
  await clickNav(page, "terminal");
  // xterm container with the mock banner appears.
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
});
