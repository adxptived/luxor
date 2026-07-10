import { describe, expect, test } from "bun:test";

import {
  NAV_BUTTONS,
  NAV_IDS,
  moveNavButton,
  navButtonDef,
  nudgeNavButton,
  resolveNavOrder,
  visibleNavButtons,
} from "./navButtons";

describe("resolveNavOrder", () => {
  test("empty saved order falls back to defaults", () => {
    expect(resolveNavOrder([])).toEqual(NAV_IDS);
  });

  test("saved prefix wins, missing ids appended in default order", () => {
    const order = resolveNavOrder(["settings", "git"]);
    expect(order[0]).toBe("settings");
    expect(order[1]).toBe("git");
    expect(order).toHaveLength(NAV_IDS.length);
    expect(new Set(order)).toEqual(new Set(NAV_IDS));
  });

  test("unknown and duplicate ids are dropped", () => {
    const order = resolveNavOrder(["bogus", "git", "git", "nope"]);
    expect(order[0]).toBe("git");
    expect(order).toHaveLength(NAV_IDS.length);
  });
});

describe("moveNavButton", () => {
  test("moves drag id to target position", () => {
    const order = moveNavButton([], "settings", "terminal");
    expect(order[0]).toBe("settings");
  });

  test("no-op for unknown ids", () => {
    expect(moveNavButton([], "bogus", "terminal")).toEqual(NAV_IDS);
  });
});

describe("nudgeNavButton", () => {
  test("moves one step and clamps at edges", () => {
    const down = nudgeNavButton([], "terminal", 1);
    expect(down[1]).toBe("terminal");
    expect(nudgeNavButton([], "terminal", -1)).toEqual(NAV_IDS);
    expect(nudgeNavButton([], "settings", 1)).toEqual(NAV_IDS);
  });
});

describe("visibleNavButtons", () => {
  test("filters hidden ids", () => {
    const visible = visibleNavButtons([], ["git", "presets"]);
    expect(visible.map((b) => b.id)).not.toContain("git");
    expect(visible).toHaveLength(NAV_BUTTONS.length - 2);
  });

  test("every default button has a definition", () => {
    for (const id of NAV_IDS) expect(navButtonDef(id)).toBeDefined();
  });
});
