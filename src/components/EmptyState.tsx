import type { ReactNode } from "react";

/**
 * The one empty state used across panels ("nothing here yet", "no results",
 * "tool not installed"). Before, six panels each had their own copy with
 * different paddings, dashed drop-zone-looking boxes and a forever-pulsing
 * icon; this keeps a single, calm layout:
 *
 *   [icon tile]
 *   Title
 *   One line of explanation.
 *   [optional action]
 *
 * `fill` centres it in the available height (whole-panel empty states);
 * without it, it sits inline in a list or section.
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  tone = "accent",
  fill = false,
  className = "",
}: {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  tone?: "accent" | "danger" | "muted";
  fill?: boolean;
  className?: string;
}) {
  const tile =
    tone === "danger"
      ? "bg-danger-soft text-danger"
      : tone === "muted"
        ? "bg-raised text-muted"
        : "bg-accent/10 text-accent";
  return (
    <div
      className={`lx-empty flex flex-col items-center px-6 text-center ${
        fill ? "h-full min-h-48 justify-center py-8" : "py-10"
      } ${className}`}
    >
      <div className={`lx-empty-icon mb-3 flex h-11 w-11 items-center justify-center rounded-lg ${tile}`} aria-hidden>
        {icon}
      </div>
      <div className="text-sm font-medium text-strong text-pretty">{title}</div>
      {text != null && text !== "" && (
        <div className="mt-1 max-w-sm text-xs leading-5 text-muted text-pretty">{text}</div>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
