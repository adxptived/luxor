import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { RU } from "./i18n.ru";

/**
 * Every user-visible `t("…")` literal must have a Russian entry (under its key,
 * or — for `t("some.key", "English fallback")` — under the key or the fallback
 * text). Without this the Russian UI silently drifts back to English as new
 * strings are added (about a quarter of the UI was untranslated before it
 * existed).
 *
 * Calls whose fallback is a template literal (`t("k", `Preset ${name}`)`)
 * interpolate at the call site and cannot be looked up, so they are skipped.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.|i18n|ipcMock/.test(name)) out.push(p);
  }
  return out;
}

const CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*("(?:[^"\\]|\\.)*"|`))?/g;
const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\n/g, "\n");

describe("russian dictionary coverage", () => {
  it("covers every static t() string", () => {
    const missing: string[] = [];
    for (const file of sources(join(import.meta.dir, ".."))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CALL)) {
        const key = unescape(m[1]);
        const fallback = m[2];
        if (fallback === "`") continue; // dynamic template literal
        const en = fallback ? unescape(fallback.slice(1, -1)) : undefined;
        if (key in RU || (en !== undefined && en in RU)) continue;
        missing.push(`${key}  (${file.split("/src/")[1]})`);
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("covers the literal label=/help= props of Settings rows (Row translates them)", () => {
    const text = readFileSync(join(import.meta.dir, "..", "components", "SettingsModal.tsx"), "utf8");
    const missing = [...text.matchAll(/\b(?:label|help)="([A-Z][^"{}]+)"/g)]
      .map((m) => unescape(m[1]))
      .filter((v) => !(v in RU));
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
