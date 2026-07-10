/**
 * Detect file-path-like tokens in a terminal line so they can be made
 * clickable (open in the editor, optionally at a line number).
 *
 * Handles the common formats compilers and test runners print:
 *   src/main.rs:12:34, ./lib/util.ts:5, C:\proj\a.rs(7), ~/x/y.py, a/b/c.tsx
 */

export interface PathLinkMatch {
  /** 0-based start column within the line. */
  start: number;
  /** 0-based end column (exclusive). */
  end: number;
  /** The path as printed (without :line suffix). */
  path: string;
  /** 1-based line number when present. */
  line?: number;
}

// Path token: optional drive/./~ prefix, at least one separator, an extension
// of 1-8 word chars, then an optional :line[:col] or (line[,col]) suffix.
const PATH_RE =
  /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/])?(?:[\w.@+-]+[\\/])+[\w.@+-]+\.\w{1,8}(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))?/g;

/** Extract all path-like matches from a single terminal line. */
export function matchPathLinks(text: string): PathLinkMatch[] {
  const out: PathLinkMatch[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const raw = m[0];
    let path = raw;
    let line: number | undefined;
    // :line[:col] suffix
    const colon = raw.match(/^(.*?):(\d+)(?::\d+)?$/);
    // (line[,col]) suffix (MSVC style)
    const paren = raw.match(/^(.*?)\((\d+)(?:,\d+)?\)$/);
    if (colon && /\.\w{1,8}$/.test(colon[1])) {
      path = colon[1];
      line = Number(colon[2]);
    } else if (paren && /\.\w{1,8}$/.test(paren[1])) {
      path = paren[1];
      line = Number(paren[2]);
    }
    // Skip URLs (WebLinksAddon owns those). The regex can start matching in
    // the middle of a URL (after the scheme), so also check what immediately
    // precedes the match for a `scheme://host` prefix.
    if (/^\w+:\/\//.test(path)) continue;
    if (/\w+:\/\/[\w.-]*$/.test(text.slice(0, m.index))) continue;
    out.push({ start: m.index, end: m.index + raw.length, path, line });
  }
  return out;
}

/** Resolve a matched path against the project root when it is relative. */
export function resolveMatchedPath(path: string, root: string | null): string {
  const isAbs = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(path);
  if (isAbs || !root) return path;
  const cleaned = path.replace(/^\.[\\/]/, "");
  return `${root}/${cleaned}`;
}
