import { describe, expect, test } from "bun:test";

import {
  minimalChange,
  detectIndentUnit,
  getCodeMirror,
  languageExtensionForId,
} from "./codemirror";
import { isKnownLanguageId } from "./codemirrorLanguages";

describe("languageExtensionForId", () => {
  test("resolves a non-null extension for every language id the app uses", async () => {
    const ids = [
      "plaintext", "typescript", "tsx", "javascript", "jsx", "json", "jsonc",
      "html", "css", "scss", "less", "markdown", "yaml", "ini", "xml",
      "shell", "powershell", "python", "rust", "go", "java", "c", "cpp",
      "csharp", "php", "ruby", "swift", "kotlin", "sql", "dockerfile",
      "bat", "lua", "dart", "scala", "perl", "r", "groovy", "hcl",
      "proto", "graphql",
    ];
    for (const id of ids) {
      const ext = await languageExtensionForId(id);
      // After awaiting, the value must be a real Extension, not a Promise —
      // passing a Promise into CM's ExtensionSet was the bug we're
      // guarding against (Unrecognized extension value in extension set
      // ([object Promise])).
      expect(ext).not.toBeNull();
      expect(ext).not.toBeInstanceOf(Promise);
    }
  });

  test("plaintext is the safe default for unknown ids", async () => {
    const ext = await languageExtensionForId("some-future-language");
    expect(ext).not.toBeNull();
    expect(ext).not.toBeInstanceOf(Promise);
  });

  test("isKnownLanguageId recognises every packed language", () => {
    for (const id of ["javascript", "rust", "python", "go", "yaml", "sql", "markdown", "bat", "hcl", "proto", "graphql"]) {
      expect(isKnownLanguageId(id)).toBe(true);
    }
    expect(isKnownLanguageId("made-up-language")).toBe(false);
    expect(isKnownLanguageId("")).toBe(false);
  });
});

describe("getCodeMirror", () => {
  test("resolves the @codemirror/view module", async () => {
    const m = await getCodeMirror();
    expect(m.EditorView).toBeDefined();
    expect(m.EditorView).toBeTypeOf("function");
  });

  test("returns the same promise on repeated calls", async () => {
    const a = await getCodeMirror();
    const b = await getCodeMirror();
    expect(a).toBe(b);
  });
});

describe("detectIndentUnit", () => {
  test("follows the file's own indentation", () => {
    expect(detectIndentUnit("def f():\n    if x:\n        return 1\n    return 2\n")).toBe("    ");
    expect(detectIndentUnit("{\n  \"a\": {\n    \"b\": 1\n  }\n}\n")).toBe("  ");
    expect(detectIndentUnit("fn main() {\n\tlet x = 1;\n\tif x {\n\t\tx;\n\t}\n}\n")).toBe("\t");
  });

  test("defaults to two spaces when there is nothing to learn from", () => {
    expect(detectIndentUnit("")).toBe("  ");
    expect(detectIndentUnit("a\nb\nc")).toBe("  ");
  });
});

describe("minimalChange", () => {
  const apply = (a: string, c: { from: number; to: number; insert: string }) => a.slice(0, c.from) + c.insert + a.slice(c.to);

  test("replaces only the differing middle", () => {
    const a = "line 1\nline 2\nline 3\n";
    const b = "line 1\nline two\nline 3\n";
    const c = minimalChange(a, b);
    expect(c.from).toBe(12);
    expect(apply(a, c)).toBe(b);
  });

  test("handles appends, deletions and identical text", () => {
    for (const [a, b] of [
      ["abc", "abcdef"],
      ["abcdef", "abc"],
      ["", "x"],
      ["x", ""],
      ["same", "same"],
      ["aaa", "aa"],
    ]) {
      expect(apply(a, minimalChange(a, b))).toBe(b);
    }
    expect(minimalChange("same", "same")).toEqual({ from: 4, to: 4, insert: "" });
  });
});
