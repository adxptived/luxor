/**
 * Graceful degradation utilities for when the Tauri backend is unavailable.
 *
 * Detects backend status and provides fallback behaviors so the UI remains
 * usable (read-only mode) even when IPC calls fail.
 */

import { isTauri } from "./ipc";

export type BackendStatus = "available" | "degraded" | "unavailable";

let currentStatus: BackendStatus = isTauri ? "available" : "unavailable";
let consecutiveFailures = 0;
const FAILURE_THRESHOLD = 3;
const listeners = new Set<(status: BackendStatus) => void>();

/** Get the current backend status. */
export function getBackendStatus(): BackendStatus {
  return currentStatus;
}

/** Report a successful IPC call — resets the failure counter. */
export function reportBackendSuccess(): void {
  consecutiveFailures = 0;
  if (currentStatus !== "available") {
    setStatus("available");
  }
}

/** Report a failed IPC call — may transition to degraded/unavailable. */
export function reportBackendFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD && currentStatus === "available") {
    setStatus("degraded");
  }
}

/** Subscribe to backend status changes. Returns an unsubscribe function. */
export function onBackendStatusChange(cb: (status: BackendStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setStatus(status: BackendStatus): void {
  if (currentStatus === status) return;
  currentStatus = status;
  for (const cb of listeners) {
    try {
      cb(status);
    } catch {
      // Listener errors should not propagate.
    }
  }
}

/**
 * Wrap an IPC call with automatic backend status tracking.
 * On failure, reports the failure and re-throws.
 * Returns a fallback value if the backend is unavailable and a fallback is provided.
 */
export async function withBackendFallback<T>(
  fn: () => Promise<T>,
  fallback?: T | (() => T | Promise<T>),
): Promise<T> {
  if (currentStatus === "unavailable" && fallback !== undefined) {
    return typeof fallback === "function" ? await (fallback as () => T | Promise<T>)() : fallback;
  }
  try {
    const result = await fn();
    reportBackendSuccess();
    return result;
  } catch (error) {
    reportBackendFailure();
    if (fallback !== undefined) {
      return typeof fallback === "function" ? await (fallback as () => T | Promise<T>)() : fallback;
    }
    throw error;
  }
}

/** Human-readable message for the current backend status. */
export function backendStatusMessage(status: BackendStatus): string {
  switch (status) {
    case "available":
      return "Backend connected";
    case "degraded":
      return "Backend degraded — some features may be unavailable. Retrying…";
    case "unavailable":
      return "Backend unavailable — running in limited mode. File operations and terminals are disabled.";
  }
}

/** Check if a specific feature is available given the backend status. */
export function isFeatureAvailable(
  feature: "files" | "git" | "terminal" | "ai" | "docker" | "db",
): boolean {
  if (currentStatus === "available") return true;
  if (currentStatus === "degraded") {
    // In degraded mode, read-only features still work.
    return feature === "files" || feature === "git";
  }
  // Unavailable: nothing works except the UI shell.
  return false;
}