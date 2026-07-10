/**
 * Agent tools and action log.
 *
 * Defines the tool interface that AI agents can invoke, and maintains a
 * rolling log of tool invocations so the user can see what the agent did
 * (read file, write file, run command, search, etc.).
 */

export type AgentToolKind =
  | "read_file"
  | "write_file"
  | "list_files"
  | "run_command"
  | "search"
  | "git_status"
  | "git_diff"
  | "git_commit"
  | "web_fetch"
  | "edit_range";

export interface AgentToolDef {
  kind: AgentToolKind;
  label: string;
  description: string;
}

/** Catalog of tools the agent can invoke. */
export const AGENT_TOOLS: AgentToolDef[] = [
  { kind: "read_file", label: "Read file", description: "Read the contents of a file" },
  { kind: "write_file", label: "Write file", description: "Write content to a file" },
  { kind: "list_files", label: "List files", description: "List files in a directory" },
  { kind: "run_command", label: "Run command", description: "Execute a shell command" },
  { kind: "search", label: "Search", description: "Search across project files" },
  { kind: "git_status", label: "Git status", description: "Get the current git status" },
  { kind: "git_diff", label: "Git diff", description: "Get the diff of changes" },
  { kind: "git_commit", label: "Git commit", description: "Create a git commit" },
  { kind: "web_fetch", label: "Web fetch", description: "Fetch a web page" },
  { kind: "edit_range", label: "Edit range", description: "Replace a range of lines in a file" },
];

// ---------------------------------------------------------------------------
// Action log
// ---------------------------------------------------------------------------

export type ActionStatus = "pending" | "success" | "error";

export interface AgentAction {
  id: number;
  /** Monotonic timestamp (ms). */
  ts: number;
  tool: AgentToolKind;
  label: string;
  /** Short argument summary, e.g. "src/main.ts" or "git status". */
  detail: string;
  status: ActionStatus;
  /** Duration in ms (filled when status becomes success/error). */
  durationMs?: number;
  /** Error message when status is "error". */
  error?: string;
}

const MAX_ACTIONS = 200;
let actionSeq = 0;
let actions: AgentAction[] = [];
const actionListeners = new Set<() => void>();

function emitActions(): void {
  for (const fn of actionListeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

/** Record a new pending action and return its id. */
export function logActionStart(tool: AgentToolKind, detail: string): number {
  const def = AGENT_TOOLS.find((t) => t.kind === tool);
  const id = ++actionSeq;
  actions = [...actions.slice(-(MAX_ACTIONS - 1)), {
    id,
    ts: Date.now(),
    tool,
    label: def?.label ?? tool,
    detail,
    status: "pending",
  }];
  emitActions();
  return id;
}

/** Mark an action as completed (success or error). */
export function logActionEnd(id: number, status: ActionStatus, error?: string): void {
  const startTs = actions.find((a) => a.id === id)?.ts ?? Date.now();
  actions = actions.map((a) =>
    a.id === id
      ? { ...a, status, error, durationMs: Date.now() - startTs }
      : a,
  );
  emitActions();
}

/** Get a snapshot of all actions (newest last). */
export function getActions(): AgentAction[] {
  return actions.slice();
}

/** Clear the action log. */
export function clearActions(): void {
  actions = [];
  emitActions();
}

/** Subscribe to action log changes. */
export function subscribeActions(fn: () => void): () => void {
  actionListeners.add(fn);
  return () => actionListeners.delete(fn);
}