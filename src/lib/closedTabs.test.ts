import { describe, expect, it } from "bun:test";

import { MAX_CLOSED_TABS, isReopenable, pushClosedTab, reopenKey } from "./closedTabs";

describe("isReopenable", () => {
  it("accepts real panels", () => {
    expect(isReopenable("editor")).toBe(true);
    expect(isReopenable("terminal")).toBe(true);
    expect(isReopenable("git")).toBe(true);
  });
  it("rejects welcome and empty", () => {
    expect(isReopenable("welcome")).toBe(false);
    expect(isReopenable(undefined)).toBe(false);
    expect(isReopenable("")).toBe(false);
  });
});

describe("reopenKey", () => {
  it("keys file-backed tabs by component + path", () => {
    expect(reopenKey({ component: "editor", params: { path: "/a.ts" } })).toBe("editor:/a.ts");
  });
  it("has no path segment for path-less tabs", () => {
    expect(reopenKey({ component: "terminal", params: { cwd: "/x" } })).toBe("terminal:");
    expect(reopenKey({ component: "git" })).toBe("git:");
  });
});

describe("pushClosedTab", () => {
  it("adds most-recent first", () => {
    let s: ReturnType<typeof pushClosedTab> = [];
    s = pushClosedTab(s, { component: "editor", params: { path: "/a.ts" } });
    s = pushClosedTab(s, { component: "editor", params: { path: "/b.ts" } });
    expect(s.map((x) => x.params?.path)).toEqual(["/b.ts", "/a.ts"]);
  });

  it("ignores non-reopenable tabs", () => {
    const s = pushClosedTab([], { component: "welcome" });
    expect(s).toHaveLength(0);
  });

  it("dedupes the same file (moves it to the top, no growth)", () => {
    let s: ReturnType<typeof pushClosedTab> = [];
    s = pushClosedTab(s, { component: "editor", params: { path: "/a.ts" } });
    s = pushClosedTab(s, { component: "editor", params: { path: "/b.ts" } });
    s = pushClosedTab(s, { component: "editor", params: { path: "/a.ts" } });
    expect(s.map((x) => x.params?.path)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("keeps multiple path-less tabs (terminals are all distinct)", () => {
    let s: ReturnType<typeof pushClosedTab> = [];
    s = pushClosedTab(s, { component: "terminal", params: { cwd: "/x" } });
    s = pushClosedTab(s, { component: "terminal", params: { cwd: "/y" } });
    expect(s).toHaveLength(2);
  });

  it("caps the stack length", () => {
    let s: ReturnType<typeof pushClosedTab> = [];
    for (let i = 0; i < MAX_CLOSED_TABS + 5; i++) {
      s = pushClosedTab(s, { component: "editor", params: { path: `/f${i}.ts` } });
    }
    expect(s).toHaveLength(MAX_CLOSED_TABS);
    expect(s[0]?.params?.path).toBe(`/f${MAX_CLOSED_TABS + 4}.ts`);
  });
});
