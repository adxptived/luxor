/**
 * Client-side preview of what a project replace will produce for a single hit.
 *
 * Mirrors the backend semantics of `replace_in_project`:
 * - literal mode: plain substring replacement of the matched range
 * - regex mode: Rust-style `$1`/`${name}` capture references; JS `String.replace`
 *   uses the same `$n` syntax, so re-matching the hit locally gives an accurate
 *   preview for the overwhelming majority of patterns.
 */

export interface ReplacePreviewResult {
  /** Replacement text that the matched range will become, or null if the
   *  regex no longer matches locally (preview unavailable). */
  replaced: string | null;
}

export function previewReplacement(
  matchedText: string,
  replacement: string,
  useRegex: boolean,
  caseSensitive: boolean,
  pattern: string,
): ReplacePreviewResult {
  if (!useRegex) return { replaced: replacement };
  try {
    // Convert Rust's `${name}` to JS's `$<name>` for named groups.
    const jsReplacement = replacement.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$<$1>");
    const re = new RegExp(pattern, caseSensitive ? "" : "i");
    const m = matchedText.match(re);
    if (!m || m[0] !== matchedText) {
      // The hit range should be exactly one match; if not, don't guess.
      return { replaced: null };
    }
    return { replaced: matchedText.replace(re, jsReplacement) };
  } catch {
    return { replaced: null };
  }
}
