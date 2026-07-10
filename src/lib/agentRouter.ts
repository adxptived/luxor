/**
 * Multi-model routing for AI requests.
 *
 * Routes requests to different models based on task type, context size,
 * and user preferences. Supports fallback chains and cost-aware selection.
 */

export type TaskKind =
  | "code_completion"
  | "code_review"
  | "chat"
  | "refactor"
  | "explain"
  | "test_generation"
  | "documentation"
  | "debug"
  | "architecture"
  | "security_review"
  | "general";

export interface ModelRoute {
  /** The model id to use. */
  model: string;
  /** Provider name (e.g. "openai", "anthropic", "local"). */
  provider: string;
  /** Priority (lower = preferred). */
  priority: number;
  /** Max context window in tokens. */
  maxContext: number;
  /** Relative cost per 1K tokens (0 = free/local). */
  costPer1K: number;
}

/** Default routing table: maps task kinds to ordered model preferences.
 *  Updated for 2025/2026 model families. Costs are approximate per 1M tokens
 *  (divided by 1000 for the per-1K field used by the cost-aware selector). */
const DEFAULT_ROUTES: Record<TaskKind, ModelRoute[]> = {
  code_completion: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "gpt-4.1", provider: "openai", priority: 2, maxContext: 1047576, costPer1K: 0.002 },
    { model: "gemini-2.5-pro", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00125 },
    { model: "deepseek-v3", provider: "deepseek", priority: 4, maxContext: 65536, costPer1K: 0.00027 },
    { model: "local", provider: "local", priority: 5, maxContext: 8192, costPer1K: 0 },
  ],
  code_review: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "gpt-4.1", provider: "openai", priority: 2, maxContext: 1047576, costPer1K: 0.002 },
    { model: "gemini-2.5-pro", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00125 },
  ],
  chat: [
    { model: "gpt-4.1-mini", provider: "openai", priority: 1, maxContext: 1047576, costPer1K: 0.0004 },
    { model: "claude-3.5-haiku", provider: "anthropic", priority: 2, maxContext: 200000, costPer1K: 0.0008 },
    { model: "gemini-2.5-flash", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00015 },
    { model: "local", provider: "local", priority: 4, maxContext: 8192, costPer1K: 0 },
  ],
  refactor: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "gpt-4.1", provider: "openai", priority: 2, maxContext: 1047576, costPer1K: 0.002 },
    { model: "deepseek-v3", provider: "deepseek", priority: 3, maxContext: 65536, costPer1K: 0.00027 },
  ],
  explain: [
    { model: "gpt-4.1-mini", provider: "openai", priority: 1, maxContext: 1047576, costPer1K: 0.0004 },
    { model: "claude-3.5-haiku", provider: "anthropic", priority: 2, maxContext: 200000, costPer1K: 0.0008 },
    { model: "gemini-2.5-flash", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00015 },
  ],
  test_generation: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "gpt-4.1", provider: "openai", priority: 2, maxContext: 1047576, costPer1K: 0.002 },
    { model: "deepseek-v3", provider: "deepseek", priority: 3, maxContext: 65536, costPer1K: 0.00027 },
  ],
  documentation: [
    { model: "gpt-4.1-mini", provider: "openai", priority: 1, maxContext: 1047576, costPer1K: 0.0004 },
    { model: "claude-3.5-haiku", provider: "anthropic", priority: 2, maxContext: 200000, costPer1K: 0.0008 },
    { model: "gemini-2.5-flash", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00015 },
  ],
  debug: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "gpt-4.1", provider: "openai", priority: 2, maxContext: 1047576, costPer1K: 0.002 },
    { model: "gemini-2.5-pro", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00125 },
  ],
  architecture: [
    { model: "claude-opus-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.015 },
    { model: "o3", provider: "openai", priority: 2, maxContext: 200000, costPer1K: 0.015 },
    { model: "gemini-2.5-pro", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00125 },
  ],
  security_review: [
    { model: "claude-sonnet-4", provider: "anthropic", priority: 1, maxContext: 200000, costPer1K: 0.003 },
    { model: "o3", provider: "openai", priority: 2, maxContext: 200000, costPer1K: 0.015 },
    { model: "gpt-4.1", provider: "openai", priority: 3, maxContext: 1047576, costPer1K: 0.002 },
  ],
  general: [
    { model: "gpt-4.1", provider: "openai", priority: 1, maxContext: 1047576, costPer1K: 0.002 },
    { model: "claude-sonnet-4", provider: "anthropic", priority: 2, maxContext: 200000, costPer1K: 0.003 },
    { model: "gemini-2.5-pro", provider: "google", priority: 3, maxContext: 1048576, costPer1K: 0.00125 },
    { model: "deepseek-v3", provider: "deepseek", priority: 4, maxContext: 65536, costPer1K: 0.00027 },
  ],
};

const STORAGE_KEY = "luxor.modelRoutes";

/** Load custom routes from localStorage, falling back to defaults. */
export function loadRoutes(): Record<TaskKind, ModelRoute[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ROUTES;
    const parsed = JSON.parse(raw);
    // Merge: use custom routes where available, defaults otherwise.
    return { ...DEFAULT_ROUTES, ...parsed };
  } catch {
    return DEFAULT_ROUTES;
  }
}

/** Save custom routes to localStorage. */
export function saveRoutes(routes: Record<TaskKind, ModelRoute[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch { /* best effort */ }
}

/**
 * Select the best model for a task, considering context size and cost.
 * Falls through the priority chain until a model with sufficient context is found.
 */
export function selectModel(
  task: TaskKind,
  estimatedTokens: number = 0,
  routes?: Record<TaskKind, ModelRoute[]>,
): ModelRoute | null {
  const table = routes ?? loadRoutes();
  const chain = table[task] ?? table.general;
  for (const route of chain) {
    if (estimatedTokens <= route.maxContext) return route;
  }
  // If no model has enough context, return the one with the largest window.
  return chain.reduce((best, r) => (r.maxContext > best.maxContext ? r : best), chain[0] ?? null);
}

/** Detect task kind from a user prompt. */
export function detectTaskKind(prompt: string): TaskKind {
  const p = prompt.toLowerCase();
  if (/^(write|create|generate|add)\s+(a\s+)?(test|spec)/.test(p)) return "test_generation";
  if (/(refactor|restructure|clean up|simplify)/.test(p)) return "refactor";
  if (/(review|check|audit|analyze)/.test(p)) return "code_review";
  if (/(security|vulnerab|cve|injection|xss|csrf)/.test(p)) return "security_review";
  if (/(debug|fix|error|bug|crash|stack ?trace|exception)/.test(p)) return "debug";
  if (/(architect|design|system design|plan|roadmap|structure)/.test(p)) return "architecture";
  if (/(explain|what does|how does|why)/.test(p)) return "explain";
  if (/(document|doc|readme|comment)/.test(p)) return "documentation";
  if (/(complete|autocomplete|suggest|finish)/.test(p)) return "code_completion";
  if (/(chat|hello|hi|help)/.test(p)) return "chat";
  return "general";
}

/** Estimate token count from text (rough: ~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}