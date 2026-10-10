import { describe, expect, it } from "bun:test";

import { activityOf } from "../lib/terminalActivity";

describe("activityOf", () => {
  it("exit codes win over process counts", () => {
    expect(activityOf(0, 3)).toBe("exited");
    expect(activityOf(1, null)).toBe("failed");
    expect(activityOf(-1, null)).toBe("failed");
  });
  it("more than the shell itself means something is running", () => {
    expect(activityOf(null, 2)).toBe("running");
    expect(activityOf(null, 1)).toBe("idle");
    expect(activityOf(null, null)).toBe("idle");
  });
});
