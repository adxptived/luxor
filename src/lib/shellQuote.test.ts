import { describe, expect, it } from "bun:test";

import { shellQuote } from "./shellQuote";

describe("shellQuote", () => {
  it("leaves simple paths untouched", () => {
    expect(shellQuote("/home/user/file.txt")).toBe("/home/user/file.txt");
    expect(shellQuote("C:\\Users\\me\\file.txt")).toBe("C:\\Users\\me\\file.txt");
  });

  it("quotes paths with spaces", () => {
    expect(shellQuote("/home/My Files/a.txt")).toBe('"/home/My Files/a.txt"');
    expect(shellQuote("C:\\Program Files\\app.exe")).toBe('"C:\\Program Files\\app.exe"');
  });

  it("escapes quotes and shell specials", () => {
    expect(shellQuote('a"b')).toBe('"a\\"b"');
    expect(shellQuote("a$b")).toBe('"a\\$b"');
    expect(shellQuote("a&b.txt")).toBe('"a&b.txt"');
  });
});
