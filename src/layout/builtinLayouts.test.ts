import { describe, expect, it } from "bun:test";

import { BUILTIN_LAYOUTS, buildLayout, pickStartFile, type BuiltinLayoutId, type LayoutStep } from "./builtinLayouts";

const OPTS = { cwd: "/p", file: "/p/README.md" };

function components(steps: LayoutStep[]): string[] {
  return steps.map((s) => s.component);
}

describe("buildLayout", () => {
  it("every layout is a valid tree: unique keys, refs point backwards, only the root has no ref", () => {
    for (const { id } of BUILTIN_LAYOUTS) {
      for (const file of ["/p/README.md", null]) {
        const steps = buildLayout(id, { cwd: "/p", file });
        const seen = new Set<string>();
        steps.forEach((s, i) => {
          expect(seen.has(s.key)).toBe(false);
          if (i === 0) {
            expect(s.ref).toBeUndefined();
          } else {
            expect(s.ref).toBeDefined();
            expect(seen.has(s.ref!)).toBe(true);
            expect(s.direction).toBeDefined();
            expect(s.size).toBeGreaterThan(0);
            expect(s.size).toBeLessThan(1);
          }
          seen.add(s.key);
        });
      }
    }
  });

  it("'all' shows the editor and two terminals when there is a file to open", () => {
    expect(components(buildLayout("all", OPTS))).toEqual(["editor", "terminal", "terminal"]);
  });

  it("'all' and 'code' leave the editor out when there is nothing to open", () => {
    expect(components(buildLayout("all", { cwd: "/p", file: null }))).toEqual(["terminal", "terminal"]);
    expect(components(buildLayout("code", { cwd: "/p", file: null }))).toEqual(["terminal"]);
  });

  it("'code' has a single, small terminal under the editor", () => {
    const steps = buildLayout("code", OPTS);
    expect(components(steps)).toEqual(["editor", "terminal"]);
    const t = steps[1];
    expect(t.direction).toBe("below");
    expect(t.size).toBeLessThan(0.3);
  });

  it("no layout adds a Files tab: the tree is the Explorer side bar", () => {
    for (const { id } of BUILTIN_LAYOUTS) {
      expect(components(buildLayout(id, OPTS))).not.toContain("files");
    }
  });

  it("'terminals' starts from a terminal and puts the editor beside it", () => {
    const steps = buildLayout("terminals", OPTS);
    expect(steps[0].component).toBe("terminal");
    expect(components(steps).filter((c) => c === "terminal")).toHaveLength(3);
    const editor = steps.find((s) => s.component === "editor")!;
    expect(editor.direction).toBe("right");
  });

  it("passes the project folder to every terminal and the file to the editor", () => {
    for (const id of ["all", "code", "terminals"] as BuiltinLayoutId[]) {
      for (const s of buildLayout(id, OPTS)) {
        if (s.component === "terminal") expect(s.params).toEqual({ cwd: "/p" });
        if (s.component === "editor") expect(s.params).toEqual({ path: "/p/README.md" });
      }
    }
  });

  it("a blank workspace gets terminals with no folder", () => {
    for (const s of buildLayout("all", { cwd: null, file: null })) {
      if (s.component === "terminal") expect(s.params).toEqual({ cwd: null });
    }
  });
});

describe("pickStartFile", () => {
  const e = (name: string, is_dir = false) => ({ name, path: `/p/${name}`, is_dir });

  it("prefers the README, then manifests", () => {
    expect(pickStartFile([e("package.json"), e("Readme.MD"), e("src", true)])).toBe("/p/Readme.MD");
    expect(pickStartFile([e("Cargo.toml"), e("package.json")])).toBe("/p/package.json");
  });

  it("ignores folders with a matching name and returns null when nothing fits", () => {
    expect(pickStartFile([e("README.md", true)])).toBeNull();
    expect(pickStartFile([e("notes.txt"), e("src", true)])).toBeNull();
    expect(pickStartFile([])).toBeNull();
  });
});

describe("BUILTIN_LAYOUTS", () => {
  it("covers every layout id once", () => {
    expect(BUILTIN_LAYOUTS.map((l) => l.id).sort()).toEqual(["all", "code", "terminals"]);
  });
});
