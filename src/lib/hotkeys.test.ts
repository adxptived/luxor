import { describe, expect, test } from "bun:test";

import { normalizeChord } from "./hotkeys";

describe("normalizeChord", () => {
  test("normalizes modifier order", () => {
    expect(normalizeChord("Shift+Ctrl+P")).toBe("Ctrl+Shift+P");
    expect(normalizeChord("Alt+Ctrl+Shift+P")).toBe("Ctrl+Alt+Shift+P");
  });

  test("treats Meta as the cross-platform Ctrl alias", () => {
    expect(normalizeChord("Meta+Shift+P")).toBe("Ctrl+Shift+P");
  });

  test("trims whitespace and ignores empty parts", () => {
    expect(normalizeChord(" Ctrl +  Shift + P ")).toBe("Ctrl+Shift+P");
    expect(normalizeChord("+")).toBe("");
  });
});
