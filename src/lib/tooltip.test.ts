import { describe, expect, it } from "bun:test";

import { placeTooltip } from "./tooltip";

const vp = { width: 1000, height: 600 };
const tip = { width: 80, height: 24 };

describe("placeTooltip", () => {
  it("centres below the target by default", () => {
    const p = placeTooltip({ left: 100, top: 100, width: 40, height: 20 }, tip, vp);
    expect(p).toEqual({ left: 80, top: 126, side: "bottom" });
  });

  it("flips above when there is no room below", () => {
    const p = placeTooltip({ left: 100, top: 570, width: 40, height: 20 }, tip, vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(570 - 6 - 24);
  });

  it("clamps horizontally to the viewport edges", () => {
    expect(placeTooltip({ left: 0, top: 10, width: 20, height: 20 }, tip, vp).left).toBe(6);
    expect(placeTooltip({ left: 990, top: 10, width: 10, height: 20 }, tip, vp).left).toBe(1000 - 80 - 6);
  });

  it("places nav-rail tooltips to the right, vertically centred", () => {
    const p = placeTooltip({ left: 0, top: 200, width: 44, height: 36 }, tip, vp, "right");
    expect(p).toEqual({ left: 50, top: 206, side: "right" });
  });

  it("falls back below when the right side would overflow", () => {
    const p = placeTooltip({ left: 960, top: 200, width: 30, height: 30 }, tip, vp, "right");
    expect(p.side).toBe("bottom");
  });
});
