import { describe, expect, test } from "bun:test";

import { RECENTS_LIMIT, applyRecents, loadRecents, recordRecent } from "./paletteRecents";

/** Minimal in-memory localStorage stand-in. */
function memStorage(initial?: string) {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
}

describe("loadRecents", () => {
  test("empty storage gives empty list", () => {
    expect(loadRecents(memStorage())).toEqual([]);
  });

  test("corrupt JSON gives empty list", () => {
    expect(loadRecents(memStorage("not json"))).toEqual([]);
    expect(loadRecents(memStorage('{"a":1}'))).toEqual([]);
  });

  test("non-string entries are dropped", () => {
    expect(loadRecents(memStorage('["a", 1, null, "b"]'))).toEqual(["a", "b"]);
  });
});

describe("recordRecent", () => {
  test("newest first, deduplicated", () => {
    const s = memStorage();
    recordRecent("a", s);
    recordRecent("b", s);
    expect(recordRecent("a", s)).toEqual(["a", "b"]);
    expect(loadRecents(s)).toEqual(["a", "b"]);
  });

  test("capped at RECENTS_LIMIT", () => {
    const s = memStorage();
    for (let i = 0; i < RECENTS_LIMIT + 5; i++) recordRecent(`cmd-${i}`, s);
    const list = loadRecents(s);
    expect(list.length).toBe(RECENTS_LIMIT);
    expect(list[0]).toBe(`cmd-${RECENTS_LIMIT + 4}`);
  });

  test("setItem failure is swallowed (best effort)", () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(recordRecent("a", s)).toEqual(["a"]);
  });
});

describe("applyRecents", () => {
  const cmds = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  test("no recents keeps original order", () => {
    expect(applyRecents(cmds, [])).toEqual(cmds);
  });

  test("recents float to the top in recency order", () => {
    expect(applyRecents(cmds, ["c", "a"]).map((c) => c.id)).toEqual(["c", "a", "b", "d"]);
  });

  test("unknown ids (removed commands) are ignored", () => {
    expect(applyRecents(cmds, ["gone", "b"]).map((c) => c.id)).toEqual(["b", "a", "c", "d"]);
    expect(applyRecents(cmds, ["gone"]).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("no duplicates when a recent id exists", () => {
    const out = applyRecents(cmds, ["a"]);
    expect(out.filter((c) => c.id === "a").length).toBe(1);
    expect(out.length).toBe(cmds.length);
  });
});
