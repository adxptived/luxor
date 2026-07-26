import { beforeEach, describe, expect, test } from "bun:test";

const COMPLETED_KEY = "luxor.onboarding.completed";
const STORAGE_KEY = "luxor.onboarding";

// `onboarding.ts` talks to the global `localStorage` directly (it is browser-only
// code), and bun's test runner has no DOM. Install a minimal in-memory stand-in
// before the module under test is ever imported.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});

/**
 * `onboarding.ts` snapshots localStorage into module state at import time, so
 * each case must seed storage and then load a FRESH module instance. A cache
 * buster on the specifier is the simplest way to do that under bun's ESM loader.
 */
async function loadModule() {
  return (await import(`./onboarding?case=${Math.random()}`)) as typeof import("./onboarding");
}

beforeEach(() => {
  localStorage.clear();
});

describe("onboarding completion latch", () => {
  test("survives a missing progress blob", async () => {
    // Regression: `loadState` read COMPLETED_KEY, then fell through to a
    // hardcoded `completed: false` whenever the progress blob was absent —
    // so a user who finished the tour saw it again on the next launch.
    localStorage.setItem(COMPLETED_KEY, "true");

    const { needsOnboarding } = await loadModule();
    expect(needsOnboarding()).toBe(false);
  });

  test("survives a corrupted progress blob", async () => {
    localStorage.setItem(COMPLETED_KEY, "true");
    localStorage.setItem(STORAGE_KEY, "{not json");

    const { needsOnboarding } = await loadModule();
    expect(needsOnboarding()).toBe(false);
  });

  test("honours a well-formed progress blob", async () => {
    localStorage.setItem(COMPLETED_KEY, "true");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ currentStep: 2, doneSteps: ["welcome"], active: false }),
    );

    const { needsOnboarding, getOnboardingState } = await loadModule();
    expect(needsOnboarding()).toBe(false);
    expect(getOnboardingState().currentStep).toBe(2);
  });

  test("still reports first run when nothing is stored", async () => {
    const { needsOnboarding } = await loadModule();
    expect(needsOnboarding()).toBe(true);
  });

  test("treats an unfinished tour as still needed", async () => {
    localStorage.setItem(COMPLETED_KEY, "false");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ currentStep: 1, doneSteps: [], active: true }),
    );

    const { needsOnboarding } = await loadModule();
    expect(needsOnboarding()).toBe(true);
  });
});
