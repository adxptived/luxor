import { describe, expect, test } from "bun:test";

import { STATUS_ALIGN_OPTIONS, alignToJustify, type StatusBarAlign } from "./statusBarPrefs";

describe("alignToJustify", () => {
  test("maps each alignment to a CSS justify-content value", () => {
    expect(alignToJustify("center")).toBe("center");
    expect(alignToJustify("right")).toBe("flex-end");
    expect(alignToJustify("left")).toBe("flex-start");
    // "spread" keeps the cluster at the start; the spacer does the splitting.
    expect(alignToJustify("spread")).toBe("flex-start");
  });

  test("every advertised option produces a non-empty justify value", () => {
    for (const opt of STATUS_ALIGN_OPTIONS) {
      expect(alignToJustify(opt.id)).not.toBe("");
    }
  });

  test("falls back to flex-start for an unknown value", () => {
    expect(alignToJustify("bogus" as StatusBarAlign)).toBe("flex-start");
  });
});
