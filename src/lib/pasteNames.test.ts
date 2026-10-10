import { describe, expect, it } from "bun:test";

import { pasteName } from "./pasteNames";

describe("pasteName", () => {
  it("keeps a free name", () => {
    expect(pasteName("a.txt", false, new Set(["b.txt"]))).toBe("a.txt");
  });

  it("numbers copies and keeps the extension", () => {
    expect(pasteName("a.txt", false, new Set(["a.txt"]))).toBe("a copy.txt");
    expect(pasteName("a.txt", false, new Set(["a.txt", "a copy.txt"]))).toBe("a copy 2.txt");
  });

  it("treats folders and dotfiles as having no extension", () => {
    expect(pasteName("v1.2", true, new Set(["v1.2"]))).toBe("v1.2 copy");
    expect(pasteName(".env", false, new Set([".env"]))).toBe(".env copy");
  });
});
