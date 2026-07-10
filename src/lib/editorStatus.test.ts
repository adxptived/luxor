import { describe, expect, it } from "bun:test";

import { cursorLabel, langLabel, selectionLabel } from "./editorStatus";

describe("langLabel", () => {
  it("maps known Monaco ids to pretty names", () => {
    expect(langLabel("typescript")).toBe("TypeScript");
    expect(langLabel("rust")).toBe("Rust");
    expect(langLabel("ini")).toBe("INI / TOML");
    expect(langLabel("plaintext")).toBe("Plain Text");
  });

  it("falls back to a capitalised id for unknown languages", () => {
    expect(langLabel("dart")).toBe("Dart");
  });

  it("treats an empty id as plain text", () => {
    expect(langLabel("")).toBe("Plain Text");
  });
});

describe("cursorLabel", () => {
  it("formats a 1-based line/column", () => {
    expect(cursorLabel(1, 1)).toBe("Ln 1, Col 1");
    expect(cursorLabel(12, 5)).toBe("Ln 12, Col 5");
  });
});

describe("selectionLabel", () => {
  it("is empty with no selection", () => {
    expect(selectionLabel(0, 0)).toBe("");
    expect(selectionLabel(0, 1)).toBe("");
  });

  it("summarises a single range", () => {
    expect(selectionLabel(12, 1)).toBe(" (12 selected)");
  });

  it("summarises multiple ranges", () => {
    expect(selectionLabel(30, 3)).toBe(" (30 selected in 3 ranges)");
  });
});
