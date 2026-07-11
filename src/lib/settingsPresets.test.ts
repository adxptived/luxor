import { describe, expect, it } from "bun:test";

import { BUILTIN_PRESETS, decodePresetFromUrl, encodePresetToUrl } from "./settingsPresets";
import type { AppConfig } from "./types";

// A minimal config stub — encode/decode only round-trips JSON, so a partial
// object cast is sufficient and keeps the test independent of config growth.
const fakeConfig = { theme: "dark", accent_color: "#ff0000", ui: { zoom: 1.1 } } as unknown as AppConfig;

describe("settingsPresets", () => {
  it("has unique ids and non-empty patches", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(Object.keys(preset.patch).length).toBeGreaterThan(0);
    }
  });

  it("round-trips a shared preset", () => {
    const url = encodePresetToUrl("My preset", fakeConfig, "Nice colors");
    expect(url.startsWith("luxor://preset#")).toBe(true);
    const decoded = decodePresetFromUrl(url);
    expect(decoded).not.toBeNull();
    expect(decoded?.name).toBe("My preset");
    expect(decoded?.description).toBe("Nice colors");
    expect(decoded?.config).toEqual(JSON.parse(JSON.stringify(fakeConfig)));
  });

  it("round-trips unicode names", () => {
    const url = encodePresetToUrl("Тёмная тема ✦", fakeConfig);
    const decoded = decodePresetFromUrl(url);
    expect(decoded?.name).toBe("Тёмная тема ✦");
  });

  it("rejects non-preset strings", () => {
    expect(decodePresetFromUrl("")).toBeNull();
    expect(decodePresetFromUrl("https://example.com#abc")).toBeNull();
    expect(decodePresetFromUrl("luxor://settings#abc")).toBeNull();
    expect(decodePresetFromUrl("luxor://preset#not-base64!!!")).toBeNull();
  });

  it("rejects presets without a name or config", () => {
    const noName = `luxor://preset#${btoa(JSON.stringify({ config: {} }))}`;
    const noConfig = `luxor://preset#${btoa(JSON.stringify({ name: "x" }))}`;
    expect(decodePresetFromUrl(noName)).toBeNull();
    expect(decodePresetFromUrl(noConfig)).toBeNull();
  });

  it("caps oversized names and descriptions", () => {
    const url = encodePresetToUrl("x".repeat(300), fakeConfig, "y".repeat(500));
    const decoded = decodePresetFromUrl(url);
    expect(decoded?.name.length).toBe(80);
    expect(decoded?.description?.length).toBe(200);
  });
});
