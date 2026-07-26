import { describe, expect, test } from "bun:test";

import { AFK_THRESHOLD_SECONDS, classifyActivity, isUserActive } from "./analytics";

describe("isUserActive — OS input counter is the authority, focus is the fallback", () => {
  test("an unfocused Luxor window with recent OS input is still active work", () => {
    // The root cause of "Discord RPC doesn't work": Luxor is a cockpit, so the
    // user types in an external editor/terminal (or the app sits in the tray)
    // while actively working. Gating on `document.hasFocus()` classified that
    // as idle, and an idle context replaces the whole carousel with the single
    // "Idle / Taking a break" frame.
    expect(isUserActive({ focused: false, osIdleSeconds: 5 })).toBe(true);
  });

  test("OS input idle past the AFK threshold is idle even while focused", () => {
    expect(isUserActive({ focused: true, osIdleSeconds: AFK_THRESHOLD_SECONDS + 1 })).toBe(false);
  });

  test("exactly at the threshold counts as AFK", () => {
    expect(isUserActive({ focused: true, osIdleSeconds: AFK_THRESHOLD_SECONDS })).toBe(false);
    expect(isUserActive({ focused: true, osIdleSeconds: AFK_THRESHOLD_SECONDS - 1 })).toBe(true);
  });

  test("without an OS counter (Linux) it falls back to window focus", () => {
    expect(isUserActive({ focused: true, osIdleSeconds: null })).toBe(true);
    expect(isUserActive({ focused: false, osIdleSeconds: null })).toBe(false);
  });

  test("the AFK threshold matches the Rust AFK_THRESHOLD_SECONDS (5 min)", () => {
    expect(AFK_THRESHOLD_SECONDS).toBe(300);
  });
});

describe("classifyActivity — activity category pushed to telemetry & Discord", () => {
  test("active without an agent is plain coding", () => {
    expect(classifyActivity({ focused: false, osIdleSeconds: 10, agent: null })).toEqual({
      category: "coding",
      agent: null,
    });
  });

  test("an agent detected while unfocused still produces the AI frame", () => {
    // Agent detection used to sit behind the same focus gate, so the
    // pair-programming frame never appeared while the user worked in the agent's
    // own window — exactly when it is most accurate.
    expect(
      classifyActivity({ focused: false, osIdleSeconds: 3, agent: "Claude Code" }),
    ).toEqual({ category: "ai", agent: "Claude Code" });
  });

  test("a stale agent never leaks into an idle classification", () => {
    expect(
      classifyActivity({
        focused: true,
        osIdleSeconds: AFK_THRESHOLD_SECONDS + 60,
        agent: "Claude Code",
      }),
    ).toEqual({ category: "idle", agent: null });
  });

  test("no focus and no OS counter is idle", () => {
    expect(classifyActivity({ focused: false, osIdleSeconds: null, agent: null })).toEqual({
      category: "idle",
      agent: null,
    });
  });
});
