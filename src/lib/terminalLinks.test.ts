import { describe, expect, it } from "bun:test";

import { matchPathLinks, resolveMatchedPath } from "./terminalLinks";

describe("matchPathLinks", () => {
  it("finds rust-style path:line:col", () => {
    const m = matchPathLinks("error[E0308]: mismatched types --> src/main.rs:12:34");
    expect(m.length).toBe(1);
    expect(m[0].path).toBe("src/main.rs");
    expect(m[0].line).toBe(12);
  });

  it("finds ts-style path:line", () => {
    const m = matchPathLinks("  at ./lib/util.ts:5");
    expect(m[0].path).toBe("./lib/util.ts");
    expect(m[0].line).toBe(5);
  });

  it("finds msvc-style path(line,col)", () => {
    const m = matchPathLinks(String.raw`C:\proj\a.rs(7,2): error C2065`);
    expect(m[0].path).toBe(String.raw`C:\proj\a.rs`);
    expect(m[0].line).toBe(7);
  });

  it("finds plain paths without line numbers", () => {
    const m = matchPathLinks("modified: src/panels/GitPanel.tsx");
    expect(m[0].path).toBe("src/panels/GitPanel.tsx");
    expect(m[0].line).toBeUndefined();
  });

  it("ignores URLs", () => {
    expect(matchPathLinks("see https://example.com/a/b.html for docs").length).toBe(0);
  });

  it("returns nothing for plain words and versions", () => {
    expect(matchPathLinks("installed package v1.2.3 successfully").length).toBe(0);
  });
});

describe("resolveMatchedPath", () => {
  it("keeps absolute paths", () => {
    expect(resolveMatchedPath("/a/b.rs", "/root")).toBe("/a/b.rs");
    expect(resolveMatchedPath(String.raw`C:\a\b.rs`, "/root")).toBe(String.raw`C:\a\b.rs`);
  });

  it("joins relative paths to the root and strips ./", () => {
    expect(resolveMatchedPath("./src/a.ts", "/root")).toBe("/root/src/a.ts");
    expect(resolveMatchedPath("src/a.ts", "/root")).toBe("/root/src/a.ts");
  });

  it("returns the path as-is without a root", () => {
    expect(resolveMatchedPath("src/a.ts", null)).toBe("src/a.ts");
  });
});
