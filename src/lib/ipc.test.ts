import { describe, expect, test } from "bun:test";

import { b64ToBytes, strToB64 } from "./ipc";

/** Guards the base64 terminal-IPC hot path (optimized for large pastes): the
 *  chunked `strToB64` must stay byte-identical to the naive version, including
 *  across the chunk boundary and for multi-byte UTF-8. */
describe("strToB64 / b64ToBytes", () => {
  const reference = (str: string) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };

  test("matches the reference encoding for ASCII, empty and UTF-8", () => {
    for (const s of ["", "a", "ls -la\r\n$ ", "日本語 — café ☕", "y".repeat(1024)]) {
      expect(strToB64(s)).toBe(reference(s));
    }
  });

  test("handles input far larger than the 0x8000 chunk boundary", () => {
    const big = "x".repeat(0x8000 * 2 + 123);
    expect(strToB64(big)).toBe(reference(big));
  });

  test("round-trips str → b64 → bytes losslessly", () => {
    const s = "echo привет && git status\r\n";
    const bytes = b64ToBytes(strToB64(s));
    expect(new TextDecoder().decode(bytes)).toBe(s);
  });

  test("b64ToBytes decodes raw (non-UTF-8) bytes", () => {
    const bin = String.fromCharCode(0x00, 0xff, 0x1b, 0x5b, 0x41);
    const b64 = btoa(bin);
    expect(Array.from(b64ToBytes(b64))).toEqual([0x00, 0xff, 0x1b, 0x5b, 0x41]);
  });
});
