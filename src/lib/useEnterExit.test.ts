import { describe, expect, test } from "bun:test";

import { useEnterExit } from "./useEnterExit";

/**
 * `useEnterExit` needs a DOM (getComputedStyle, requestAnimationFrame), which
 * bun's test runner does not provide, so the browser behaviour is covered by
 * e2e instead. What IS worth pinning here is the module contract: the hook must
 * stay a named export with the documented option shape, because a rename would
 * otherwise only surface as a silent loss of exit animations in the UI.
 */
describe("useEnterExit module contract", () => {
  test("is exported as a function taking (open, options)", () => {
    expect(typeof useEnterExit).toBe("function");
    expect(useEnterExit.length).toBe(2);
  });
});
