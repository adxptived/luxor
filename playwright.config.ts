import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite for the Luxor UI. Runs against the plain Vite dev server, where
 * `src/lib/ipc.ts` falls back to its in-memory mock backend — no Tauri shell
 * needed. Run with `bun run e2e` (Chromium must be installed once via
 * `bunx playwright install chromium`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bunx vite --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
