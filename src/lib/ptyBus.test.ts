import { describe, expect, test } from "bun:test";

import { MAX_PENDING_BYTES, MAX_PENDING_CHUNKS, PENDING_TTL_MS, PtyRouter } from "./ptyBus";

function collector() {
  const out: string[] = [];
  const exits: Array<number | null> = [];
  return {
    out,
    exits,
    handlers: {
      onOutput: (b64: string) => out.push(b64),
      onExit: (code: number | null) => exits.push(code),
    },
  };
}

describe("PtyRouter", () => {
  test("buffers output emitted before attach and replays it in order", () => {
    const r = new PtyRouter();
    r.handleOutput("s1", "banner");
    r.handleOutput("s1", "prompt");
    const c = collector();
    r.attach("s1", c.handlers);
    expect(c.out).toEqual(["banner", "prompt"]);
  });

  test("delivers live output directly after attach", () => {
    const r = new PtyRouter();
    const c = collector();
    r.attach("s1", c.handlers);
    r.handleOutput("s1", "x");
    expect(c.out).toEqual(["x"]);
    expect(r.pendingCount).toBe(0);
  });

  test("replays a buffered exit (shell died before panel attached)", () => {
    const r = new PtyRouter();
    r.handleOutput("s1", "oops");
    r.handleExit("s1", 127);
    const c = collector();
    r.attach("s1", c.handlers);
    expect(c.out).toEqual(["oops"]);
    expect(c.exits).toEqual([127]);
  });

  test("does not cross sessions", () => {
    const r = new PtyRouter();
    r.handleOutput("a", "for-a");
    r.handleOutput("b", "for-b");
    const ca = collector();
    r.attach("a", ca.handlers);
    expect(ca.out).toEqual(["for-a"]);
    const cb = collector();
    r.attach("b", cb.handlers);
    expect(cb.out).toEqual(["for-b"]);
  });

  test("detach stops delivery; events buffer again for a new owner", () => {
    const r = new PtyRouter();
    const c1 = collector();
    const detach = r.attach("s1", c1.handlers);
    r.handleOutput("s1", "one");
    detach();
    r.handleOutput("s1", "two");
    expect(c1.out).toEqual(["one"]);
    const c2 = collector();
    r.attach("s1", c2.handlers);
    expect(c2.out).toEqual(["two"]);
  });

  test("detach is a no-op when another handler took over", () => {
    const r = new PtyRouter();
    const c1 = collector();
    const detach1 = r.attach("s1", c1.handlers);
    const c2 = collector();
    r.attach("s1", c2.handlers);
    detach1(); // must NOT detach c2
    r.handleOutput("s1", "x");
    expect(c2.out).toEqual(["x"]);
  });

  test("caps buffered chunks, keeping the most recent output", () => {
    const r = new PtyRouter();
    for (let i = 0; i < MAX_PENDING_CHUNKS + 10; i++) r.handleOutput("s1", `c${i}`);
    const c = collector();
    r.attach("s1", c.handlers);
    expect(c.out.length).toBe(MAX_PENDING_CHUNKS);
    expect(c.out[c.out.length - 1]).toBe(`c${MAX_PENDING_CHUNKS + 9}`);
    expect(c.out[0]).toBe("c10");
  });

  test("caps buffered bytes", () => {
    const r = new PtyRouter();
    const big = "x".repeat(1024 * 1024); // 1 MB per chunk
    r.handleOutput("s1", big);
    r.handleOutput("s1", big);
    r.handleOutput("s1", big);
    const c = collector();
    r.attach("s1", c.handlers);
    const total = c.out.reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PENDING_BYTES);
    expect(c.out.length).toBe(2);
  });

  test("forget drops buffered state", () => {
    const r = new PtyRouter();
    r.handleOutput("s1", "junk");
    r.forget("s1");
    const c = collector();
    r.attach("s1", c.handlers);
    expect(c.out).toEqual([]);
  });

  test("stale unclaimed sessions are swept after the TTL", () => {
    let now = 1_000_000;
    const r = new PtyRouter(() => now);
    r.handleOutput("dead", "old");
    expect(r.pendingCount).toBe(1);
    now += PENDING_TTL_MS + 5_001;
    r.handleOutput("alive", "new");
    expect(r.pendingCount).toBe(1); // "dead" swept, "alive" pending
    const c = collector();
    r.attach("dead", c.handlers);
    expect(c.out).toEqual([]);
  });

});
