/**
 * Micro-benchmarks for Luxor's hot frontend paths. Run with `bun run bench`.
 *
 * Covered:
 *  - base64 <-> bytes      every terminal output chunk / keystroke goes
 *                          through these (IPC payloads are base64)
 *  - PtyRouter             routing/buffering of terminal output events
 *  - fuzzyScore/Filter     command palette and list filtering per keystroke
 *  - feedInput             terminal command-history reconstruction per input
 */

import { bench, group, run } from "mitata";

import { b64ToBytes, strToB64 } from "../src/lib/ipc";
import { PtyRouter } from "../src/lib/ptyBus";
import { fuzzyFilter, fuzzyScore } from "../src/lib/fuzzy";
import { emptyLine, feedInput } from "../src/lib/cmdHistory";

// --- fixtures ---------------------------------------------------------------

const chunk8k = strToB64("x".repeat(8192)); // typical PTY read buffer
const chunk256 = strToB64("ls -la && git status\r\n$ ");
const keystroke = strToB64("a");

const paletteItems = Array.from({ length: 500 }, (_, i) => ({
  title: `Command ${i}: ${["Open terminal", "Git commit", "Search project", "Toggle zen mode", "Restart shell"][i % 5]} ${i}`,
}));

// --- base64 (terminal IPC hot path) ------------------------------------------

group("base64 terminal IPC", () => {
  bench("b64ToBytes 8 KB chunk", () => b64ToBytes(chunk8k));
  bench("b64ToBytes 256 B chunk", () => b64ToBytes(chunk256));
  bench("strToB64 keystroke", () => strToB64("a"));
  bench("strToB64 1 KB paste", () => strToB64("y".repeat(1024)));
});

// --- PtyRouter ----------------------------------------------------------------

group("PtyRouter", () => {
  bench("route 100 chunks to an attached session", () => {
    const r = new PtyRouter();
    r.attach("s", { onOutput: () => {}, onExit: () => {} });
    for (let i = 0; i < 100; i++) r.handleOutput("s", chunk8k);
  });
  bench("buffer 100 chunks + attach replay", () => {
    const r = new PtyRouter();
    for (let i = 0; i < 100; i++) r.handleOutput("s", chunk256);
    r.attach("s", { onOutput: () => {}, onExit: () => {} });
  });
});

// --- fuzzy matching (palette) -------------------------------------------------

group("fuzzy", () => {
  bench("fuzzyScore hit", () => fuzzyScore("gitcom", "Command 1: Git commit 1"));
  bench("fuzzyScore miss", () => fuzzyScore("zzzzzz", "Command 1: Git commit 1"));
  bench("fuzzyFilter 500 items", () => fuzzyFilter(paletteItems, "term", (i) => i.title));
});

// --- terminal input parsing -----------------------------------------------------

group("cmdHistory.feedInput", () => {
  bench("typed command + Enter", () => {
    let line = emptyLine();
    for (const ch of "git status\r") line = feedInput(line, ch).state;
  });
  bench("burst paste (1 KB)", () => {
    feedInput(emptyLine(), `${"echo hello && ".repeat(70)}\r`);
  });
});

await run();

// Keep `b64ToBytes(keystroke)` referenced so bundlers don't tree-shake fixtures.
void keystroke;
