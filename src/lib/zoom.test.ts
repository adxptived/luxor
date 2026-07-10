import { describe, expect, test } from "bun:test";

import { ZOOM_MAX, ZOOM_MIN, clampZoom, zoomIn, zoomOut } from "./zoom";

describe("clampZoom", () => {
  test("clamps to [ZOOM_MIN, ZOOM_MAX]", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });

  test("non-finite input resets to 1", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test("rounds to two decimals (no float drift)", () => {
    expect(clampZoom(1.1000000000000001)).toBe(1.1);
    expect(clampZoom(0.30000000000000004 + 0.5)).toBe(0.8);
  });
});

describe("zoomIn / zoomOut", () => {
  test("steps by 0.1 and clamps", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  test("repeated steps stay stable", () => {
    let z = 1;
    for (let i = 0; i < 30; i++) z = zoomIn(z);
    expect(z).toBe(ZOOM_MAX);
    for (let i = 0; i < 30; i++) z = zoomOut(z);
    expect(z).toBe(ZOOM_MIN);
  });
});
