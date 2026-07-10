import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { STORAGE_KEYS, storageKeySpec } from "./storageKeys";

/** Recursively collect .ts/.tsx files under src. */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectSources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("storage key registry", () => {
  it("has no duplicate keys", () => {
    const keys = STORAGE_KEYS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every luxor.* localStorage key used in src", () => {
    const srcDir = join(import.meta.dir, "..");
    const used = new Set<string>();
    for (const file of collectSources(srcDir)) {
      const text = readFileSync(file, "utf8");
      // String literals that look like our storage keys.
      for (const m of text.matchAll(/"(luxor\.[A-Za-z0-9_.-]+)"/g)) {
        // Only count keys that actually flow into storage APIs — heuristics:
        // declared as *_KEY consts or used inline with localStorage.
        const key = m[1];
        const isKeyConst = new RegExp(`KEY\\s*=\\s*"${key.replace(/\./g, "\\.")}"`).test(text);
        const isInline = new RegExp(`(getItem|setItem|removeItem)\\(\\s*"${key.replace(/\./g, "\\.")}"`).test(text);
        if (isKeyConst || isInline) used.add(key);
      }
    }
    const missing = [...used].filter((k) => !storageKeySpec(k));
    expect(missing).toEqual([]);
  });
});
