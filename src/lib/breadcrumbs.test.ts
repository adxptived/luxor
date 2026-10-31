import { describe, expect, it } from "bun:test";

import { breadcrumbs } from "./breadcrumbs";

describe("breadcrumbs", () => {
  it("is relative to the project, starting with its name", () => {
    expect(breadcrumbs("/home/dev/shop/src/App.tsx", "/home/dev/shop", "shop")).toEqual([
      { label: "shop", path: "/home/dev/shop" },
      { label: "src", path: "/home/dev/shop/src" },
      { label: "App.tsx", path: "/home/dev/shop/src/App.tsx" },
    ]);
  });

  it("handles Windows paths", () => {
    expect(breadcrumbs("C:\\code\\api\\main.rs", "C:\\code\\api", "api")).toEqual([
      { label: "api", path: "C:\\code\\api" },
      { label: "main.rs", path: "C:\\code\\api\\main.rs" },
    ]);
  });

  it("falls back to the absolute path outside the project", () => {
    expect(breadcrumbs("/etc/hosts", "/home/dev/shop", "shop")).toEqual([
      { label: "etc", path: "/etc" },
      { label: "hosts", path: "/etc/hosts" },
    ]);
    // A sibling folder sharing the prefix is not "inside".
    expect(breadcrumbs("/home/dev/shop2/a.ts", "/home/dev/shop", "shop")[0].label).toBe("home");
  });
});
