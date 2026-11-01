import { afterEach, describe, expect, it } from "bun:test";

import { onFsPoke, pokeFs, resetFsPoke } from "./fsPoke";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("fsPoke", () => {
  afterEach(() => resetFsPoke());

  it("fires once after the output has been quiet", async () => {
    let n = 0;
    onFsPoke(() => n++);
    pokeFs(30);
    pokeFs(30);
    pokeFs(30);
    expect(n).toBe(0);
    await sleep(60);
    expect(n).toBe(1);
  });

  it("unsubscribes", async () => {
    let n = 0;
    const off = onFsPoke(() => n++);
    off();
    pokeFs(10);
    await sleep(30);
    expect(n).toBe(0);
  });
});
