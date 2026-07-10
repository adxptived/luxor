/**
 * CPU percentage helpers.
 *
 * The backend reports per-process CPU where `100` means "one full core". A
 * busy agent that spreads across several cores therefore reports values like
 * `849%`, which reads like a bug to users who expect a Task-Manager-style
 * "share of the whole machine" number. [`machineCpuPct`] converts the raw
 * core-relative figure into a 0–100 machine-relative percentage.
 */

/** Logical core count, defaulting to 1 when unknown (never divides by zero). */
export function coreCount(): number {
  const n = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
  return n && n > 0 ? n : 1;
}

/**
 * Convert a core-relative CPU figure (100 = one core) into a machine-relative
 * percentage (100 = every core saturated), clamped to 0–100.
 */
export function machineCpuPct(coreRelative: number, cores = coreCount()): number {
  if (!Number.isFinite(coreRelative) || coreRelative <= 0) return 0;
  const pct = coreRelative / Math.max(1, cores);
  return Math.min(100, Math.max(0, pct));
}

/** Format a machine-relative CPU percentage, e.g. `12%`. */
export function fmtCpu(coreRelative: number, cores = coreCount()): string {
  return `${machineCpuPct(coreRelative, cores).toFixed(0)}%`;
}
