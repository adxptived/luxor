import { describe, expect, it } from "bun:test";

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  nextSidebarState,
  parseWorkbench,
} from "./workbenchStore";

describe("nextSidebarState", () => {
  it("opens a hidden side bar on the requested (or current) view", () => {
    expect(nextSidebarState({ open: false, view: "explorer" }, "search")).toEqual({ open: true, view: "search" });
    expect(nextSidebarState({ open: false, view: "search" })).toEqual({ open: true, view: "search" });
  });

  it("switches views without closing, and closes on the view already shown", () => {
    expect(nextSidebarState({ open: true, view: "explorer" }, "search")).toEqual({ open: true, view: "search" });
    expect(nextSidebarState({ open: true, view: "explorer" }, "explorer")).toEqual({ open: false, view: "explorer" });
    expect(nextSidebarState({ open: true, view: "search" })).toEqual({ open: false, view: "search" });
  });
});

describe("parseWorkbench", () => {
  it("defaults to an open explorer for new installs and corrupt data", () => {
    const fallback = { sidebarOpen: true, sidebarView: "explorer" as const, sidebarWidth: SIDEBAR_DEFAULT_WIDTH };
    expect(parseWorkbench(null)).toEqual(fallback);
    expect(parseWorkbench("{not json")).toEqual(fallback);
  });

  it("keeps valid values and clamps the width", () => {
    expect(parseWorkbench(JSON.stringify({ sidebarOpen: false, sidebarView: "search", sidebarWidth: 9999 }))).toEqual({
      sidebarOpen: false,
      sidebarView: "search",
      sidebarWidth: SIDEBAR_MAX_WIDTH,
    });
    expect(parseWorkbench(JSON.stringify({ sidebarView: "bogus", sidebarWidth: 10 })).sidebarView).toBe("explorer");
    expect(parseWorkbench(JSON.stringify({ sidebarWidth: 10 })).sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("clampSidebarWidth rounds and survives NaN", () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
