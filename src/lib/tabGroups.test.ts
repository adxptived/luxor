import { describe, expect, it } from "bun:test";

import {
  activeGroupCount,
  buildTabLayout,
  GROUP_COLORS,
  newGroupId,
  nextGroupColor,
  pruneGroups,
  type TabGroup,
} from "./tabGroups";

const g = (id: string, over: Partial<TabGroup> = {}): TabGroup => ({
  id,
  name: id,
  color: "#5b9dff",
  collapsed: false,
  ...over,
});
const tabs = (...ids: string[]) => ids.map((id) => ({ id }));

describe("buildTabLayout", () => {
  it("passes ungrouped tabs through in order", () => {
    const out = buildTabLayout(tabs("a", "b", "c"), {}, []);
    expect(out.map((i) => (i.kind === "tab" ? i.project.id : "?"))).toEqual(["a", "b", "c"]);
  });

  it("clusters group members at the first member's position", () => {
    const out = buildTabLayout(tabs("a", "b", "c", "d"), { a: "g1", c: "g1" }, [g("g1")]);
    expect(out).toHaveLength(3); // [group(a,c), b, d]
    expect(out[0].kind).toBe("group");
    if (out[0].kind === "group") expect(out[0].tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(out[1].kind === "tab" && out[1].project.id).toBe("b");
    expect(out[2].kind === "tab" && out[2].project.id).toBe("d");
  });

  it("emits each group exactly once", () => {
    const out = buildTabLayout(tabs("a", "b", "c"), { a: "g1", b: "g1", c: "g1" }, [g("g1")]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
  });

  it("treats tabs of a deleted group as ungrouped", () => {
    const out = buildTabLayout(tabs("a", "b"), { a: "gone" }, []);
    expect(out.every((i) => i.kind === "tab")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("keeps two groups in first-seen order with interleaved tabs", () => {
    const out = buildTabLayout(tabs("a", "b", "c", "d"), { a: "g1", b: "g2", c: "g1" }, [g("g1"), g("g2")]);
    // a→g1 first (pulls c), then b→g2, then d ungrouped
    expect(out).toHaveLength(3);
    expect(out[0].kind === "group" && out[0].group.id).toBe("g1");
    expect(out[0].kind === "group" && out[0].tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(out[1].kind === "group" && out[1].group.id).toBe("g2");
    expect(out[2].kind === "tab" && out[2].project.id).toBe("d");
  });

  it("does not mutate inputs", () => {
    const order = tabs("a", "b");
    const assign = { a: "g1" };
    buildTabLayout(order, assign, [g("g1")]);
    expect(order.map((t) => t.id)).toEqual(["a", "b"]);
    expect(assign).toEqual({ a: "g1" });
  });

  it("retains the collapsed flag on the group object", () => {
    const out = buildTabLayout(tabs("a"), { a: "g1" }, [g("g1", { collapsed: true })]);
    expect(out[0].kind === "group" && out[0].group.collapsed).toBe(true);
  });
});

describe("nextGroupColor", () => {
  it("returns the first palette color when none used", () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0].hex);
  });
  it("skips already-used colors", () => {
    const c = nextGroupColor([g("g1", { color: GROUP_COLORS[0].hex })]);
    expect(c).toBe(GROUP_COLORS[1].hex);
  });
  it("is case-insensitive about used colors", () => {
    const c = nextGroupColor([g("g1", { color: GROUP_COLORS[0].hex.toUpperCase() })]);
    expect(c).toBe(GROUP_COLORS[1].hex);
  });
  it("cycles when the palette is exhausted", () => {
    const all = GROUP_COLORS.map((c, i) => g(`g${i}`, { color: c.hex }));
    expect(GROUP_COLORS.some((c) => c.hex === nextGroupColor(all))).toBe(true);
  });
});

describe("newGroupId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newGroupId()));
    expect(ids.size).toBe(100);
  });
});

describe("activeGroupCount", () => {
  it("counts only groups with a live member", () => {
    expect(activeGroupCount(tabs("a", "b"), { a: "g1", b: "g2" }, [g("g1"), g("g2"), g("g3")])).toBe(2);
  });
  it("ignores assignments to missing groups", () => {
    expect(activeGroupCount(tabs("a"), { a: "gone" }, [g("g1")])).toBe(0);
  });
});

describe("pruneGroups", () => {
  it("drops assignments for closed tabs and now-empty groups", () => {
    const r = pruneGroups(["a"], { a: "g1", b: "g1" }, [g("g1")]);
    expect(r.assignments).toEqual({ a: "g1" });
    expect(r.groups).toHaveLength(1);
    expect(r.changed).toBe(true);
  });
  it("removes a group once its last member is gone", () => {
    const r = pruneGroups(["c"], { a: "g1", b: "g1" }, [g("g1")]);
    expect(r.assignments).toEqual({});
    expect(r.groups).toHaveLength(0);
    expect(r.changed).toBe(true);
  });
  it("reports no change when everything is live", () => {
    const r = pruneGroups(["a", "b"], { a: "g1", b: "g1" }, [g("g1")]);
    expect(r.changed).toBe(false);
  });
});
