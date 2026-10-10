import { describe, expect, it } from "bun:test";

import { topCommands } from "./projectRun";

const g = (tool: string, cmds: string[]) => ({ tool, commands: cmds.map((cmd) => ({ label: cmd, cmd })) });

describe("topCommands", () => {
  it("interleaves toolchains and respects the limit", () => {
    const out = topCommands([g("a", ["a1", "a2", "a3"]), g("b", ["b1", "b2"])], 4);
    expect(out.map((c) => c.cmd)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("drops duplicate commands and handles no groups", () => {
    expect(topCommands([g("a", ["x"]), g("b", ["x"])]).map((c) => c.cmd)).toEqual(["x"]);
    expect(topCommands([])).toEqual([]);
  });
});
