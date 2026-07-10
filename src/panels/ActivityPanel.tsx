/**
 * Activity Log panel: searchable, filterable history of what happened in
 * this session (commits, terminal events, saves, errors, …).
 */

import { Activity, Eraser, ScrollText, Search, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { t, getLocale } from "@/lib/i18n";
import { confirmDestructive } from "@/state/uiStore";

import {
  clearActivity,
  filterActivity,
  getActivity,
  subscribeActivity,
  type ActivityKind,
} from "@/lib/activityLog";

const KIND_FILTERS: { id: ActivityKind; label: string }[] = [
  { id: "git", label: "Git" },
  { id: "terminal", label: "Terminal" },
  { id: "file", label: "Files" },
  { id: "app", label: "App" },
  { id: "success", label: "Success" },
  { id: "error", label: "Errors" },
  { id: "info", label: "Info" },
];

const KIND_COLORS: Record<ActivityKind, string> = {
  git: "text-chart-1",
  terminal: "text-chart-2",
  file: "text-chart-3",
  app: "text-muted",
  success: "text-success",
  error: "text-danger",
  info: "text-muted",
};

const KIND_DOTS: Record<ActivityKind, string> = {
  git: "bg-chart-1",
  terminal: "bg-chart-2",
  file: "bg-chart-3",
  app: "bg-muted",
  success: "bg-success",
  error: "bg-danger",
  info: "bg-muted",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay ? hm : `${d.toLocaleDateString(getLocale(), { month: "short", day: "numeric" })} ${hm}`;
}

export function ActivityPanel() {
  const events = useSyncExternalStore(subscribeActivity, getActivity, getActivity);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<ActivityKind>>(new Set());

  const toggleKind = (k: ActivityKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const visible = filterActivity(events, query, kinds.size > 0 ? kinds : null);
  const activeFilters = kinds.size + (query.trim() ? 1 : 0);

  return (
    <div className="flex h-full w-full flex-col bg-surface" data-testid="activity-panel">
      <div className="border-b border-edge bg-bar/55 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <ScrollText size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-strong">{t("Activity log")}</div>
            <div className="text-xs text-muted">{t("Commits, terminal events, saves, errors and app notices in one searchable stream.")}</div>
          </div>
          <span className="rounded-full border border-edge bg-surface px-2 py-1 text-[11px] tabular-nums text-muted">
            {visible.length}/{events.length}
          </span>
          <button
            onClick={() =>
              void confirmDestructive({
                title: t("Clear activity log"),
                message: t("Remove all logged events? This cannot be undone."),
                confirmLabel: t("Clear"),
              }).then((ok) => {
                if (ok) clearActivity();
              })
            }
            title={t("Clear the activity log")}
            className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong"
          >
            <Eraser size={12} /> {t("Clear")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-edge bg-surface px-2 py-1.5">
            <Search size={13} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Filter activity…")}
              className="min-w-0 flex-1 bg-transparent text-xs text-strong outline-none placeholder:text-muted"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("Clear search")} title={t("Clear search")} className="rounded p-0.5 text-muted hover:bg-raised hover:text-strong">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {KIND_FILTERS.map((k) => (
              <button
                key={k.id}
                onClick={() => toggleKind(k.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  kinds.has(k.id)
                    ? "border-muted bg-raised text-strong"
                    : "border-edge bg-surface text-muted hover:bg-raised hover:text-strong"
                }`}
              >
                {t(k.label)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 && (
          <div className="flex h-full min-h-48 items-center justify-center p-4">
            <div className="max-w-md rounded-lg border border-dashed border-edge bg-bar/30 px-6 py-8 text-center text-xs text-muted">
              <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
                <Activity size={26} />
              </div>
              <div className="font-medium text-strong">
                {events.length === 0 ? t("Nothing logged yet") : t("No events match the current filter")}
              </div>
              <div className="mt-1 leading-5">
                {events.length === 0
                  ? t("Commits, terminal events, saves and errors will show up here.")
                  : t("Clear search or disable a kind chip to bring events back.")}
              </div>
              {activeFilters > 0 && (
                <button
                  onClick={() => {
                    setQuery("");
                    setKinds(new Set());
                  }}
                  className="mt-3 rounded-lg border border-edge px-2 py-1 hover:bg-raised hover:text-strong"
                >
                  {t("Clear filters")}
                </button>
              )}
            </div>
          </div>
        )}
        <div className="space-y-1">
          {visible.map((e) => (
            <div
              key={e.id}
              data-testid="activity-item"
              className="flex gap-3 rounded-lg bg-bar/20 px-3 py-2 text-xs"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-muted">{fmtTime(e.time)}</span>
              <span className={`mt-0.5 flex w-[4.75rem] shrink-0 items-center gap-1.5 text-[10px] uppercase ${KIND_COLORS[e.kind]}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOTS[e.kind]}`} />
                {e.kind}
              </span>
              <span className="min-w-0 flex-1 break-words leading-5 text-strong">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
