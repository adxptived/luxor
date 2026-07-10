import { describe, expect, it } from "bun:test";

import { fnv1a64Hex, sha256Hex } from "./skillsHash";

describe("sha256Hex", () => {
  it("matches known SHA-256 vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("fnv1a64Hex", () => {
  it("matches known FNV-1a 64 vectors", () => {
    // Offset basis for the empty string, classic test vector for "a".
    expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64Hex("a")).toBe("af63dc4c8601ec8c");
  });
  it("is stable for multi-byte UTF-8", () => {
    expect(fnv1a64Hex("проверка")).toBe(fnv1a64Hex("проверка"));
    expect(fnv1a64Hex("проверка")).not.toBe(fnv1a64Hex("проверкб"));
  });
});
