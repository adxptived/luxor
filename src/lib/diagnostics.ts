import { discordStatus, metricsCollect, telemetryDashboard, type DiscordStatus } from "./analytics";
import { getBackendStatus } from "./backendStatus";
import * as ipc from "./ipc";

export type DiagnosticState = "pass" | "warn" | "fail" | "skip";
export type DiagnosticGroup = "Runtime" | "Discord RPC" | "Tooling" | "Services" | "App features";

export interface DiagnosticCheck {
  id: string;
  group: DiagnosticGroup;
  label: string;
  state: DiagnosticState;
  summary: string;
  detail?: string;
  duration_ms: number;
  checked_at: string;
}

export interface DiagnosticReport {
  generated_at: string;
  duration_ms: number;
  runtime: "tauri" | "browser-preview";
  project_attached: boolean;
  checks: DiagnosticCheck[];
}

type ProbeResult = Pick<DiagnosticCheck, "state" | "summary" | "detail">;
type Probe = { id: string; group: DiagnosticGroup; label: string; run: () => Promise<ProbeResult> };

const ok = (summary: string, detail?: string): ProbeResult => ({ state: "pass", summary, detail });
const warn = (summary: string, detail?: string): ProbeResult => ({ state: "warn", summary, detail });
const skip = (summary: string, detail?: string): ProbeResult => ({ state: "skip", summary, detail });

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:ghp|github_pat|sk|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(client[_ -]?secret|api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function discordResult(status: DiscordStatus): ProbeResult {
  if (!status.enabled) return skip("Disabled in Analytics settings", "Enable Discord Rich Presence to exercise the IPC handshake.");
  if (status.connected) return ok("Presence frame sent successfully", status.ipc_connected ? "IPC handshake accepted; recent SET_ACTIVITY succeeded." : "Recent activity succeeded.");
  if (status.ipc_connected) return warn("IPC connected, but no recent activity", "The handshake works. Wait for the presence driver or inspect rate limiting and payload generation.");
  const retry = status.reconnect_in_ms ? ` Retry in ${Math.ceil(status.reconnect_in_ms / 1000)}s.` : "";
  return warn("Discord IPC is not connected", `${status.last_error ?? "No Discord socket was found. Make sure the desktop Discord client is running."}${retry}`);
}

async function timed(probe: Probe): Promise<DiagnosticCheck> {
  const started = performance.now();
  try {
    const result = await probe.run();
    return { ...probe, ...result, duration_ms: Math.round(performance.now() - started), checked_at: new Date().toISOString(), run: undefined } as unknown as DiagnosticCheck;
  } catch (error) {
    return {
      id: probe.id,
      group: probe.group,
      label: probe.label,
      state: "fail",
      summary: "Check failed",
      detail: redactDiagnosticText(error instanceof Error ? error.message : String(error)),
      duration_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }
}

export async function runDiagnostics(projectRoot = ""): Promise<DiagnosticReport> {
  const started = performance.now();
  const probes: Probe[] = [
    {
      id: "runtime", group: "Runtime", label: "Tauri backend", run: async () => {
        if (!ipc.isTauri) return warn("Browser preview mode", "Native IPC checks use development mocks. Run the desktop build for hardware and OS integration results.");
        const status = getBackendStatus();
        await ipc.statsSample();
        return status === "available" ? ok("Native backend responds") : warn(`Backend is ${status}`);
      },
    },
    {
      id: "filesystem", group: "Runtime", label: "Filesystem access", run: async () => {
        if (!projectRoot) return skip("No project attached", "Attach a folder to verify project read permissions.");
        const entries = await ipc.fsListDir(projectRoot);
        return ok(`Project directory readable · ${entries.length} entries`);
      },
    },
    {
      id: "discord", group: "Discord RPC", label: "Handshake & presence", run: async () => discordResult(await discordStatus()),
    },
    {
      id: "shells", group: "Tooling", label: "Shell / PTY", run: async () => {
        const shells = await ipc.ptyDetectShells();
        return shells.length ? ok(`${shells.length} shell${shells.length === 1 ? "" : "s"} detected`, shells.map((s) => s.label).join(", ")) : warn("No supported shell detected");
      },
    },
    {
      id: "git", group: "Tooling", label: "Git repository", run: async () => {
        if (!projectRoot) return skip("No project attached");
        const root = await ipc.gitDiscoverRoot(projectRoot);
        return root ? ok("Git repository detected") : skip("Folder is not a Git repository");
      },
    },
    {
      id: "github", group: "Tooling", label: "GitHub integration", run: async () => {
        if (!projectRoot) return skip("No project attached");
        const repo = await ipc.githubRepo(projectRoot);
        return repo ? ok("GitHub remote detected", `${repo.owner}/${repo.repo}`) : skip("No GitHub remote detected");
      },
    },
    {
      id: "docker", group: "Services", label: "Docker Engine", run: async () => {
        const version = await ipc.dockerVersion();
        return version ? ok("Docker is available", version) : skip("Docker is not installed or not running");
      },
    },
    {
      id: "database", group: "Services", label: "Database explorer", run: async () => ok("SQLite driver is bundled", "A database file is checked when it is opened in the explorer."),
    },
    {
      id: "telemetry", group: "App features", label: "Telemetry store", run: async () => {
        await telemetryDashboard();
        const metrics = await metricsCollect();
        return ok(`Telemetry database responds · ${metrics.length} metrics`);
      },
    },
    {
      id: "browser", group: "App features", label: "Browser preview", run: async () => ok(ipc.isTauri ? "Native webview API registered" : "Browser preview available", ipc.isTauri ? "Open a Browser panel to test navigation against a live page." : "Embedded native webview checks require Tauri."),
    },
    {
      id: "updater", group: "App features", label: "Updater", run: async () => {
        const config = await ipc.configGet();
        return config.ui.update_check ? ok("Automatic update checks enabled", config.ui.update_repo) : warn("Automatic update checks disabled", config.ui.update_repo);
      },
    },
    {
      id: "notifications", group: "App features", label: "Notifications", run: async () => {
        const config = await ipc.configGet();
        if (!config.notifications.enabled) return skip("Notifications disabled in settings");
        return ok(config.notifications.os_native ? "Native notifications enabled" : "In-app notifications enabled", "A test notification is intentionally not sent by diagnostics.");
      },
    },
  ];

  const checks = await Promise.all(probes.map(timed));
  return {
    generated_at: new Date().toISOString(),
    duration_ms: Math.round(performance.now() - started),
    runtime: ipc.isTauri ? "tauri" : "browser-preview",
    project_attached: Boolean(projectRoot),
    checks,
  };
}

export function diagnosticReportText(report: DiagnosticReport): string {
  const counts = report.checks.reduce<Record<DiagnosticState, number>>((acc, check) => ({ ...acc, [check.state]: acc[check.state] + 1 }), { pass: 0, warn: 0, fail: 0, skip: 0 });
  const lines = [
    "Luxor Developer Diagnostics",
    `Generated: ${report.generated_at}`,
    `Runtime: ${report.runtime}`,
    `Duration: ${report.duration_ms}ms`,
    `Summary: ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed, ${counts.skip} skipped`,
    "",
    ...report.checks.flatMap((check) => [
      `[${check.state.toUpperCase()}] ${check.group} / ${check.label} — ${check.summary} (${check.duration_ms}ms)`,
      ...(check.detail ? [`  ${check.detail}`] : []),
    ]),
  ];
  return redactDiagnosticText(lines.join("\n"));
}
