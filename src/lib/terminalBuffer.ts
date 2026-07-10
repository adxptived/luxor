/**
 * Capture an xterm.js buffer as plain text (for "Save output to file").
 * Structural types instead of xterm's so the logic is unit-testable.
 */

export interface BufferLineLike {
  translateToString(trimRight?: boolean): string;
  isWrapped: boolean;
}

export interface BufferLike {
  /** Total lines: scrollback + viewport. */
  length: number;
  getLine(y: number): BufferLineLike | undefined;
}

/**
 * Full buffer content as text. Hard-wrapped continuation lines are joined
 * back into their logical line; trailing blank lines are dropped.
 */
export function captureBuffer(buffer: BufferLike): string {
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/** `terminal-output-2026-06-12_15-30-00.txt` for a save dialog default. */
export function suggestOutputFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `terminal-output-${date}_${time}.txt`;
}
