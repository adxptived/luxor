/**
 * Shared form primitives for the settings dialog.
 *
 * Split out of `SettingsModal.tsx` (2734 lines). These are pure, props-only
 * components with no dependency on the modal's draft state, which is what makes
 * moving them mechanical and safe. The ten SECTION bodies are a different
 * matter: each closes over ~20 pieces of local state, so extracting them is a
 * prop-contract design exercise rather than a move, and is deliberately left
 * for its own change.
 */

import { type LucideIcon } from "lucide-react";

import type { DetectedProgram } from "@/lib/types";

export function AboutLink(props: {
  icon: LucideIcon;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
          className="group flex items-center gap-3 rounded-lg border border-edge px-3 py-2.5 text-left transition-[transform,border-color,background-color] hover:-translate-y-px hover:border-accent hover:bg-raised"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-accent transition-colors group-hover:bg-accent/10">
        <props.icon size={16} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-strong">{props.label}</span>
        <span className="truncate text-2xs text-muted">{props.sub}</span>
      </span>
    </button>
  );
}

export function Row({
  label,
  help,
  wide = false,
  children,
}: {
  label: string;
  help?: string;
  /** Stack the control below the label at full width — for button groups, card grids and other wide content. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  // Settings-list row: label (+ always-visible help text) on the left,
  // control on the right, hairline divider between rows. Help used to hide
  // behind an ⓘ tooltip, which made every setting a guessing game; showing
  // it as a subtitle is the standard, scannable settings pattern.
  if (wide) {
    return (
      <div className="group flex flex-col gap-2 border-b border-edge/50 px-2 py-2.5 transition-colors last:border-b-0 hover:bg-raised/40">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-pretty leading-snug text-strong">{label}</span>
          {help && <span className="text-pretty text-2xs leading-4 text-muted">{help}</span>}
        </span>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="group grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-x-4 border-b border-edge/50 px-2 py-2 transition-colors last:border-b-0 hover:bg-raised/40">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-pretty leading-snug text-strong">{label}</span>
        {help && <span className="text-pretty text-2xs leading-4 text-muted">{help}</span>}
      </span>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

export function Input(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-muted"
    />
  );
}

export function NumberInput(props: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={String(props.value)}
      min={props.min}
      max={props.max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, Math.round(n))));
      }}
      className="w-28 rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-muted"
    />
  );
}

export function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-accent" : "bg-raised border border-edge"}`}
    >
      {/* Transform-based knob animation runs on the compositor (no layout work per frame). */}
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-bar shadow transition-transform duration-150 ${
          checked ? "translate-x-[1.025rem]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** Dropdown of detected programs + free-text input for custom commands. */
export function ProgramPicker(props: {
  value: string;
  detected: DetectedProgram[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {props.detected.length > 0 && (
        <select
          value={props.detected.some((d) => d.command === props.value) ? props.value : ""}
          onChange={(e) => props.onChange(e.target.value)}
          className="max-w-44 rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-muted"
        >
          <option value="">Default / custom…</option>
          {props.detected.map((d) => (
            <option key={d.command} value={d.command}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <Input value={props.value} placeholder={props.placeholder} onChange={props.onChange} />
    </span>
  );
}

export function Select(props: {
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-muted"
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {props.labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

export function DevToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs hover:bg-raised disabled:opacity-40 ${
        accent ? "text-accent" : "text-muted hover:text-strong"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

/**
 * Settings → Developer: a live log feed (frontend.log + this session's errors,
 * freezes and STARTUP telemetry) with one-click ways to copy / save / export
 * and share it, plus a startup-timing summary. Built so users can grab logs
 * without hunting for the config folder.
 */
