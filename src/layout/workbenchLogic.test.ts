import { describe, expect, it } from "bun:test";

import {
  decideTerminalToggle,
  filePlacement,
  groupRole,
  previewToReplace,
  terminalPlacement,
  type GroupSnapshot,
} from "./workbenchLogic";

const g = (id: string, components: string[], visible = true, grid = true): GroupSnapshot => ({
  id,
  components,
  visible,
  grid,
});

describe("groupRole", () => {
  it("classifies groups by their panels", () => {
    expect(groupRole([])).toBe("empty");
    expect(groupRole(["terminal", "terminal"])).toBe("terminal");
    expect(groupRole(["editor", "terminal"])).toBe("file");
    expect(groupRole(["git", "tasks"])).toBe("tool");
    expect(groupRole(["welcome", "terminal"])).toBe("tool");
  });
});

describe("decideTerminalToggle (Ctrl+`)", () => {
  const editors = g("e", ["editor"]);

  it("creates a terminal when there is none", () => {
    expect(decideTerminalToggle([editors], "e")).toEqual({ kind: "create" });
  });

  it("shows a hidden terminal panel and focuses it", () => {
    const action = decideTerminalToggle([editors, g("t", ["terminal"], false)], "e");
    expect(action).toEqual({ kind: "show", groupIds: ["t"], focus: "t" });
  });

  it("focuses a visible panel when focus is elsewhere", () => {
    expect(decideTerminalToggle([editors, g("t", ["terminal"])], "e")).toEqual({ kind: "focus", groupId: "t" });
  });

  it("hides the panel when a terminal is focused and returns focus to the editors", () => {
    const action = decideTerminalToggle([editors, g("t1", ["terminal"]), g("t2", ["terminal"])], "t2", "t2", "e");
    expect(action).toEqual({ kind: "hide", groupIds: ["t1", "t2"], focus: "e" });
  });

  it("never hides when terminals are all the dock has", () => {
    expect(decideTerminalToggle([g("t", ["terminal"])], "t")).toEqual({ kind: "focus", groupId: "t" });
  });

  it("'show' mode never hides", () => {
    expect(decideTerminalToggle([editors, g("t", ["terminal"])], "t", "t", "e", "show")).toEqual({
      kind: "focus",
      groupId: "t",
    });
  });

  it("'visibility' mode (Ctrl+J) hides a visible panel even from the editor", () => {
    expect(decideTerminalToggle([editors, g("t", ["terminal"])], "e", "t", "e", "visibility")).toEqual({
      kind: "hide",
      groupIds: ["t"],
      focus: "e",
    });
  });

  it("prefers the terminal group used last", () => {
    const action = decideTerminalToggle([editors, g("t1", ["terminal"]), g("t2", ["terminal"])], "e", "t2");
    expect(action).toEqual({ kind: "focus", groupId: "t2" });
  });

  it("ignores floating terminal groups", () => {
    expect(decideTerminalToggle([editors, g("f", ["terminal"], true, false)], "e")).toEqual({ kind: "create" });
  });
});

describe("terminalPlacement", () => {
  it("joins an existing terminal group, re-showing it when hidden", () => {
    expect(terminalPlacement([g("e", ["editor"]), g("t", ["terminal"], false)], "e")).toEqual({
      kind: "within",
      groupId: "t",
      reveal: true,
    });
  });

  it("opens a bottom panel next to documents", () => {
    expect(terminalPlacement([g("e", ["editor"])], "e")).toEqual({ kind: "edge", direction: "below" });
  });

  it("fills an empty dock or one that only shows Welcome", () => {
    expect(terminalPlacement([], null)).toEqual({ kind: "default" });
    expect(terminalPlacement([g("w", ["welcome"])], "w")).toEqual({ kind: "default" });
  });
});

describe("filePlacement", () => {
  it("uses the active document group, else the remembered one", () => {
    const groups = [g("a", ["editor"]), g("b", ["editor"]), g("t", ["terminal"])];
    expect(filePlacement(groups, "b")).toEqual({ kind: "within", groupId: "b", reveal: false });
    expect(filePlacement(groups, "t", "a")).toEqual({ kind: "within", groupId: "a", reveal: false });
  });

  it("splits above a focused terminal group instead of joining its tabs", () => {
    expect(filePlacement([g("t", ["terminal"])], "t")).toEqual({ kind: "split", groupId: "t", direction: "above" });
  });

  it("keeps dockview's default next to tool panels", () => {
    expect(filePlacement([g("x", ["git"])], "x")).toEqual({ kind: "default" });
  });
});

describe("previewToReplace", () => {
  it("replaces the clean preview tab only", () => {
    expect(
      previewToReplace([
        { id: "a", preview: false, dirty: false },
        { id: "b", preview: true, dirty: true },
        { id: "c", preview: true, dirty: false },
      ]),
    ).toBe("c");
    expect(previewToReplace([{ id: "a", preview: false, dirty: false }])).toBeNull();
  });
});
