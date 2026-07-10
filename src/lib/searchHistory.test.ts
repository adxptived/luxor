import { describe, expect, it } from "bun:test";

import { pushSearchHistory } from "./searchHistory";

describe("pushSearchHistory", () => {
  it("prepends new queries", () => {
    expect(pushSearchHistory(["a"], "b")).toEqual(["b", "a"]);
  });

  it("deduplicates and moves the repeated query to the front", () => {
    expect(pushSearchHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("ignores blank queries", () => {
    expect(pushSearchHistory(["a"], "   ")).toEqual(["a"]);
  });

  it("caps the history at 20 entries", () => {
    const full = Array.from({ length: 20 }, (_, i) => `q${i}`);
    const next = pushSearchHistory(full, "new");
    expect(next).toHaveLength(20);
    expect(next[0]).toBe("new");
    expect(next).not.toContain("q19");
  });
});
