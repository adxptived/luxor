import { describe, expect, test } from "bun:test";

import {
  SEGMENT_IDS,
  SEGMENT_TOGGLES,
  SPACER_ID,
  moveSegment,
  nudgeSegment,
  resolveSegmentOrder,
  segmentLabel,
} from "./statusSegments";

describe("resolveSegmentOrder", () => {
  test("empty saved order falls back to defaults (with spacer)", () => {
    const order = resolveSegmentOrder([]);
    expect(order).toEqual(SEGMENT_IDS);
    expect(order).toContain(SPACER_ID);
  });

  test("partial saved order keeps all segments exactly once", () => {
    const order = resolveSegmentOrder(["ram", "junk", "cpu"]);
    expect(order[0]).toBe("ram");
    expect(order[1]).toBe("cpu");
    expect(new Set(order)).toEqual(new Set(SEGMENT_IDS));
  });
});

describe("moveSegment / nudgeSegment", () => {
  test("drag reorder moves segment to target slot", () => {
    const order = moveSegment([], "ram", "project");
    expect(order[0]).toBe("ram");
  });

  test("segments can cross the spacer", () => {
    const order = moveSegment([], "project", "cpu");
    expect(order.indexOf("project")).toBeGreaterThan(order.indexOf(SPACER_ID));
  });

  test("nudge clamps at edges", () => {
    expect(nudgeSegment([], "project", -1)).toEqual(SEGMENT_IDS);
    expect(nudgeSegment([], "zoom", 1)).toEqual(SEGMENT_IDS);
    expect(nudgeSegment([], "cpu", -1).indexOf("cpu")).toBe(SEGMENT_IDS.indexOf("cpu") - 1);
  });
});

describe("segment metadata", () => {
  test("every non-spacer segment has a visibility toggle", () => {
    for (const id of SEGMENT_IDS) {
      if (id === SPACER_ID) continue;
      expect(SEGMENT_TOGGLES[id]).toBeDefined();
    }
  });

  test("spacer has no toggle and labels resolve", () => {
    expect(SEGMENT_TOGGLES[SPACER_ID]).toBeUndefined();
    expect(segmentLabel("cpu")).toBe("CPU usage");
    expect(segmentLabel("unknown")).toBe("unknown");
  });
});
