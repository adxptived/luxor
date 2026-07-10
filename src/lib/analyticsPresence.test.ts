import { describe, expect, test } from "bun:test";

import { buildPresenceInput } from "./analytics";

const base = {
  projectName: "luxor" as string | null,
  branch: "main" as string | null,
  agent: null as string | null,
  sessionSeconds: 1200,
  idleSeconds: 0,
  nowUnix: 1_718_900_000,
};

describe("buildPresenceInput — what the user is doing → presence context", () => {
  test("coding: active project, branch and session timer", () => {
    const p = buildPresenceInput({ ...base, category: "coding" });
    expect(p.project_name).toBe("luxor");
    expect(p.branch).toBe("main");
    expect(p.idle).toBe(false);
    expect(p.idle_since_unix).toBeNull();
    expect(p.session_seconds).toBe(1200);
    // Timer anchors to when the session actually started.
    expect(p.session_start_unix).toBe(1_718_900_000 - 1200);
  });

  test("ai: the detected agent is forwarded for the pair-programming frame", () => {
    const p = buildPresenceInput({ ...base, category: "ai", agent: "Claude Code" });
    expect(p.agent).toBe("Claude Code");
    expect(p.idle).toBe(false);
  });

  test("idle: flags AFK and anchors the idle timer to when idling began", () => {
    const p = buildPresenceInput({
      ...base,
      category: "idle",
      idleSeconds: 300,
      agent: "Claude Code",
    });
    expect(p.idle).toBe(true);
    expect(p.idle_since_unix).toBe(1_718_900_000 - 300);
    // A stale agent must not leak into an idle presence.
    expect(p.agent).toBeNull();
  });

  test("audit counts as active work, not idle", () => {
    const p = buildPresenceInput({ ...base, category: "audit" });
    expect(p.idle).toBe(false);
  });

  test("no active project still produces a valid context (always-on)", () => {
    const p = buildPresenceInput({
      ...base,
      projectName: null,
      branch: null,
      category: "coding",
      sessionSeconds: 0,
    });
    expect(p.project_name).toBeNull();
    expect(p.session_seconds).toBe(0);
    expect(p.session_start_unix).toBe(base.nowUnix);
  });
});
