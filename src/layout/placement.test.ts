import { beforeEach, describe, expect, it } from "bun:test";

import { forgetDock, pickGroup, placementKindOf, rememberGroup, rememberedGroup, type GroupInfo } from "./placement";

const groups: GroupInfo[] = [
  { id: "side", components: ["files", "git"] },
  { id: "code", components: ["editor", "editor", "pdf"] },
  { id: "term", components: ["terminal", "terminal"] },
];

describe("placementKindOf", () => {
  it("classifies documents and terminals, ignores tool panels", () => {
    expect(placementKindOf("editor")).toBe("file");
    expect(placementKindOf("diff")).toBe("file");
    expect(placementKindOf("image")).toBe("file");
    expect(placementKindOf("terminal")).toBe("terminal");
    expect(placementKindOf("files")).toBeNull();
    expect(placementKindOf("git")).toBeNull();
    expect(placementKindOf(undefined)).toBeNull();
  });
});

describe("pickGroup", () => {
  it("sends a file to the editor group even when a terminal group is active", () => {
    expect(pickGroup(groups, "term", "file")).toBe("code");
  });

  it("sends a file to the editor group when the explorer group is active", () => {
    expect(pickGroup(groups, "side", "file")).toBe("code");
  });

  it("sends a terminal to the terminal group when the editor group is active", () => {
    expect(pickGroup(groups, "code", "terminal")).toBe("term");
  });

  it("keeps the active group when it already fits", () => {
    expect(pickGroup(groups, "code", "file")).toBe("code");
    expect(pickGroup(groups, "term", "terminal")).toBe("term");
  });

  it("returns null when no group holds that kind, so dockview decides", () => {
    expect(pickGroup([{ id: "side", components: ["files"] }], "side", "file")).toBeNull();
    expect(pickGroup([], null, "terminal")).toBeNull();
  });

  it("prefers the remembered group over the first one", () => {
    const two: GroupInfo[] = [
      { id: "a", components: ["editor"] },
      { id: "b", components: ["editor"] },
      { id: "t", components: ["terminal"] },
    ];
    expect(pickGroup(two, "t", "file", "b")).toBe("b");
    expect(pickGroup(two, "t", "file", "gone")).toBe("a");
    expect(pickGroup(two, null, "file")).toBe("a");
  });
});

describe("group memory", () => {
  beforeEach(() => forgetDock("p1"));

  it("remembers the last group per kind and per dock", () => {
    rememberGroup("p1", "editor", "code");
    rememberGroup("p1", "terminal", "term");
    rememberGroup("p1", "files", "side"); // tool panels are ignored
    expect(rememberedGroup("p1", "file")).toBe("code");
    expect(rememberedGroup("p1", "terminal")).toBe("term");
    expect(rememberedGroup("p2", "file")).toBeUndefined();
  });

  it("overwrites with the most recent group", () => {
    rememberGroup("p1", "editor", "a");
    rememberGroup("p1", "pdf", "b");
    expect(rememberedGroup("p1", "file")).toBe("b");
  });
});
