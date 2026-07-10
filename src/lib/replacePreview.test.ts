import { describe, expect, it } from "bun:test";

import { previewReplacement } from "./replacePreview";

describe("previewReplacement", () => {
  it("returns the raw replacement in literal mode", () => {
    expect(previewReplacement("foo", "bar", false, true, "foo")).toEqual({ replaced: "bar" });
  });

  it("expands numbered capture groups in regex mode", () => {
    expect(previewReplacement("user_42", "id:$1", true, true, "user_(\\d+)")).toEqual({ replaced: "id:42" });
  });

  it("expands Rust-style named groups (${name})", () => {
    expect(previewReplacement("user_42", "id:${num}", true, true, "user_(?<num>\\d+)")).toEqual({
      replaced: "id:42",
    });
  });

  it("is case-insensitive when caseSensitive=false", () => {
    expect(previewReplacement("FOO", "bar", true, false, "foo")).toEqual({ replaced: "bar" });
  });

  it("returns null when the pattern no longer matches the hit text", () => {
    expect(previewReplacement("foo", "bar", true, true, "baz")).toEqual({ replaced: null });
  });

  it("returns null for invalid regex instead of throwing", () => {
    expect(previewReplacement("foo", "bar", true, true, "(")).toEqual({ replaced: null });
  });
});
