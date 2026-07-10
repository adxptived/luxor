import { describe, expect, test } from "bun:test";

import { detectLanguage, languageForPath, languageFromShebang, languageLabel } from "./editorLanguage";

describe("editor language detection", () => {
  test("detects common web and systems languages", () => {
    expect(languageForPath("src/App.tsx")).toBe("tsx");
    expect(languageForPath("src/App.jsx")).toBe("jsx");
    expect(languageForPath("src-tauri/src/main.rs")).toBe("rust");
    expect(languageForPath("scripts/build.ps1")).toBe("powershell");
    expect(languageForPath("backend/main.py")).toBe("python");
    expect(languageForPath("schema.sql")).toBe("sql");
  });

  test("detects IDE-important extensionless/config files", () => {
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("apps/api/Dockerfile.prod")).toBe("dockerfile");
    expect(languageForPath("Makefile")).toBe("shell");
    expect(languageForPath(".env.local")).toBe("ini");
    expect(languageForPath("CMakeLists.txt")).toBe("cpp");
  });

  test("recognises git hook scripts (with or without .sample)", () => {
    expect(languageForPath(".git/hooks/commit-msg.sample")).toBe("shell");
    expect(languageForPath(".git/hooks/pre-commit")).toBe("shell");
    expect(languageForPath("hooks/prepare-commit-msg.sample")).toBe("shell");
  });

  test("falls back to plaintext with a readable label", () => {
    expect(languageForPath("notes.unknownext")).toBe("plaintext");
    expect(languageLabel("plaintext")).toBe("Plain Text");
    expect(languageLabel("customlang")).toBe("Customlang");
  });

  test("maps shebang lines to a language", () => {
    expect(languageFromShebang("#!/bin/sh")).toBe("shell");
    expect(languageFromShebang("#!/bin/bash")).toBe("shell");
    expect(languageFromShebang("#!/usr/bin/env python3")).toBe("python");
    expect(languageFromShebang("#!/usr/bin/env node")).toBe("javascript");
    expect(languageFromShebang("#!/usr/bin/env ruby")).toBe("ruby");
    expect(languageFromShebang("not a shebang")).toBeNull();
  });

  test("detectLanguage prefers the path, then the shebang", () => {
    // Known extension wins outright.
    expect(detectLanguage("main.py", "#!/bin/sh\necho hi")).toBe("python");
    // Unknown name → fall back to the file's shebang.
    expect(detectLanguage("weird-script", "#!/usr/bin/env bash\nset -e")).toBe("shell");
    // No hint at all → plaintext.
    expect(detectLanguage("weird-script", "just some text")).toBe("plaintext");
  });
});
