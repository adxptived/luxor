import { describe, expect, test } from "bun:test";

import {
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
