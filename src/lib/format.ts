/**
 * Locale-aware number & date formatting, bound to the app's UI language.
 *
 * WHY THIS MODULE EXISTS: `toLocaleString()` / `toLocaleDateString()` /
 * `toLocaleTimeString()` with no explicit locale fall back to the **host OS**
 * locale. Luxor has its own language switch (`config.ui.language`), so the bare
 * calls produced a split personality: an English UI on a Russian Windows showed
 * `1 024` and `26.07.2026`, while a Russian UI on an English box showed `1,024`
 * and `7/26/2026`. It also made unit tests fail on any non-en-US machine.
 *
 * Every formatter here routes through `getLocale()` (derived from the active UI
 * language). An ESLint rule (`no-restricted-syntax` in `eslint.config.js`)
 * forbids calling the raw `toLocale*` methods anywhere else so the drift cannot
 * come back.
 */

import { getLocale } from "@/lib/i18n";

/**
 * Anything the date formatters accept. `string` is included because Rust
 * payloads routinely carry ISO-8601 timestamps (e.g. `logBuffer`'s `ts`), and
 * `number` is epoch milliseconds.
 */
export type DateLike = Date | number | string;

/** Thousands-separated integer/decimal, e.g. `1,024` (en) / `1 024` (ru). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(getLocale(), options);
}

/** Date + time, e.g. `7/26/2026, 3:25:01 PM`. */
export function formatDateTime(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  return asDate(value).toLocaleString(getLocale(), options);
}

/** Date only, e.g. `7/26/2026`. */
export function formatDate(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  return asDate(value).toLocaleDateString(getLocale(), options);
}

/** Time only, e.g. `3:25:01 PM`. */
export function formatTime(value: DateLike, options?: Intl.DateTimeFormatOptions): string {
  return asDate(value).toLocaleTimeString(getLocale(), options);
}

/** Short wall clock without seconds, e.g. `15:25` / `3:25 PM`. */
export function formatClock(value: DateLike): string {
  return formatTime(value, { hour: "2-digit", minute: "2-digit" });
}

/** Unix **seconds** → date+time. Most Rust payloads use second precision. */
export function formatUnixDateTime(unixSeconds: number): string {
  return formatDateTime(unixSeconds * 1000);
}

/** Unix **seconds** → date only. */
export function formatUnixDate(unixSeconds: number): string {
  return formatDate(unixSeconds * 1000);
}

/**
 * Byte count with a binary-ish unit ladder, e.g. `1.4 MB`. The numeric part is
 * locale-formatted; the unit suffix is intentionally not translated (SI/IEC
 * symbols are language-independent and universally recognised by developers).
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : fractionDigits;
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${units[unit]}`;
}

function asDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}
