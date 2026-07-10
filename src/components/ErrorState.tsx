import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { t } from "@/lib/i18n";

interface ErrorStateProps {
  /** Short headline, e.g. "Couldn't load branches". */
  title: string;
  /** Optional detail line (often the error message). */
  message?: ReactNode;
  /** Retry handler — when provided, a "Try again" button is shown. */
  onRetry?: () => void;
  /** Whether a retry is currently in flight (disables + spins the button). */
  retrying?: boolean;
  /** Icon override; defaults to a warning triangle. */
  icon?: ComponentType<{ size?: number | string; className?: string }>;
  /** Extra actions rendered next to the retry button. */
  children?: ReactNode;
  /** Fill the parent (default) or render compactly inline. */
  compact?: boolean;
}

/**
 * Shared, accessible error panel with an in-place retry affordance (P2PN-01).
 *
 * Panels previously showed load failures only as transient toasts, leaving an
 * empty pane with no way to recover without re-triggering the action from
 * elsewhere. This gives every panel a consistent "something failed — try again
 * here" surface. Uses role="alert" so screen readers announce the failure.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  icon: Icon = AlertTriangle,
  children,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={
        compact
          ? "flex flex-col items-center gap-2 p-4 text-center text-muted"
          : "flex h-full flex-col items-center justify-center bg-surface p-6 text-center text-muted"
      }
    >
      <div className="max-w-md rounded-lg border border-edge bg-bar/40 p-5 shadow-sm">
        <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-danger-soft-strong bg-danger-soft text-danger">
          <Icon size={26} />
        </div>
        <div className="text-sm font-medium text-strong text-pretty">{title}</div>
        {message != null && message !== "" && (
          <div className="mt-1 break-words text-xs leading-5">{message}</div>
        )}
        {(onRetry || children) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-strong hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={13} className={retrying ? "lx-anim-spin" : undefined} />
                {retrying ? t("Retrying…") : t("Try again")}
              </button>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
