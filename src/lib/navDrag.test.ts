import { describe, expect, test } from "bun:test";

import { nextNavDropConfig } from "./navDrag";

describe("nextNavDropConfig", () => {
  test("moves a topbar button into the sidebar zone", () => {
    const next = nextNavDropConfig(
      { nav_order: ["terminal", "git", "files"], nav_hidden: [], nav_sidebar: [], nav_chrome: [], nav_topbar_left: [], nav_topbar_center: [] },
      "git",
      null,
      "sidebar",
    );

    expect(next.nav_sidebar).toEqual(["git"]);
    expect(next.nav_chrome).toEqual([]);
    expect(next.nav_hidden).toEqual([]);
  });

  test("moves a sidebar button back to topbar and removes it from other zones", () => {
    const next = nextNavDropConfig(
      { nav_order: ["terminal", "git", "files"], nav_hidden: [], nav_sidebar: ["git"], nav_chrome: [], nav_topbar_left: [], nav_topbar_center: [] },
      "git",
      "files",
      "topbar",
    );

    expect(next.nav_sidebar).toEqual([]);
    expect(next.nav_chrome).toEqual([]);
    expect(next.nav_hidden).toEqual([]);
    expect(next.nav_order.indexOf("git")).toBeLessThan(next.nav_order.indexOf("files"));
  });

  test("keeps zones exclusive when moving into right chrome", () => {
    const next = nextNavDropConfig(
      { nav_order: ["terminal", "git", "files"], nav_hidden: [], nav_sidebar: ["git"], nav_chrome: [], nav_topbar_left: [], nav_topbar_center: [] },
      "git",
      null,
      "chrome",
    );

    expect(next.nav_sidebar).toEqual([]);
    expect(next.nav_chrome).toEqual(["git"]);
    expect(next.nav_hidden).toEqual([]);
  });

  test("aligns a topbar button to the left group", () => {
    const next = nextNavDropConfig(
      { nav_order: ["terminal", "git", "files"], nav_hidden: [], nav_sidebar: [], nav_chrome: [], nav_topbar_left: [], nav_topbar_center: [] },
      "git",
      null,
      "topbar-left",
    );

    expect(next.nav_topbar_left).toEqual(["git"]);
    expect(next.nav_topbar_center).toEqual([]);
    expect(next.nav_sidebar).toEqual([]);
    expect(next.nav_chrome).toEqual([]);
  });

  test("moving to topbar-right clears any left/center alignment", () => {
    const next = nextNavDropConfig(
      {
        nav_order: ["terminal", "git", "files"],
        nav_hidden: [],
        nav_sidebar: [],
        nav_chrome: [],
        nav_topbar_left: ["git"],
        nav_topbar_center: [],
      },
      "git",
      null,
      "topbar-right",
    );

    expect(next.nav_topbar_left).toEqual([]);
    expect(next.nav_topbar_center).toEqual([]);
    expect(next.nav_sidebar).toEqual([]);
    expect(next.nav_chrome).toEqual([]);
  });
});
