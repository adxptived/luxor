import { beforeEach, describe, expect, test } from "bun:test";

import { dirtyGuardCount, isPanelDirty, registerDirtyGuard, resetDirtyGuards } from "./dirtyGuard";

describe("dirtyGuard", () => {
  beforeEach(resetDirtyGuards);

  test("unknown panels are clean", () => {
    expect(isPanelDirty("nope")).toBe(false);
  });

  test("reports the probe value", () => {
    let dirty = false;
    registerDirtyGuard("p1", () => dirty);
    expect(isPanelDirty("p1")).toBe(false);
    dirty = true;
    expect(isPanelDirty("p1")).toBe(true);
  });

  test("unregister removes the probe", () => {
    const off = registerDirtyGuard("p1", () => true);
    expect(isPanelDirty("p1")).toBe(true);
    off();
    expect(isPanelDirty("p1")).toBe(false);
    expect(dirtyGuardCount()).toBe(0);
  });

  test("unregister does not remove a replacement probe", () => {
    const off1 = registerDirtyGuard("p1", () => false);
    registerDirtyGuard("p1", () => true);
    off1();
    expect(isPanelDirty("p1")).toBe(true);
  });

  test("a throwing probe counts as clean", () => {
    registerDirtyGuard("p1", () => {
      throw new Error("boom");
    });
    expect(isPanelDirty("p1")).toBe(false);
  });
});
