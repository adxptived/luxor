import { describe, expect, test } from "bun:test";

import { formatDate } from "./format";
import { getLanguage, getLocale, setLanguage, t } from "./i18n";

describe("i18n", () => {
  test("defaults to english fallback", async () => {
    await setLanguage("en");
    expect(t("nav.git", "Git explorer")).toBe("Git explorer");
    expect(getLanguage()).toBe("en");
  });

  test("returns russian translation when available", async () => {
    // setLanguage lazily imports the RU dictionary chunk — await it before
    // asserting on translated output.
    await setLanguage("ru");
    expect(t("nav.terminal", "Terminal")).toBe("Терминал");
    expect(t("github.issues", "Issues")).toBe("Задачи");
    await setLanguage("en");
  });

  test("falls back to english for unknown keys", async () => {
    await setLanguage("ru");
    expect(t("nope.unknown", "Whatever")).toBe("Whatever");
    await setLanguage("en");
  });

  test("the russian dictionary has no corrupted (U+FFFD) characters", async () => {
    // A byte-level truncation once left "Сохр\uFFFDнить" on the Save button.
    const mod = await import("./i18n.ru");
    const bad = Object.entries(mod.RU).filter(
      ([k, v]) => k.includes("\uFFFD") || String(v).includes("\uFFFD"),
    );
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  test("unknown languages map to english", async () => {
    await setLanguage("de");
    expect(getLanguage()).toBe("en");
  });

  test("getLocale tracks the active language, not the OS", async () => {
    await setLanguage("en");
    expect(getLocale()).toBe("en-US");
    // Dates/months must render in the UI language regardless of the host OS
    // locale (the clock/heatmap Russian-labels bug). Asserted through
    // `formatDate` rather than a raw `toLocaleDateString(getLocale())` so this
    // covers the exact path the app renders with.
    const july = new Date("2026-07-03T00:00:00");
    expect(formatDate(july, { month: "long" })).toBe("July");

    await setLanguage("ru");
    expect(getLocale()).toBe("ru-RU");
    expect(formatDate(july, { month: "long" })).toBe("июль");
    await setLanguage("en");
  });
});
