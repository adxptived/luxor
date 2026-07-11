import { describe, expect, it } from "bun:test";

import {
  sanitizeDisplayString,
  validateBranchName,
  validateFilePath,
  validateHttpUrl,
  validateOrThrow,
  validateProjectName,
} from "./validation";

describe("validateHttpUrl", () => {
  it("accepts plain http/https URLs", () => {
    expect(validateHttpUrl("https://example.com/hook").valid).toBe(true);
    expect(validateHttpUrl("http://example.com:8080/path?q=1").valid).toBe(true);
  });

  it("rejects empty and malformed URLs", () => {
    expect(validateHttpUrl("").valid).toBe(false);
    expect(validateHttpUrl("   ").valid).toBe(false);
    expect(validateHttpUrl("not a url").valid).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(validateHttpUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateHttpUrl("javascript:alert(1)").valid).toBe(false);
    expect(validateHttpUrl("ftp://example.com").valid).toBe(false);
  });

  it("rejects URLs with embedded credentials (matches backend httpx policy)", () => {
    expect(validateHttpUrl("https://user:secret@example.com/").valid).toBe(false);
    expect(validateHttpUrl("https://user@example.com/").valid).toBe(false);
  });

  it("rejects oversized URLs", () => {
    expect(validateHttpUrl(`https://example.com/${"a".repeat(2048)}`).valid).toBe(false);
  });
});

describe("validateFilePath", () => {
  it("accepts normal absolute and relative paths", () => {
    expect(validateFilePath("/home/user/project/src/main.rs").valid).toBe(true);
    expect(validateFilePath("C:\\Users\\dev\\project").valid).toBe(true);
    expect(validateFilePath("src/lib/poll.ts").valid).toBe(true);
  });

  it("rejects traversal, null bytes and empty paths", () => {
    expect(validateFilePath("../../etc/passwd").valid).toBe(false);
    expect(validateFilePath("src/../../secret").valid).toBe(false);
    expect(validateFilePath("..\\..\\windows").valid).toBe(false);
    expect(validateFilePath("..").valid).toBe(false);
    expect(validateFilePath("/tmp/..").valid).toBe(false);
    expect(validateFilePath("a\0b").valid).toBe(false);
    expect(validateFilePath("").valid).toBe(false);
  });
});

describe("validateBranchName", () => {
  it("accepts common branch names", () => {
    expect(validateBranchName("main").valid).toBe(true);
    expect(validateBranchName("feature/add-diagnostics").valid).toBe(true);
    expect(validateBranchName("fix_123").valid).toBe(true);
  });

  it("rejects names git itself rejects", () => {
    expect(validateBranchName("").valid).toBe(false);
    expect(validateBranchName("bad..name").valid).toBe(false);
    expect(validateBranchName("has space").valid).toBe(false);
    expect(validateBranchName("tilde~1").valid).toBe(false);
    expect(validateBranchName("-starts-dash").valid).toBe(false);
    expect(validateBranchName(".starts-dot").valid).toBe(false);
    expect(validateBranchName("ends.lock").valid).toBe(false);
    expect(validateBranchName("ends/").valid).toBe(false);
  });
});

describe("validateProjectName", () => {
  it("accepts latin, cyrillic and common punctuation", () => {
    expect(validateProjectName("My Project 2.0 (beta)").valid).toBe(true);
    expect(validateProjectName("Проект-1").valid).toBe(true);
  });

  it("rejects empty names and shell metacharacters", () => {
    expect(validateProjectName("").valid).toBe(false);
    expect(validateProjectName("   ").valid).toBe(false);
    expect(validateProjectName("rm -rf; echo").valid).toBe(false);
    expect(validateProjectName("a`b`").valid).toBe(false);
  });
});

describe("sanitizeDisplayString", () => {
  it("strips control characters but keeps tab/newline", () => {
    expect(sanitizeDisplayString("a\x07b\x1bc")).toBe("abc");
    expect(sanitizeDisplayString("line1\nline2\tend")).toBe("line1\nline2\tend");
  });
});

describe("validateOrThrow", () => {
  it("throws the validation error message", () => {
    expect(() => validateOrThrow({ valid: false, error: "boom" })).toThrow("boom");
    expect(() => validateOrThrow({ valid: true })).not.toThrow();
  });
});
