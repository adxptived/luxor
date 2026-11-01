import { describe, expect, it } from "bun:test";

import { MAX_AGE_MS, MAX_FILE_CHARS, MAX_TOTAL_CHARS, UNSAVED_PREFIX, clearUnsaved, loadUnsaved, saveUnsaved } from "./unsavedBuffers";

function memStore() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

describe("unsaved buffers (hot exit)", () => {
  it("round-trips and clears", () => {
    const s = memStore();
    expect(saveUnsaved("/p/a.ts", "edited", 123, 1000, s)).toBe(true);
    expect(loadUnsaved("/p/a.ts", 2000, s)).toEqual({ v: 1, content: "edited", baseMtime: 123, savedAt: 1000 });
    clearUnsaved("/p/a.ts", s);
    expect(loadUnsaved("/p/a.ts", 2000, s)).toBeNull();
  });

  it("does not keep huge files and expires old entries", () => {
    const s = memStore();
    expect(saveUnsaved("/p/big.txt", "x".repeat(MAX_FILE_CHARS + 1), null, 1, s)).toBe(false);
    expect(loadUnsaved("/p/big.txt", 1, s)).toBeNull();
    saveUnsaved("/p/old.ts", "old", null, 0, s);
    expect(loadUnsaved("/p/old.ts", MAX_AGE_MS + 1, s)).toBeNull();
  });

  it("drops the oldest entries to stay within the budget", () => {
    const s = memStore();
    const chunk = "y".repeat(Math.floor(MAX_FILE_CHARS * 0.9));
    const n = Math.ceil(MAX_TOTAL_CHARS / chunk.length) + 2;
    for (let i = 0; i < n; i++) saveUnsaved(`/p/f${i}.ts`, chunk, null, 1000 + i, s);
    const keys = s.keys().filter((k) => k.startsWith(UNSAVED_PREFIX));
    const total = keys.reduce((sum, k) => sum + (s.getItem(k)?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
    expect(loadUnsaved(`/p/f${n - 1}.ts`, 2000, s)).not.toBeNull();
    expect(loadUnsaved("/p/f0.ts", 2000, s)).toBeNull();
  });
});
