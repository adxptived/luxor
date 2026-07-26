import { Bot, FolderOpen, RefreshCw, Skull, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { fmtCpu } from "@/lib/cpu";
import { logActivity } from "@/lib/activityLog";
import { schedulePoll } from "@/lib/poll";
import type { AgentProcess } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";

const POLL_MS = 3000;

function fmtMem(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb.toFixed(0)}M`;
}

function fmtUptime(secs: number): string {
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  return `${secs}s`;
}

/** Last path segment of a working directory, for a compact "project" label. */
function baseName(path: string): string {
  if (!path) return "";
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Live view of every AI CLI agent running on the machine (Claude Code,
 *  Codex, Gemini, OpenCode, Devin, …): per-process CPU/RAM/uptime, the
 *  directory it runs in, a working/idle indicator, plus terminal integration
 *  (open a shell in that directory, reveal it) and a kill switch. */
export function AgentsPanel() {
  const [procs, setProcs] = useState<AgentProcess[] | null>(null);
  const [killing, setKilling] = useState<Set<number>>(new Set());
  const confirm = useUiStore((s) => s.confirm);
  const addTerminal = useDockStore((s) => s.addTerminal);

  // Imperative one-shot refresh (also used right after a kill so the list
  // reflects reality immediately instead of waiting for the next poll tick).
  const refresh = useMemo(
    () => () =>
      ipc
        .agentsProcesses()
        .then((rows) => setProcs(rows))
        .catch(() => setProcs([])),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    // Walking the OS process tree is expensive — the shared scheduler stops
    // polling entirely while hidden (tray), avoids overlapping walks when one
    // runs slowly, and refreshes immediately when the window is shown again.
    const unsubscribe = schedulePoll(
      () =>
        ipc
          .agentsProcesses()
          .then((rows) => {
            if (!cancelled) setProcs(rows);
          })
          .catch(() => {
            if (!cancelled) setProcs([]);
          }),
      POLL_MS,
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const groups = useMemo(() => {
    const byLabel = new Map<string, AgentProcess[]>();
    for (const p of procs ?? []) {
      const list = byLabel.get(p.label) ?? [];
      list.push(p);
      byLabel.set(p.label, list);
    }
    return [...byLabel.entries()];
  }, [procs]);

  const totals = useMemo(() => {
    const rows = procs ?? [];
    return {
      cpu: rows.reduce((n, p) => n + p.cpu_percent, 0),
      mem: rows.reduce((n, p) => n + p.mem_bytes, 0),
      busy: rows.filter((p) => p.busy).length};
  }, [procs]);

  const kill = async (p: AgentProcess) => {
    const ok = await confirm({
      title: t("agents.kill_title", "Stop agent?"),
      message: `${p.label} (PID ${p.pid})`,
      confirmLabel: t("agents.kill_confirm", "Stop"),
      danger: true});
    if (!ok) return;
    setKilling((s) => new Set(s).add(p.pid));
    try {
      await ipc.processKill(p.pid, true);
      logActivity("app", `Killed agent ${p.label} (pid ${p.pid})`);
      setProcs((cur) => cur?.filter((x) => x.pid !== p.pid) ?? null);
      useAppStore.getState().toast(t("agents.killed", "Agent stopped:") + ` ${p.label}`, "success");
    } catch (e) {
      // The backend now verifies the kill, so an error means it genuinely
      // survived — surface it and re-sync the list so the row stays visible.
      useAppStore.getState().toast(errorMessage(e), "error");
      void refresh();
    } finally {
      setKilling((s) => {
        const next = new Set(s);
        next.delete(p.pid);
        return next;
      });
    }
  };

  const openHere = (p: AgentProcess) => {
    if (!p.cwd) {
      useAppStore.getState().toast(t("agents.no_cwd", "Working directory unknown"), "info");
      return;
    }
    addTerminal({ cwd: p.cwd });
    logActivity("app", `Opened terminal in ${p.cwd} (agent ${p.label})`);
  };

  
  return (
    <div className="flex h-full flex-col overflow-auto bg-surface p-3 text-sm" data-testid="agents-panel">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-bar/45 px-3 py-2 shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-strong">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <Bot size={17} />
          </span>
          <div className="min-w-0">
            <div className="font-medium">{t("agents.title", "AI agents")}</div>
            <div className="truncate text-xs text-muted">
              {procs === null
                ? t("agents.scanning", "Scanning running agent processes…")
                : t("agents.running_count", "running:") + ` ${procs.length}`}
            </div>
          </div>
        </div>
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
          title={t("agents.refresh", "Refresh now")}
          data-testid="agents-refresh"
        >
          <RefreshCw size={12} /> {POLL_MS / 1000}s
        </button>
      </div>

      {procs !== null && procs.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-edge bg-raised/70 px-3 py-2 font-mono text-xs text-muted">
          <span>
            <span className="text-accent">{totals.busy}</span> {t("agents.working", "working")}
          </span>
          <span title={t("agents.cpu_hint", "Share of total CPU (all cores). Raw per-core sum:") + ` ${totals.cpu.toFixed(0)}%`}>
            {fmtCpu(totals.cpu)} CPU
          </span>
          <span>{fmtMem(totals.mem)} RAM</span>
        </div>
      )}


          {procs !== null && procs.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-10 text-center text-muted">
          <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <Bot size={28} />
          </div>
          <div className="font-medium text-strong">{t("agents.empty", "No AI agents running")}</div>
          <div className="mx-auto mt-1 max-w-md text-xs leading-5 opacity-70">
            {t(
              "agents.empty_hint",
              "Start claude, codex, gemini, opencode, devin… in any terminal and they will show up here automatically.",
            )}
          </div>
        </div>
      )}

      {groups.map(([label, rows]) => (
        <div key={label} className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            {label}
            <span className="rounded bg-raised px-1.5 text-3xs">{rows.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-edge">
            {rows.map((p) => (
              <div
                key={p.pid}
                className="flex flex-col gap-1 border-b border-edge bg-surface px-3 py-2 last:border-b-0"
                title={p.cmd}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${p.busy ? "bg-success" : "bg-edge"}`}
                    title={p.busy ? t("agents.working", "working") : t("agents.idle", "idle")}
                  />
                  <span className="w-14 shrink-0 font-mono text-xs text-muted">{p.pid}</span>
                  <span
                    className="w-20 shrink-0 font-mono text-xs"
                    title={t("agents.cpu_hint", "Share of total CPU (all cores). Raw per-core sum:") + ` ${p.cpu_percent.toFixed(0)}%`}
                  >
                    {fmtCpu(p.cpu_percent)} CPU
                  </span>
                  <span className="w-14 shrink-0 font-mono text-xs">{fmtMem(p.mem_bytes)}</span>
                  <span className="w-16 shrink-0 font-mono text-xs text-muted">
                    {fmtUptime(p.run_secs)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${p.busy ? "text-accent" : "text-muted"}`}
                  >
                    {p.busy ? t("agents.busy_label", "● working") : t("agents.idle", "idle")}
                  </span>
                  <button
                    onClick={() => openHere(p)}
                    className="shrink-0 rounded p-1 text-muted hover:bg-raised hover:text-accent"
                    title={t("agents.open_terminal", "Open terminal in this directory")}
                    data-testid={`agent-term-${p.pid}`}
                  >
                    <TerminalSquare size={14} />
                  </button>
                  <button
                    onClick={() => void ipc.openPath(p.cwd)}
                    disabled={!p.cwd}
                    className="shrink-0 rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                    title={t("agents.reveal", "Reveal working directory")}
                    data-testid={`agent-reveal-${p.pid}`}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    onClick={() => void kill(p)}
                    disabled={killing.has(p.pid)}
                    className="shrink-0 rounded p-1 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                    title={t("agents.kill_title", "Stop agent?")}
                    data-testid={`agent-kill-${p.pid}`}
                  >
                    {killing.has(p.pid) ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Skull size={14} />
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-5 font-mono text-2xs text-muted">
                  <FolderOpen size={11} className="shrink-0 opacity-60" />
                  {p.cwd ? (
                    <>
                      <span className="shrink-0 text-strong">{baseName(p.cwd)}</span>
                      <span className="min-w-0 truncate opacity-70">{p.cwd}</span>
                    </>
                  ) : (
                    <span className="opacity-60">{t("agents.no_cwd", "Working directory unknown")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

