/**
 * Retry utility for failed IPC operations.
 *
 * Wraps an async function with exponential backoff retry. The first attempt
 * runs immediately; subsequent attempts wait `baseDelay * 2^(attempt-1)` ms,
 * capped at `maxDelay`. Use `retryable()` for one-shot retries, or
 * `withRetry` for a higher-order wrapper.
 *
 * Graceful degradation: when `isTauri` is false (browser dev mode), retries
 * are skipped — the mock backend either works or it doesn't.
 */

import { isTauri } from "./ipc";

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Base delay in ms. Default 500. */
  baseDelay?: number;
  /** Maximum delay between retries in ms. Default 5000. */
  maxDelay?: number;
  /** Optional predicate: only retry if this returns true. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry with the attempt number and error. */
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void;
}

export async function retryable<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 500, maxDelay = 5000, shouldRetry, onRetry } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      if (shouldRetry && !shouldRetry(error, attempt)) break;
      // Skip retries in browser mock mode — the mock is deterministic.
      if (!isTauri && attempt >= 1) break;

      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      onRetry?.(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** Higher-order wrapper: returns a function that retries on failure. */
// TArgs extends unknown[] (not never[]) so real argument types are accepted.
export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts?: RetryOptions,
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => retryable(() => fn(...args), opts);
}

/**
 * Check if an error is a transient network/IPC error worth retrying.
 * Tauri IPC errors that indicate the backend is temporarily unavailable
 * (e.g. "command not found", timeout) are retryable.
 */
export function isTransientError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("connection refused") ||
    msg.includes("network") ||
    msg.includes("unavailable") ||
    msg.includes("temporarily")
  );
}