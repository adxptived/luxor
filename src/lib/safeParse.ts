/**
 * Guarded JSON parsing for localStorage & other untrusted strings
 * (audit fix 8.4).
 *
 * A corrupted localStorage value (partial write, manual edit, schema change)
 * must never crash a module at import/startup time — always fall back.
 */

/** Parse `raw` as JSON, returning `fallback` on null/invalid input. */
export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Like `safeParse`, but additionally validates the parsed value; returns
 * `fallback` when the validator rejects it. Use for critical structures
 * (layout, settings) where shape drift would crash downstream code.
 */
export function safeParseValidated<T>(
  raw: string | null | undefined,
  validate: (value: unknown) => value is T,
  fallback: T,
): T {
  if (raw == null || raw === "") return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Read + parse a localStorage key in one guarded step. */
export function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    return safeParse(localStorage.getItem(key), fallback);
  } catch {
    // localStorage itself can throw (privacy mode, quota).
    return fallback;
  }
}
