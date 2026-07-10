import { describe, expect, test } from "bun:test";

import { FILE_MANAGER_IDE, SYSTEM_DEFAULT_IDE, mergeIdeActions, resolveDefaultIde, resolveIdeLabel } from "./ideActions";

describe("IDE actions", () => {
  test("merges custom IDEs before detected IDEs and dedupes by command", () => {
    const merged = mergeIdeActions(
      [{ label: "My Zed", command: "zed" }, { label: "", command: "  " }],
      [{ label: "Zed", command: "zed" }, { label: "VS Code", command: "code" }],
    );
    expect(merged).toEqual([
      { label: "My Zed", command: "zed" },
      { label: "VS Code", command: "code" },
    ]);
  });

  test("keeps system fallbacks available when requested", () => {
    const merged = mergeIdeActions([], [], true);
    expect(merged.map((i) => i.command)).toEqual([SYSTEM_DEFAULT_IDE, FILE_MANAGER_IDE]);
  });

  test("resolves configured defaults even if they are not currently detected", () => {
    const ides = mergeIdeActions([], [{ label: "VS Code", command: "code" }], true);
    expect(resolveDefaultIde(ides, "zed")).toEqual({ command: "zed", label: "Zed" });
    expect(resolveIdeLabel("C:/Tools/Zed/zed.exe", ides)).toBe("Zed");
  });
});
