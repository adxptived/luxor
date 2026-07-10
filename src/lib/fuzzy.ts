/**
 * Lightweight fuzzy matching for the command palette and project switcher.
 *
 * `fuzzyScore` matches `query` as a (multi-word) subsequence of `text` and
 * returns a relevance score, or `null` when the query does not match.
 * Plain `includes()` is a special case of this — every substring also matches
 * as a subsequence — so switching a filter to fuzzy never loses results.
 *
 * Scoring favors what humans expect to see first:
 *  - matches at the start of the text or of a word ("gop" → "Git: Open panel")
 *  - consecutive runs of matched characters
 *  - shorter texts when scores otherwise tie (less noise)
 */

const WORD_BOUNDARY = /[\s:./\\_\-—]/;

/** Split a raw query into lowercased subsequence words (order-free, all must
 *  match). Call this once per query — never once per candidate. */
function queryWords(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Score one query word as a subsequence of the already-lowercased `lcText`.
 *  Word-boundary chars (whitespace/punctuation) are case-invariant, so the
 *  lowercased text is sufficient — no second copy of the original is needed. */
function scoreWord(word: string, lcText: string): number | null {
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < word.length; qi++) {
    const ch = word[qi];
    const found = lcText.indexOf(ch, ti);
    if (found === -1) return null;
    // Base point for the match.
    score += 1;
    // Bonus: consecutive with the previous matched char.
    if (found === prevMatch + 1) score += 4;
    // Bonus: at the very start or right after a word boundary.
    if (found === 0) score += 6;
    else if (WORD_BOUNDARY.test(lcText[found - 1])) score += 4;
    // Penalty: distance skipped since the previous match (capped).
    score -= Math.min(found - ti, 3) * 0.5;
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

/** Score pre-split `words` against `text`. The hot inner loop used by both
 *  the public `fuzzyScore` and the per-item path in `fuzzyFilter`. */
function scoreWords(words: string[], text: string): number | null {
  if (words.length === 0) return 0;
  const lcText = text.toLowerCase();
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const s = scoreWord(words[i], lcText);
    if (s === null) return null;
    total += s;
  }
  // Tie-break: prefer shorter texts.
  return total - text.length * 0.01;
}

/**
 * Match `query` against `text`. Whitespace splits the query into words that
 * must all match independently (order-free): "split term" finds
 * "Terminal: Split right". Returns `null` when any word fails.
 */
export function fuzzyScore(query: string, text: string): number | null {
  return scoreWords(queryWords(query), text);
}

/**
 * Character indices of `text` matched by `query` (greedy left-to-right walk,
 * mirroring `scoreWord`). Used to highlight matched characters in result
 * lists. Returns an empty array for blank or non-matching queries.
 */
export function fuzzyPositions(query: string, text: string): number[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const lcText = text.toLowerCase();
  const positions = new Set<number>();
  for (const word of words) {
    let ti = 0;
    for (let qi = 0; qi < word.length; qi++) {
      const found = lcText.indexOf(word[qi], ti);
      if (found === -1) return [];
      positions.add(found);
      ti = found + 1;
    }
  }
  return Array.from(positions).sort((a, b) => a - b);
}

/**
 * Filter + rank `items` by fuzzy relevance of `query` against `key(item)`.
 * Empty/blank queries return the items unchanged (no re-ordering).
 * The sort is stable: equal scores keep their original relative order.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  limit?: number,
): T[] {
  if (!query.trim()) return limit === undefined ? items : items.slice(0, limit);
  // Split the query ONCE here instead of re-parsing it for every candidate
  // (this runs on every keystroke against the full command list).
  const words = queryWords(query);
  const cap = limit && limit > 0 ? limit : 0;
  const scored: { item: T; score: number; index: number }[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const score = scoreWords(words, key(item));
    if (score === null) continue;
    if (!cap || scored.length < cap) {
      scored.push({ item, score, index });
      continue;
    }
    // When the caller only renders the first N results (go-to-file/symbol), keep
    // only a bounded candidate set instead of allocating and sorting every match
    // in a 20k-file workspace on each keystroke.
    let worst = 0;
    for (let i = 1; i < scored.length; i++) {
      const a = scored[i];
      const b = scored[worst];
      if (a.score < b.score || (a.score === b.score && a.index > b.index)) worst = i;
    }
    const w = scored[worst];
    if (score > w.score || (score === w.score && index < w.index)) {
      scored[worst] = { item, score, index };
    }
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}
