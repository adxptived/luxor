/**
 * Global PTY event bus.
 *
 * Why this exists: terminal output events are emitted by the Rust backend the
 * moment the shell starts — often *before* the panel's own `listen()`
 * registration resolves. Registering per-panel listeners after `pty_spawn`
 * lost the shell banner/prompt, leaving a blank terminal (the prompt is only
 * printed once). The bus registers ONE pair of listeners up-front (before any
 * spawn) and buffers output for sessions no panel has attached to yet, then
 * replays it on attach.
 */

import * as ipc from "./ipc";
import type { PtyExitPayload, PtyOutputPayload } from "./types";

export interface PtySessionHandlers {
  onOutput: (dataB64: string) => void;
  onExit: (exitCode: number | null) => void;
}

interface PendingSession {
  chunks: string[];
  bytes: number;
  exit: { code: number | null } | null;
  /** ms timestamp of the last event, for stale-session cleanup. */
  touched: number;
}

/** Per-session replay buffer caps (base64 chars ≈ bytes * 4/3). */
export const MAX_PENDING_CHUNKS = 512;
export const MAX_PENDING_BYTES = 2 * 1024 * 1024;
/** Pending sessions older than this are dropped on the next event. */
export const PENDING_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 5_000;

/**
 * Pure routing core (no Tauri imports) so the buffering/replay rules are unit
 * testable. The wiring at the bottom of this file feeds it real events.
 */
export class PtyRouter {
  private attached = new Map<string, PtySessionHandlers>();
  private pending = new Map<string, PendingSession>();
  private now: () => number;
  private nextSweepAt = 0;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  handleOutput(sessionId: string, dataB64: string): void {
    const handlers = this.attached.get(sessionId);
    if (handlers) {
      handlers.onOutput(dataB64);
      return;
    }
    this.sweepIfDue();
    let entry = this.pending.get(sessionId);
    if (!entry) {
      entry = { chunks: [], bytes: 0, exit: null, touched: 0 };
      this.pending.set(sessionId, entry);
    }
    entry.touched = this.now();
    entry.chunks.push(dataB64);
    entry.bytes += dataB64.length;
    // Keep the tail: the most recent output is what makes the prompt visible.
    while (entry.chunks.length > MAX_PENDING_CHUNKS || entry.bytes > MAX_PENDING_BYTES) {
      const dropped = entry.chunks.shift();
      if (dropped === undefined) break;
      entry.bytes -= dropped.length;
    }
  }

  handleExit(sessionId: string, exitCode: number | null): void {
    const handlers = this.attached.get(sessionId);
    if (handlers) {
      handlers.onExit(exitCode);
      return;
    }
    this.sweepIfDue();
    let entry = this.pending.get(sessionId);
    if (!entry) {
      entry = { chunks: [], bytes: 0, exit: null, touched: 0 };
      this.pending.set(sessionId, entry);
    }
    entry.touched = this.now();
    entry.exit = { code: exitCode };
  }

  /**
   * Attach a panel to a session: buffered output (and a buffered exit) is
   * replayed synchronously, then live events flow directly. Returns a detach
   * function.
   */
  attach(sessionId: string, handlers: PtySessionHandlers): () => void {
    const entry = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    this.attached.set(sessionId, handlers);
    if (entry) {
      for (const chunk of entry.chunks) handlers.onOutput(chunk);
      if (entry.exit) handlers.onExit(entry.exit.code);
    }
    return () => {
      if (this.attached.get(sessionId) === handlers) this.attached.delete(sessionId);
    };
  }

  /** Forget any buffered state for a session (e.g. spawn rolled back). */
  forget(sessionId: string): void {
    this.pending.delete(sessionId);
    this.attached.delete(sessionId);
  }

  /** Drop pending sessions nobody claimed within the TTL. */
  private sweepIfDue(): void {
    const now = this.now();
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    const cutoff = now - PENDING_TTL_MS;
    for (const [id, entry] of this.pending) {
      if (entry.touched !== 0 && entry.touched < cutoff) this.pending.delete(id);
    }
  }

  /** Test hook: number of sessions waiting for an owner. */
  get pendingCount(): number {
    return this.pending.size;
  }
}

const router = new PtyRouter();
let busReady: Promise<void> | null = null;

/**
 * Register the global listeners exactly once. MUST be awaited before calling
 * `pty_spawn`, otherwise early output can still be lost.
 */
export function ensurePtyBus(): Promise<void> {
  if (!busReady) {
    busReady = (async () => {
      await Promise.all([
        ipc.onPtyOutput((p: PtyOutputPayload) => router.handleOutput(p.session_id, p.data_b64)),
        ipc.onPtyExit((p: PtyExitPayload) => router.handleExit(p.session_id, p.exit_code ?? null)),
      ]);
    })().catch((e) => {
      // Allow a retry on the next terminal if registration failed.
      busReady = null;
      throw e;
    });
  }
  return busReady;
}

export function attachPty(sessionId: string, handlers: PtySessionHandlers): () => void {
  return router.attach(sessionId, handlers);
}

export function forgetPty(sessionId: string): void {
  router.forget(sessionId);
}
