import { describe, expect, test } from "bun:test";

import { HISTORY_LIMIT, appendHistory, emptyLine, feedInput, loadHistory } from "./cmdHistory";

function run(...chunks: string[]) {
  let state = emptyLine();
  const all: string[] = [];
  for (const chunk of chunks) {
    const r = feedInput(state, chunk);
    state = r.state;
    all.push(...r.committed);
  }
  return { state, committed: all };
}

describe("feedInput", () => {
  test("commits a typed line on Enter", () => {
    expect(run("ls -la", "\r").committed).toEqual(["ls -la"]);
  });

  test("accumulates across chunks (per-keystroke input)", () => {
    expect(run("g", "i", "t", " ", "s", "t", "a", "t", "u", "s", "\r").committed).toEqual([
      "git status",
    ]);
  });

  test("backspace deletes characters", () => {
    expect(run("lss\x7f", "\r").committed).toEqual(["ls"]);
  });

  test("empty and whitespace-only lines are not committed", () => {
    expect(run("\r", "   \r").committed).toEqual([]);
  });

  test("Ctrl+C discards the pending line", () => {
    const r = run("rm -rf /\x03", "echo ok\r");
    expect(r.committed).toEqual(["echo ok"]);
  });

  test("escape sequences poison the line until the next Enter", () => {
    // Up-arrow recalls shell history we cannot see — do not record it.
    const r = run("\x1b[A", "\r", "pwd\r");
    expect(r.committed).toEqual(["pwd"]);
  });

  test("\\r\\n is treated as a single Enter", () => {
    expect(run("ls\r\n").committed).toEqual(["ls"]);
  });

  test("large pasted printable bursts are captured as one command", () => {
    const cmd = "echo hello && ".repeat(200).trim();
    expect(run(`${cmd}\r`).committed).toEqual([cmd]);
  });

  test("flushes printable bursts before backspace and control chars", () => {
    expect(run("abcdef\x7f\x7f\r").committed).toEqual(["abcd"]);
    expect(run("abc\x03", "def\r").committed).toEqual(["def"]);
  });
});

describe("history storage", () => {
  function memStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  test("appends newest first and dedupes", () => {
    const st = memStorage();
    appendHistory(["ls"], st);
    appendHistory(["pwd"], st);
    appendHistory(["ls"], st);
    expect(loadHistory(st)).toEqual(["ls", "pwd"]);
  });

  test("caps at HISTORY_LIMIT", () => {
    const st = memStorage();
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => `cmd-${i}`);
    appendHistory(many, st);
    expect(loadHistory(st).length).toBe(HISTORY_LIMIT);
  });

  test("dedupes a batch without repeatedly filtering existing history", () => {
    const st = memStorage();
    appendHistory(["old", "keep"], st);
    appendHistory(["new", "old", "new"], st);
    expect(loadHistory(st).slice(0, 3)).toEqual(["new", "old", "keep"]);
  });

  test("corrupt storage yields empty history", () => {
    const st = memStorage();
    st.setItem("luxor.cmdHistory", "{not json");
    expect(loadHistory(st)).toEqual([]);
  });
});
