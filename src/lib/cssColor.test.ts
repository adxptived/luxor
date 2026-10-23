import { describe, expect, it } from "bun:test";

import { computedColorToHex, resolveCssColor } from "./cssColor";

describe("computedColorToHex", () => {
  it("handles the formats browsers return for computed colours", () => {
    expect(computedColorToHex("rgb(16, 16, 20)")).toBe("#101014");
    expect(computedColorToHex("rgba(255, 0, 128, 0.5)")).toBe("#ff0080");
    expect(computedColorToHex("rgb(16 16 20)")).toBe("#101014");
    // color-mix(in srgb, …) computes to color(srgb r g b) in Chromium/WebView2.
    expect(computedColorToHex("color(srgb 0.0627 0.0627 0.0784)")).toBe("#101014");
    expect(computedColorToHex("#ABC")).toBe("#aabbcc");
    expect(computedColorToHex("#101014ff")).toBe("#101014");
  });

  it("returns null for anything it cannot read", () => {
    expect(computedColorToHex("oklch(0.5 0.1 200)")).toBeNull();
    expect(computedColorToHex("")).toBeNull();
  });
});

describe("resolveCssColor", () => {
  it("falls back without a scope element", () => {
    expect(resolveCssColor(null, "var(--lx-surface)", "#101014")).toBe("#101014");
  });
});
