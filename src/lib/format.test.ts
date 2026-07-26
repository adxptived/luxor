import { afterAll, describe, expect, test } from "bun:test";

import {
  formatBytes,
  formatClock,
  formatDate,
  formatNumber,
  formatUnixDate,
  formatUnixDateTime,
} from "./format";
import { setLanguage } from "./i18n";

// These assertions must hold on ANY developer machine. Before `format.ts`
// existed, `dbHelpers.formatRange` used a bare `toLocaleString()` and this exact
// class of test failed on a ru-RU Windows box (`1 024` vs `1,024`) while passing
// on en-US CI runners.
afterAll(async () => {
  await setLanguage("en");
});

describe("formatNumber", () => {
  test("groups thousands per the app language, not the OS", async () => {
    await setLanguage("en");
    expect(formatNumber(1024)).toBe("1,024");

    await setLanguage("ru");
    // ru-RU groups with U+00A0 (no-break space).
    expect(formatNumber(1024)).toBe("1 024");
  });

  test("passes Intl options through", async () => {
    await setLanguage("en");
    expect(formatNumber(0.5, { style: "percent" })).toBe("50%");
  });
});

describe("formatDate", () => {
  test("renders month names in the app language", async () => {
    const july = new Date("2026-07-03T00:00:00");
    await setLanguage("en");
    expect(formatDate(july, { month: "long" })).toBe("July");

    await setLanguage("ru");
    expect(formatDate(july, { month: "long" })).toBe("июль");
  });
});

describe("unix helpers", () => {
  test("treat the input as seconds, not milliseconds", async () => {
    await setLanguage("en");
    // 2026-07-03T00:00:00Z == 1783123200s. Compare against the same instant
    // built from ms so the test is timezone-independent.
    const seconds = 1_783_123_200;
    expect(formatUnixDate(seconds)).toBe(formatDate(new Date(seconds * 1000)));
    expect(formatUnixDateTime(seconds)).toContain(formatUnixDate(seconds));
  });
});

describe("formatClock", () => {
  test("omits seconds", async () => {
    await setLanguage("en");
    const at = new Date(2026, 6, 3, 15, 25, 45);
    const out = formatClock(at);
    expect(out).toContain("25");
    expect(out).not.toContain("45");
  });
});

describe("formatBytes", () => {
  test("scales through the unit ladder", async () => {
    await setLanguage("en");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });

  test("keeps bytes integral but scaled units fractional", async () => {
    await setLanguage("en");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  test("handles negatives and non-finite input", async () => {
    await setLanguage("en");
    expect(formatBytes(-2048)).toBe("-2.0 KB");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
