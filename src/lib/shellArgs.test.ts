import { describe, expect, it } from "bun:test";

import { effectiveShellArgs, formatShellArgs, parseShellArgs, POWERSHELL_HOOK_PLACEHOLDER } from "./shellArgs";

function ok(input: string): string[] {
  const parsed = parseShellArgs(input);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? parsed.args : [];
}

describe("shellArgs", () => {
  it("parses empty and whitespace-only input", () => {
    expect(ok("")).toEqual([]);
    expect(ok("   \t  ")).toEqual([]);
  });

  it("splits simple whitespace-separated args", () => {
    expect(ok("-NoLogo -NoProfile")).toEqual(["-NoLogo", "-NoProfile"]);
  });

  it("keeps quoted whitespace together", () => {
    expect(ok('-Command "Write-Host hello world"')).toEqual([
      "-Command",
      "Write-Host hello world",
    ]);
    expect(ok("-Command 'Write-Host hello world'")).toEqual([
      "-Command",
      "Write-Host hello world",
    ]);
  });

  it("supports escaped characters", () => {
    expect(ok(String.raw`--name hello\ world --flag`)).toEqual(["--name", "hello world", "--flag"]);
    expect(ok(String.raw`--json "{\"a\":1}"`)).toEqual(["--json", '{"a":1}']);
  });

  it("preserves empty quoted arguments", () => {
    expect(ok('--empty "" next')).toEqual(["--empty", "", "next"]);
  });

  it("reports unclosed quotes without changing settings", () => {
    const parsed = parseShellArgs('-Command "Write-Host hi');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("Unclosed double quote");
  });

  it("formats args so they can be edited and parsed back", () => {
    const args = ["-Command", "Write-Host hello world", "", 'quote "inside"'];
    const parsed = parseShellArgs(formatShellArgs(args));
    expect(parsed).toEqual({ ok: true, args });
  });
});

describe("effectiveShellArgs", () => {
  it("PowerShell gets the startup flags plus the cwd prompt hook", () => {
    const hook = ["-NoExit", "-EncodedCommand", POWERSHELL_HOOK_PLACEHOLDER];
    expect(effectiveShellArgs("powershell.exe", [], true)).toEqual(["-NoLogo", "-NoProfile", ...hook]);
    expect(effectiveShellArgs("C:\\Program Files\\PowerShell\\7\\pwsh.exe", [], false)).toEqual(["-NoLogo", ...hook]);
  });

  it("explicit args win and other shells get nothing injected", () => {
    expect(effectiveShellArgs("pwsh", ["-NoLogo"], true)).toEqual(["-NoLogo"]);
    expect(effectiveShellArgs("/bin/bash", [], true)).toEqual([]);
  });
});
