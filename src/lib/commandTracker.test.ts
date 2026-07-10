import { describe, expect, test } from "bun:test";

import { CommandTracker } from "./commandTracker";

describe("CommandTracker — OSC 133", () => {
  test("reports duration and exit code from C/D marks", () => {
    const t = new CommandTracker();
    t.oscCommandStart(1_000);
    const n = t.oscCommandDone(0, 31_000);
    expect(n).toEqual({ kind: "command_done", durationSecs: 30, exitCode: 0 });
  });

  test("D without C is ignored (prompt printed at startup)", () => {
    const t = new CommandTracker();
    expect(t.oscCommandDone(0, 5_000)).toBeNull();
  });

  test("OSC disables the process-tree fallback", () => {
    const t = new CommandTracker();
    t.oscCommandStart(0);
    expect(t.oscCommandDone(1, 20_000)?.exitCode).toBe(1);
    // Later tree samples must not double-report.
    expect(t.treeSample(3, [], 30_000)).toEqual([]);
    expect(t.treeSample(1, [], 60_000)).toEqual([]);
  });

  test("agent sessions suppress command_done from OSC", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Claude Code"], 0);
    t.oscCommandStart(1_000);
    expect(t.oscCommandDone(0, 60_000)).toBeNull();
  });
});

describe("CommandTracker — process-tree fallback", () => {
  test("tree grows then shrinks → command_done with duration", () => {
    const t = new CommandTracker();
    expect(t.treeSample(1, [], 0)).toEqual([]);
    expect(t.treeSample(4, [], 5_000)).toEqual([]);
    expect(t.treeSample(4, [], 10_000)).toEqual([]);
    const out = t.treeSample(1, [], 65_000);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("command_done");
    expect(out[0].durationSecs).toBe(60);
    expect(out[0].exitCode).toBeNull();
    // No repeat once idle.
    expect(t.treeSample(1, [], 70_000)).toEqual([]);
  });

  test("agent processes do not count as plain commands", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Claude Code"], 0);
    expect(t.treeSample(1, [], 120_000)).toEqual([]);
  });
});

describe("CommandTracker — agent responses", () => {
  test("output burst then silence → agent_done", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Claude Code"], 0);
    t.output(10_000);
    t.output(12_000);
    t.output(14_000);
    expect(t.tick(15_000)).toBeNull(); // still streaming
    const n = t.tick(17_500);
    expect(n).toEqual({ kind: "agent_done", agents: ["Claude Code"] });
    expect(t.tick(20_000)).toBeNull(); // fires once
  });

  test("typing echoes never count as a response", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Codex CLI"], 0);
    for (let ts = 1_000; ts < 8_000; ts += 200) {
      t.userInput(ts);
      t.output(ts + 30); // echo right after each keystroke
    }
    expect(t.tick(15_000)).toBeNull();
  });

  test("short bursts (spinner redraws) are ignored", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Claude Code"], 0);
    t.output(10_000);
    t.output(10_500);
    expect(t.tick(14_000)).toBeNull();
  });

  test("agent exiting mid-burst finishes the response", () => {
    const t = new CommandTracker();
    t.treeSample(2, ["Gemini CLI"], 0);
    t.output(10_000);
    t.output(13_000);
    const out = t.treeSample(1, [], 14_000);
    expect(out).toEqual([{ kind: "agent_done", agents: ["Gemini CLI"] }]);
  });

  test("no agent in tree → no agent tracking", () => {
    const t = new CommandTracker();
    t.treeSample(1, [], 0);
    t.output(10_000);
    t.output(13_000);
    expect(t.tick(20_000)).toBeNull();
  });
});
