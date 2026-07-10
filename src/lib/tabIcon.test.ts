import { describe, expect, test } from "bun:test";

import { TAB_ICON_IDS, lucideIcon, parseTabIcon } from "./tabIcon";

describe("parseTabIcon", () => {
  test("null/empty → no icon", () => {
    expect(parseTabIcon(null)).toBeNull();
    expect(parseTabIcon(undefined)).toBeNull();
    expect(parseTabIcon("")).toBeNull();
    expect(parseTabIcon("   ")).toBeNull();
  });

  test("lucide round-trip for every curated icon", () => {
    for (const id of TAB_ICON_IDS) {
      expect(parseTabIcon(lucideIcon(id))).toEqual({ kind: "lucide", value: id });
    }
  });

  test("unknown lucide id degrades to no icon (not raw text)", () => {
    expect(parseTabIcon("lucide:does-not-exist")).toBeNull();
  });

  test("plain emoji stays emoji (legacy format)", () => {
    expect(parseTabIcon("🚀")).toEqual({ kind: "emoji", value: "🚀" });
    expect(parseTabIcon(" 🔥 ")).toEqual({ kind: "emoji", value: "🔥" });
  });
});
