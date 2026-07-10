import { describe, expect, test } from "bun:test";

import { fmtClock, remainingOf } from "./focusTimerStore";

describe("fmtClock", () => {
  test("formats mm:ss zero-padded", () => {
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(5)).toBe("00:05");
    expect(fmtClock(65)).toBe("01:05");
    expect(fmtClock(25 * 60)).toBe("25:00");
  });
});

describe("remainingOf", () => {
  test("running: derives seconds from the deadline", () => {
    const now = 1_000_000;
    expect(remainingOf({ running: true, endsAt: now + 90_000, pausedLeft: 0 }, now)).toBe(90);
  });

  test("running but past the deadline clamps to 0", () => {
    const now = 1_000_000;
    expect(remainingOf({ running: true, endsAt: now - 5_000, pausedLeft: 0 }, now)).toBe(0);
  });

  test("paused: uses pausedLeft", () => {
    expect(remainingOf({ running: false, endsAt: null, pausedLeft: 300 })).toBe(300);
  });

  test("never returns a negative value", () => {
    expect(remainingOf({ running: false, endsAt: null, pausedLeft: -10 })).toBe(0);
  });
});
