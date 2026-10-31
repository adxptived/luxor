import { describe, expect, it } from "bun:test";

import { cleanShellTitle, terminalTitle } from "./terminalTitle";

describe("cleanShellTitle", () => {
  it("reduces executable paths to their name", () => {
    expect(cleanShellTitle("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toEqual({ text: "pwsh", isExecutable: true });
    expect(cleanShellTitle("Administrator: C:\\Windows\\System32\\cmd.exe")).toEqual({ text: "cmd", isExecutable: true });
    expect(cleanShellTitle("/usr/bin/zsh")).toEqual({ text: "zsh", isExecutable: true });
    expect(cleanShellTitle("Windows PowerShell").isExecutable).toBe(true);
  });

  it("keeps the folder of a user@host prompt title", () => {
    expect(cleanShellTitle("dev@box: ~/projects/aurora")).toEqual({ text: "aurora", isExecutable: false });
    expect(cleanShellTitle("dev@box: ~")).toEqual({ text: "~", isExecutable: false });
  });

  it("keeps a program's own title and drops control characters", () => {
    expect(cleanShellTitle("vim cart.ts\u0007")).toEqual({ text: "vim cart.ts", isExecutable: false });
    expect(cleanShellTitle("   ")).toEqual({ text: "", isExecutable: false });
  });
});

describe("terminalTitle", () => {
  it("prefers a meaningful shell title, then the folder, then the shell name", () => {
    expect(terminalTitle({ shellTitle: "htop", cwd: "/srv/app", fallback: "Terminal" })).toBe("htop");
    expect(terminalTitle({ shellTitle: "C:\\x\\pwsh.exe", cwd: "C:\\code\\api", fallback: "Terminal" })).toBe("api");
    expect(terminalTitle({ shellTitle: "C:\\x\\pwsh.exe", cwd: null, fallback: "Terminal" })).toBe("pwsh");
    expect(terminalTitle({ shellTitle: "", cwd: null, fallback: "Terminal" })).toBe("Terminal");
  });

  it("names the AI agent running in the terminal", () => {
    expect(terminalTitle({ shellTitle: "", cwd: "/p/app", agents: ["Claude Code"], fallback: "Terminal" })).toBe(
      "Claude Code · app",
    );
  });

  it("clips long titles", () => {
    const t = terminalTitle({ shellTitle: "x".repeat(80), cwd: null, fallback: "Terminal" });
    expect(t.length).toBe(32);
    expect(t.endsWith("…")).toBe(true);
  });
});
