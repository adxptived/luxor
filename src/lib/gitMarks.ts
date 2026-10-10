import type { FileState, StatusEntry } from "./types";

export type MarkTone = "added" | "modified" | "deleted" | "conflict";
export interface GitMark {
  /** One-letter badge shown at the end of an explorer row. */
  letter: string;
  tone: MarkTone;
}

const BY_STATE: Record<FileState, GitMark | null> = {
  new: { letter: "A", tone: "added" },
  untracked: { letter: "U", tone: "added" },
  modified: { letter: "M", tone: "modified" },
  renamed: { letter: "R", tone: "modified" },
  typechange: { letter: "T", tone: "modified" },
  deleted: { letter: "D", tone: "deleted" },
  conflicted: { letter: "!", tone: "conflict" },
  ignored: null,
};

const RANK: Record<MarkTone, number> = { added: 1, modified: 2, deleted: 3, conflict: 4 };

/** The mark for one entry: the worktree state wins over the staged one. */
export function markOf(entry: Pick<StatusEntry, "staged" | "unstaged">): GitMark | null {
  const state = entry.unstaged ?? entry.staged;
  return state ? BY_STATE[state] : null;
}

/**
 * Map absolute paths to their git mark. Folders get a plain dot-style mark
 * (letter "") with the strongest tone found beneath them, so a collapsed folder
 * still shows that something inside changed.
 */
export function buildMarks(root: string, entries: readonly StatusEntry[]): Map<string, GitMark> {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  const out = new Map<string, GitMark>();
  for (const entry of entries) {
    const mark = markOf(entry);
    if (!mark) continue;
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let acc = base;
    parts.forEach((part, i) => {
      acc = `${acc}${sep}${part}`;
      if (i === parts.length - 1) {
        out.set(acc, mark);
        return;
      }
      const prev = out.get(acc);
      if (!prev || RANK[prev.tone] < RANK[mark.tone]) out.set(acc, { letter: "", tone: mark.tone });
    });
  }
  return out;
}

export const MARK_CLASS: Record<MarkTone, string> = {
  added: "text-success",
  modified: "text-accent",
  deleted: "text-danger",
  conflict: "text-danger",
};
