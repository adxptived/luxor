import { describe, expect, test } from "bun:test";

import { fmtCpu, machineCpuPct } from "./cpu";

describe("machineCpuPct", () => {
  test("converts core-relative CPU into a machine-relative percentage", () => {
    // 849% across 8 cores ≈ 106% capped to 100.
    expect(machineCpuPct(849, 8)).toBe(100);
    // 400% across 8 cores = 50% of the machine.
    expect(machineCpuPct(400, 8)).toBe(50);
    // One core busy on a quad-core = 25%.
    expect(machineCpuPct(100, 4)).toBe(25);
  });

  test("clamps and guards against bad input", () => {
    expect(machineCpuPct(-5, 8)).toBe(0);
    expect(machineCpuPct(NaN, 8)).toBe(0);
    expect(machineCpuPct(50, 0)).toBe(50); // never divides by zero
  });
});

describe("fmtCpu", () => {
  test("formats as an integer percentage", () => {
    expect(fmtCpu(400, 8)).toBe("50%");
    expect(fmtCpu(849, 8)).toBe("100%");
  });
});
