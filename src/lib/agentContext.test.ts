import { describe, expect, test } from "bun:test";

import { buildContentsPrompt, buildPathsPrompt, fenceLang } from "./agentContext";

describe("agentContext", () => {
  test("paths prompt lists every file", () => {
    const p = buildPathsPrompt(["src/main.rs", "Cargo.toml"]);
    expect(p).toContain("- src/main.rs");
    expect(p).toContain("- Cargo.toml");
  });

  test("empty selection produces empty prompts", () => {
    expect(buildPathsPrompt([])).toBe("");
    expect(buildContentsPrompt([])).toBe("");
  });

  test("contents prompt embeds fenced code with language", () => {
    const p = buildContentsPrompt([{ path: "a.ts", content: "const x = 1;\n" }]);
    expect(p).toContain("## a.ts");
    expect(p).toContain("```ts\nconst x = 1;\n```");
  });

  test("fences grow when content contains backticks", () => {
    const p = buildContentsPrompt([{ path: "doc.md", content: "```js\nlet a;\n```" }]);
    expect(p).toContain("````markdown");
  });

  test("binary files are listed path-only", () => {
    const p = buildContentsPrompt([{ path: "logo.png", content: null }]);
    expect(p).toContain("## logo.png");
    expect(p).toContain("binary or unreadable");
  });

  test("fenceLang maps common extensions", () => {
    expect(fenceLang("x.rs")).toBe("rust");
    expect(fenceLang("x.unknownext")).toBe("");
  });
});
