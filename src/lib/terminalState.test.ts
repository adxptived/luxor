import { describe, expect, it } from "bun:test";

import {
  MAX_TOTAL_CHARS,
  TERMINAL_RESTORE_KEY,
  deleteTerminalState,
  isRestoreEnabled,
  layoutTerminalIds,
  loadTerminalState,
  looksLikeSecretPrompt,
  parseOsc7Cwd,
  pruneTerminalStates,
  purgeTerminalStates,
  sanitizeDraft,
  saveTerminalState,
  terminalStateId,
  terminalStateKey,
} from "./terminalState";

/** Minimal in-memory Storage with optional quota. */
function memStore(quota = Infinity) {
  const m = new Map<string, string>();
  const used = () => [...m.values()].reduce((n, v) => n + v.length, 0);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = m.get(k)?.length ?? 0;
      if (used() - prev + v.length > quota) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const snap = (over: Partial<{ cwd: string | null; draft: string; data: string; savedAt: number }> = {}) => ({
  cwd: null,
  draft: "",
  data: "hello",
  ...over,
});

describe("terminalState save/load", () => {
  it("round-trips a snapshot", () => {
    const s = memStore();
    saveTerminalState("d:p1", snap({ cwd: "/home/me", draft: "git sta", data: "\x1b[31mred\x1b[0m" }), s);
    const got = loadTerminalState("d:p1", s);
    expect(got).toMatchObject({ v: 1, cwd: "/home/me", draft: "git sta", data: "\x1b[31mred\x1b[0m" });
  });

  it("returns null for missing, corrupt or foreign-version entries", () => {
    const s = memStore();
    expect(loadTerminalState("nope", s)).toBeNull();
    s.setItem(terminalStateKey("bad"), "{not json");
    expect(loadTerminalState("bad", s)).toBeNull();
    s.setItem(terminalStateKey("v9"), JSON.stringify({ v: 9, data: "x" }));
    expect(loadTerminalState("v9", s)).toBeNull();
  });

  it("scopes ids by dock so a preset applied twice does not collide", () => {
    const s = memStore();
    saveTerminalState(terminalStateId("projA", "terminal-1"), snap({ data: "A" }), s);
    saveTerminalState(terminalStateId("projB", "terminal-1"), snap({ data: "B" }), s);
    expect(loadTerminalState(terminalStateId("projA", "terminal-1"), s)?.data).toBe("A");
    expect(loadTerminalState(terminalStateId("projB", "terminal-1"), s)?.data).toBe("B");
  });

  it("evicts the oldest snapshots when the total budget is exceeded", () => {
    const s = memStore();
    const big = "x".repeat(Math.floor(MAX_TOTAL_CHARS / 3));
    saveTerminalState("a", snap({ data: big, savedAt: 1 }), s);
    saveTerminalState("b", snap({ data: big, savedAt: 2 }), s);
    saveTerminalState("c", snap({ data: big, savedAt: 3 }), s);
    saveTerminalState("d", snap({ data: big, savedAt: 4 }), s);
    expect(loadTerminalState("a", s)).toBeNull();
    expect(loadTerminalState("d", s)).not.toBeNull();
  });

  it("survives a full storage without throwing, keeping at least the draft", () => {
    const s = memStore(300);
    expect(() => saveTerminalState("a", snap({ data: "y".repeat(5000), draft: "ls" }), s)).not.toThrow();
    const got = loadTerminalState("a", s);
    expect(got?.draft).toBe("ls");
    expect(got?.data).toBe("");
  });

  it("deleteTerminalState and purge remove entries", () => {
    const s = memStore();
    saveTerminalState("a", snap(), s);
    saveTerminalState("b", snap(), s);
    s.setItem("luxor.other", "keep");
    deleteTerminalState("a", s);
    expect(loadTerminalState("a", s)).toBeNull();
    purgeTerminalStates(s);
    expect(loadTerminalState("b", s)).toBeNull();
    expect(s.getItem("luxor.other")).toBe("keep");
  });
});

describe("drafts and secrets", () => {
  it("sanitizeDraft strips control characters and caps length", () => {
    expect(sanitizeDraft("ls -la\r\n\x1b[A\x07")).toBe("ls -la[A");
    expect(sanitizeDraft("a".repeat(5000)).length).toBe(2000);
    // Tab is kept: it is typed text (completion trigger), not a line break.
    expect(sanitizeDraft("tab\there")).toBe("tab\there");
  });

  it("detects no-echo prompts but not ordinary commands", () => {
    expect(looksLikeSecretPrompt("Password:")).toBe(true);
    expect(looksLikeSecretPrompt("[sudo] password for me: ")).toBe(true);
    expect(looksLikeSecretPrompt("Enter passphrase for key '/home/me/.ssh/id_ed25519': ")).toBe(true);
    expect(looksLikeSecretPrompt("Пароль: ")).toBe(true);
    expect(looksLikeSecretPrompt("me@host:~$ echo password")).toBe(false);
    expect(looksLikeSecretPrompt("me@host:~/token-service$ ls")).toBe(false);
    expect(looksLikeSecretPrompt("")).toBe(false);
  });
});

describe("parseOsc7Cwd", () => {
  it("parses posix and windows file URLs", () => {
    expect(parseOsc7Cwd("file://host/home/me/my%20proj")).toBe("/home/me/my proj");
    expect(parseOsc7Cwd("file:///C:/Users/me")).toBe("C:/Users/me");
  });
  it("rejects anything else", () => {
    expect(parseOsc7Cwd("http://x/y")).toBeNull();
    expect(parseOsc7Cwd("file://nohost")).toBeNull();
    expect(parseOsc7Cwd("file://h/%E0%A4%A")).toBeNull();
  });
});

describe("pruneTerminalStates", () => {
  const layout = (ids: string[]) =>
    JSON.stringify({
      panels: Object.fromEntries(ids.map((id) => [id, { id, contentComponent: "terminal" }])),
    });

  it("collects terminal ids per dock from saved layouts", () => {
    const s = memStore();
    s.setItem("luxor.layout.projA", layout(["terminal-1", "terminal-2"]));
    s.setItem("luxor.layout.projB", JSON.stringify({ panels: { "panel-files": { id: "panel-files", contentComponent: "files" } } }));
    expect([...layoutTerminalIds(s)].sort()).toEqual(["projA:terminal-1", "projA:terminal-2"]);
  });

  it("removes snapshots of closed terminals but keeps live and recent ones", () => {
    const s = memStore();
    const now = 10_000_000;
    s.setItem("luxor.layout.projA", layout(["terminal-1"]));
    saveTerminalState("projA:terminal-1", snap({ savedAt: 1 }), s); // in layout → keep
    saveTerminalState("projA:terminal-gone", snap({ savedAt: 1 }), s); // old, orphan → drop
    saveTerminalState("projA:terminal-new", snap({ savedAt: now - 1000 }), s); // orphan but fresh → keep
    expect(pruneTerminalStates(s, now)).toBe(1);
    expect(loadTerminalState("projA:terminal-1", s)).not.toBeNull();
    expect(loadTerminalState("projA:terminal-gone", s)).toBeNull();
    expect(loadTerminalState("projA:terminal-new", s)).not.toBeNull();
  });

  it("prunes nothing when a layout cannot be read", () => {
    const s = memStore();
    s.setItem("luxor.layout.broken", "{oops");
    saveTerminalState("x:y", snap({ savedAt: 1 }), s);
    expect(pruneTerminalStates(s, 10_000_000)).toBe(0);
    expect(loadTerminalState("x:y", s)).not.toBeNull();
  });
});

describe("isRestoreEnabled", () => {
  it("defaults on and is switched off only by '0'", () => {
    const get = (v: string | null) => ({ getItem: (k: string) => (k === TERMINAL_RESTORE_KEY ? v : null) });
    expect(isRestoreEnabled(get(null))).toBe(true);
    expect(isRestoreEnabled(get("1"))).toBe(true);
    expect(isRestoreEnabled(get("0"))).toBe(false);
  });
});
