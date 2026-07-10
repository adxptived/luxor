/**
 * Per-terminal tracking of "a long command just finished" and "the AI agent
 * finished responding" — pure logic, no timers or IPC, so it is fully
 * unit-testable. The terminal feeds it events; it returns notifications due.
 *
 * Two complementary signals:
 *  - OSC 133 shell-integration marks (precise: command start/end + exit code).
 *  - Process-tree polls as a fallback for shells without OSC 133 (default
 *    Windows PowerShell): a tree that grew beyond the bare shell and shrank
 *    back means the foreground command finished.
 *
 * Agent detection: while a known agent (Claude Code, Codex, …) lives in the
 * terminal's process tree, a sustained output burst that was *not* caused by
 * typing, followed by silence, means the agent finished its response.
 */

export interface TrackerNotice {
  kind: "command_done" | "agent_done";
  /** Command runtime in seconds (command_done only). */
  durationSecs?: number;
  /** Exit code from OSC 133;D when available. */
  exitCode?: number | null;
  /** Agent labels, e.g. ["Claude Code"] (agent_done only). */
  agents?: string[];
}

/** Echo suppression: output within this window after a keystroke is "typing". */
const INPUT_ECHO_MS = 1000;
/** Agent response is considered finished after this much output silence. */
const AGENT_IDLE_MS = 3000;
/** Ignore output bursts shorter than this (prompt redraws, spinners…). */
const AGENT_MIN_BURST_MS = 1500;

export class CommandTracker {
  // --- OSC 133 command tracking ---
  private oscSeen = false;
  private oscStartedAt: number | null = null;

  // --- process-tree fallback ---
  private procBusySince: number | null = null;
  private procSawAgentWhileBusy = false;

  // --- agent burst tracking ---
  private agents: string[] = [];
  private lastInputAt = -Infinity;
  private burstStartAt: number | null = null;
  private lastOutputAt = 0;

  /** OSC 133;C — the shell is about to run a command. */
  oscCommandStart(now: number): void {
    this.oscSeen = true;
    this.oscStartedAt = now;
  }

  /** OSC 133;D — the command finished. Returns a notice when one is due. */
  oscCommandDone(exitCode: number | null, now: number): TrackerNotice | null {
    this.oscSeen = true;
    if (this.oscStartedAt === null) return null;
    const durationSecs = (now - this.oscStartedAt) / 1000;
    this.oscStartedAt = null;
    if (this.agents.length > 0) return null; // the agent tracker owns this
    return { kind: "command_done", durationSecs, exitCode };
  }

  /** User pressed a key — output right after this is just the echo. */
  userInput(now: number): void {
    this.lastInputAt = now;
    this.burstStartAt = null;
  }

  /** The terminal produced output. */
  output(now: number): void {
    if (this.agents.length === 0) return;
    if (now - this.lastInputAt < INPUT_ECHO_MS) return; // typing echo
    if (this.burstStartAt === null) this.burstStartAt = now;
    this.lastOutputAt = now;
  }

  /**
   * Periodic process-tree sample (`pty_tree_stats`).
   * `processes` includes the shell itself; agents are detected tree labels.
   */
  treeSample(processes: number, agents: string[], now: number): TrackerNotice[] {
    const out: TrackerNotice[] = [];
    const hadAgents = this.agents;
    this.agents = agents;

    // The agent process exited mid-burst — that response is over.
    if (hadAgents.length > 0 && agents.length === 0 && this.burstStartAt !== null) {
      if (this.lastOutputAt - this.burstStartAt >= AGENT_MIN_BURST_MS) {
        out.push({ kind: "agent_done", agents: hadAgents });
      }
      this.burstStartAt = null;
    }

    // Fallback command tracking (only when the shell has no OSC 133).
    if (!this.oscSeen) {
      if (processes > 1) {
        if (this.procBusySince === null) {
          this.procBusySince = now;
          this.procSawAgentWhileBusy = false;
        }
        if (agents.length > 0) this.procSawAgentWhileBusy = true;
      } else if (this.procBusySince !== null) {
        const durationSecs = (now - this.procBusySince) / 1000;
        const sawAgent = this.procSawAgentWhileBusy;
        this.procBusySince = null;
        this.procSawAgentWhileBusy = false;
        if (!sawAgent) out.push({ kind: "command_done", durationSecs, exitCode: null });
      }
    }
    return out;
  }

  /** Periodic clock tick — detects "agent went quiet". */
  tick(now: number): TrackerNotice | null {
    if (this.burstStartAt === null || this.agents.length === 0) return null;
    if (now - this.lastOutputAt < AGENT_IDLE_MS) return null;
    const longEnough = this.lastOutputAt - this.burstStartAt >= AGENT_MIN_BURST_MS;
    this.burstStartAt = null;
    return longEnough ? { kind: "agent_done", agents: [...this.agents] } : null;
  }

  /** Agent labels currently present in the terminal's process tree. */
  currentAgents(): string[] {
    return this.agents;
  }
}
