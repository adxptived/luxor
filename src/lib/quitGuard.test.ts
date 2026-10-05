import { describe, expect, test } from "bun:test";

import { quitWarning } from "./quitGuard";

describe("quitWarning", () => {
  test("is null when nothing would be lost", () => {
    expect(quitWarning(0, 0)).toBeNull();
  });
  test("names unsaved files and busy terminals", () => {
    expect(quitWarning(2, 0)).toBe("Unsaved files: 2");
    expect(quitWarning(0, 1)).toBe("Terminals still running something: 1");
    expect(quitWarning(1, 3)).toBe("Unsaved files: 1\nTerminals still running something: 3");
  });
});
