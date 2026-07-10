import { describe, expect, test } from "bun:test";

import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  test("substring matches still match (superset of includes)", () => {
    expect(fuzzyScore("git", "Git: Open explorer")).not.toBeNull();
    expect(fuzzyScore("open expl", "Git: Open explorer")).not.toBeNull();
  });

  test("subsequence matches (skipped characters)", () => {
    expect(fuzzyScore("gexp", "Git: Open explorer")).not.toBeNull();
    expect(fuzzyScore("tnew", "Terminal: New terminal")).not.toBeNull();
  });

  test("non-matching query returns null", () => {
    expect(fuzzyScore("zzz", "Git: Open explorer")).toBeNull();
    expect(fuzzyScore("gitx", "Git open")).toBeNull();
  });

  test("is case-insensitive", () => {
    expect(fuzzyScore("GIT", "git: open explorer")).not.toBeNull();
    expect(fuzzyScore("git", "GIT: OPEN EXPLORER")).not.toBeNull();
  });

  test("empty query matches everything with zero-ish score", () => {
    expect(fuzzyScore("", "anything")).not.toBeNull();
    expect(fuzzyScore("   ", "anything")).not.toBeNull();
  });

  test("multi-word queries are order-free", () => {
    expect(fuzzyScore("split term", "Terminal: Split right")).not.toBeNull();
    expect(fuzzyScore("term split", "Terminal: Split right")).not.toBeNull();
    expect(fuzzyScore("term zz", "Terminal: Split right")).toBeNull();
  });

  test("word-boundary match scores higher than mid-word scatter", () => {
    const boundary = fuzzyScore("open", "Git: Open explorer")!;
    const scattered = fuzzyScore("open", "wolfpzaceann")!;
    expect(boundary).toBeGreaterThan(scattered);
  });
});

describe("fuzzyFilter", () => {
  const items = [
    "Terminal: New terminal",
    "Git: Open explorer",
    "Files: Open file explorer",
    "Settings: Open settings",
  ];

  test("empty query keeps original order", () => {
    expect(fuzzyFilter(items, "", (x) => x)).toEqual(items);
    expect(fuzzyFilter(items, "  ", (x) => x)).toEqual(items);
  });

  test("filters out non-matches", () => {
    expect(fuzzyFilter(items, "zzz", (x) => x)).toEqual([]);
  });

  test("ranks the intuitive hit first", () => {
    expect(fuzzyFilter(items, "git", (x) => x)[0]).toBe("Git: Open explorer");
    expect(fuzzyFilter(items, "settings", (x) => x)[0]).toBe("Settings: Open settings");
    expect(fuzzyFilter(items, "term", (x) => x)[0]).toBe("Terminal: New terminal");
  });

  test("prefix beats later occurrence", () => {
    const ranked = fuzzyFilter(["Open file", "File: Open"], "file", (x) => x);
    expect(ranked[0]).toBe("File: Open");
  });

  test("stable for equal scores", () => {
    const ranked = fuzzyFilter(["abc one", "abc two"], "abc", (x) => x);
    expect(ranked).toEqual(["abc one", "abc two"]);
  });

  test("works with object keys", () => {
    const objs = [{ label: "Tasks: Open kanban board" }, { label: "Skills: Open manager" }];
    expect(fuzzyFilter(objs, "kanban", (o) => o.label)).toEqual([objs[0]]);
  });

  test("limit returns only the best ranked matches", () => {
    // "File: Open" (prefix) and "Open file" (whole word right after a boundary)
    // are the strongest hits; the weak mid-word "Profile" must never make the cut.
    const ranked = fuzzyFilter(["Open file", "File: Open", "Profile", "Find file"], "file", (x) => x, 2);
    expect(ranked).toEqual(["File: Open", "Open file"]);
  });

  test("blank query with limit keeps the visible prefix only", () => {
    expect(fuzzyFilter(items, "  ", (x) => x, 2)).toEqual(items.slice(0, 2));
  });
});
