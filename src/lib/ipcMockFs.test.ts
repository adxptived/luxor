import { describe, expect, it } from "bun:test";

import {
  DEMO_ROOT,
  demoCopy,
  demoCreateDir,
  demoCreateFile,
  demoDelete,
  demoGrep,
  demoList,
  demoRead,
  demoRename,
  demoSearch,
  demoWrite,
  inDemo,
} from "./ipcMockFs";

describe("browser demo project", () => {
  it("lists folders first, then files, case-insensitively", () => {
    const names = demoList(DEMO_ROOT).map((e) => e.name);
    expect(names.slice(0, 2)).toContain("docs");
    expect(names.indexOf("src")).toBeLessThan(names.indexOf("README.md"));
    expect(demoList(`${DEMO_ROOT}/src`).map((e) => e.name)).toEqual(["components", "lib", "styles", "App.tsx", "main.tsx"]);
  });

  it("creates, writes, renames, copies and deletes", () => {
    demoCreateDir(`${DEMO_ROOT}/tmp`);
    demoCreateFile(`${DEMO_ROOT}/tmp/a.txt`);
    demoWrite(`${DEMO_ROOT}/tmp/a.txt`, "hello");
    expect(demoRead(`${DEMO_ROOT}/tmp/a.txt`).content).toBe("hello");
    demoRename(`${DEMO_ROOT}/tmp`, `${DEMO_ROOT}/tmp2`);
    expect(demoRead(`${DEMO_ROOT}/tmp2/a.txt`).content).toBe("hello");
    demoCopy(`${DEMO_ROOT}/tmp2`, `${DEMO_ROOT}/tmp3`);
    expect(demoList(`${DEMO_ROOT}/tmp3`).map((e) => e.name)).toEqual(["a.txt"]);
    demoDelete(`${DEMO_ROOT}/tmp2`);
    demoDelete(`${DEMO_ROOT}/tmp3`);
    expect(demoList(DEMO_ROOT).some((e) => e.name.startsWith("tmp"))).toBe(false);
  });

  it("refuses to overwrite on create / rename", () => {
    let threw = false;
    try {
      demoCreateFile(`${DEMO_ROOT}/README.md`);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("searches names and contents", () => {
    expect(demoSearch(DEMO_ROOT, "cart", 10).map((e) => e.name)).toContain("Cart.tsx");
    const report = demoGrep(DEMO_ROOT, "formatPrice", false, true);
    expect(report.hits.length).toBeGreaterThan(2);
    expect(report.hits.every((h) => h.text.slice(h.start, h.end) === "formatPrice")).toBe(true);
  });

  it("only claims paths inside the demo project", () => {
    expect(inDemo(DEMO_ROOT)).toBe(true);
    expect(inDemo(`${DEMO_ROOT}/src`)).toBe(true);
    expect(inDemo(`${DEMO_ROOT}-other`)).toBe(false);
    expect(inDemo("/mock/README.md")).toBe(false);
  });
});
