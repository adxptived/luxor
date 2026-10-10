import { describe, expect, it } from "bun:test";

import { buildMarks, markOf } from "./gitMarks";

describe("markOf", () => {
  it("prefers the worktree state and ignores ignored files", () => {
    expect(markOf({ staged: "new", unstaged: "modified" })?.letter).toBe("M");
    expect(markOf({ staged: "new", unstaged: null })?.letter).toBe("A");
    expect(markOf({ staged: null, unstaged: "untracked" })?.letter).toBe("U");
    expect(markOf({ staged: null, unstaged: "ignored" })).toBeNull();
    expect(markOf({ staged: null, unstaged: null })).toBeNull();
  });
});

describe("buildMarks", () => {
  it("marks files and tints their parent folders", () => {
    const m = buildMarks("/p", [{ path: "src/a/b.ts", staged: null, unstaged: "modified" }]);
    expect(m.get("/p/src/a/b.ts")).toEqual({ letter: "M", tone: "modified" });
    expect(m.get("/p/src/a")).toEqual({ letter: "", tone: "modified" });
    expect(m.get("/p/src")).toEqual({ letter: "", tone: "modified" });
  });

  it("a folder shows the strongest tone beneath it", () => {
    const m = buildMarks("/p/", [
      { path: "src/new.ts", staged: null, unstaged: "untracked" },
      { path: "src/gone.ts", staged: null, unstaged: "deleted" },
    ]);
    expect(m.get("/p/src")?.tone).toBe("deleted");
  });

  it("uses backslashes for Windows roots", () => {
    const m = buildMarks("C:\\p", [{ path: "a/b.ts", staged: "new", unstaged: null }]);
    expect(m.get("C:\\p\\a\\b.ts")?.letter).toBe("A");
  });
});
