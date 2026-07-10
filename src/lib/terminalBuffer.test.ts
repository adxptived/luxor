import { describe, expect, test } from "bun:test";

import { captureBuffer, suggestOutputFilename, type BufferLike } from "./terminalBuffer";

function fakeBuffer(lines: Array<{ text: string; wrapped?: boolean }>): BufferLike {
  return {
    length: lines.length,
    getLine: (y) =>
      lines[y] && {
        translateToString: () => lines[y].text,
        isWrapped: lines[y].wrapped ?? false,
      },
  };
}

describe("captureBuffer", () => {
  test("joins plain lines with newlines", () => {
    const buf = fakeBuffer([{ text: "$ ls" }, { text: "README.md" }, { text: "src" }]);
    expect(captureBuffer(buf)).toBe("$ ls\nREADME.md\nsrc");
  });

  test("re-joins hard-wrapped continuation lines", () => {
    const buf = fakeBuffer([
      { text: "$ echo aaaaaaaaaa" },
      { text: "bbbbbbbbbb", wrapped: true },
      { text: "done" },
    ]);
    expect(captureBuffer(buf)).toBe("$ echo aaaaaaaaaabbbbbbbbbb\ndone");
  });

  test("drops trailing blank lines but keeps inner ones", () => {
    const buf = fakeBuffer([
      { text: "first" },
      { text: "" },
      { text: "last" },
      { text: "" },
      { text: "" },
    ]);
    expect(captureBuffer(buf)).toBe("first\n\nlast");
  });

  test("empty buffer gives empty string", () => {
    expect(captureBuffer(fakeBuffer([]))).toBe("");
  });
});

describe("suggestOutputFilename", () => {
  test("formats a sortable timestamped name", () => {
    const d = new Date(2026, 5, 12, 15, 30, 7); // 2026-06-12 15:30:07 local
    expect(suggestOutputFilename(d)).toBe("terminal-output-2026-06-12_15-30-07.txt");
  });
});
