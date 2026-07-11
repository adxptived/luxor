import { describe, expect, test } from "bun:test";

import { diagnosticReportText, redactDiagnosticText, type DiagnosticReport } from "./diagnostics";

describe("developer diagnostics", () => {
  test("redacts common credentials without hiding useful context", () => {
    const input = "token=secret-value Bearer abc.def.ghi ghp_abcdefghijklmnopqrstuvwxyz api_key=topsecret status=401";
    const output = redactDiagnosticText(input);

    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(output).not.toContain("topsecret");
    expect(output).toContain("status=401");
  });

  test("creates a support-friendly summary", () => {
    const report: DiagnosticReport = {
      generated_at: "2026-07-11T00:00:00.000Z",
      duration_ms: 42,
      runtime: "tauri",
      project_attached: true,
      checks: [
        { id: "discord", group: "Discord RPC", label: "Handshake & presence", state: "warn", summary: "Discord IPC is not connected", detail: "token=do-not-copy", duration_ms: 12, checked_at: "2026-07-11T00:00:00.000Z" },
        { id: "git", group: "Tooling", label: "Git repository", state: "pass", summary: "Git repository detected", duration_ms: 3, checked_at: "2026-07-11T00:00:00.000Z" },
      ],
    };

    const text = diagnosticReportText(report);
    expect(text).toContain("1 passed, 1 warnings, 0 failed, 0 skipped");
    expect(text).toContain("[WARN] Discord RPC / Handshake & presence");
    expect(text).not.toContain("do-not-copy");
  });
});
