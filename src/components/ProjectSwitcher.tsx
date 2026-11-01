/**
 * Quick switcher, Ctrl+R by default (browser-tab-style fuzzy jump): every
 * project tab and, under each one, its terminals with what they are doing —
 * one place to hop between several projects and the shells running in them.
 */

import { CornerDownLeft, FolderGit2, LayoutGrid, Search, TerminalSquare, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fuzzyFilter } from "@/lib/fuzzy";
import { hintFor } from "@/lib/hotkeys";
import { FuzzyText } from "@/components/CommandPalette";
import { useAppStore } from "@/state/appStore";
import { t } from "@/lib/i18n";
import { useProjectsStore } from "@/state/projectsStore";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useDelayedUnmount } from "@/lib/dismiss";
import { announce } from "@/lib/useAriaLive";
import { focusTerminal, listTerminals, WELCOME_KEY, type TerminalRef } from "@/layout/dockStore";
import { useTerminalStatus } from "@/state/terminalStatus";
import type { Project } from "@/lib/types";
import type { TerminalActivity } from "@/lib/terminalActivity";

type Row =
  | { kind: "project"; key: string; project: Project }
  | { kind: "terminal"; key: string; owner: string; term: TerminalRef };

/** Projects in tab order, each followed by its open terminals. */
function buildRows(projects: readonly Project[], terminals: readonly TerminalRef[]): Row[] {
  const rows: Row[] = [];
  const byDock = new Map<string, TerminalRef[]>();
  for (const term of terminals) byDock.set(term.dockKey, [...(byDock.get(term.dockKey) ?? []), term]);
  for (const project of projects) {
    rows.push({ kind: "project", key: `p:${project.id}`, project });
    for (const term of byDock.get(project.id) ?? []) {
      rows.push({ kind: "terminal", key: `t:${term.dockKey}:${term.panelId}`, owner: project.name, term });
    }
  }
  for (const term of byDock.get(WELCOME_KEY) ?? []) {
    rows.push({ kind: "terminal", key: `t:${term.dockKey}:${term.panelId}`, owner: t("No project"), term });
  }
  return rows;
}

const ACTIVITY_LABEL: Record<TerminalActivity, string> = {
  running: "Running",
  idle: "At prompt",
  exited: "Exited",
  failed: "Failed",
};

export function ProjectSwitcher() {
  const open = useAppStore((s) => s.switcherOpen);
  const setOpen = useAppStore((s) => s.setSwitcherOpen);
  const { projects, activeId, setActive } = useProjectsStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { mounted, leaving } = useDelayedUnmount(open, 180);

  // Terminals live in dockview, not in a store: snapshot them when opened.
  const [terminals, setTerminals] = useState<TerminalRef[]>([]);
  const activity = useTerminalStatus((st) => st.byPanel);
  const rows = useMemo(() => buildRows(projects, terminals), [projects, terminals]);
  const filtered = useMemo(
    () =>
      fuzzyFilter(rows, query, (r) =>
        r.kind === "project" ? `${r.project.name} ${r.project.path}` : `${r.owner} ${r.term.title} terminal`,
      ),
    [rows, query],
  );

  // Focus trap: keep Tab cycling within the switcher while open.
  useFocusTrap(containerRef, open, { initialFocus: inputRef });

  useEffect(() => {
    if (open) {
      setQuery("");
      const terms = listTerminals();
      setTerminals(terms);
      // Pre-select the next project for fast cycling.
      const projectRows = buildRows(projects, terms);
      const order = projectRows.flatMap((r, i) => (r.kind === "project" ? [i] : []));
      const cur = order.findIndex((i) => {
        const r = projectRows[i];
        return r.kind === "project" && r.project.id === activeId;
      });
      setSelected(order.length > 1 ? order[(cur + 1) % order.length] : 0);
      announce(t("Switch project"));
      // Focus is handled by useFocusTrap, but set a fallback timeout.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  // Two-step Escape (matches the command palette): first press clears an
  // active query so all projects reappear; second press closes the switcher.
  const onEscape = () => {
    if (inputRef.current?.value) {
      setQuery("");
      inputRef.current.focus();
      return;
    }
    setOpen(false);
  };

  // Window-level Escape so the switcher responds even when the input loses focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setOpen]);

  if (!mounted) return null;

  const pick = (row: Row) => {
    setOpen(false);
    if (row.kind === "terminal") {
      focusTerminal(row.term.dockKey, row.term.panelId, setActive);
      announce(`${t("Switched to")} ${row.term.title}`);
      return;
    }
    setActive(row.project.id);
    announce(`${t("Switched to")} ${row.project.name}`);
  };

  return (
    <div
      ref={containerRef}
      className={`lx-project-switcher fixed inset-0 z-[var(--lx-z-overlay)] flex items-start justify-center bg-black/60 px-3 pt-[14vh] ${leaving ? "lx-palette-leaving" : ""}`} style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("Switch project")}
      onClick={() => setOpen(false)}
    >
      {/* Column bounded by the viewport, so the list — not the dialog — is what
          gives way on a short window (see CommandPalette). */}
      <div
        className="lx-pop-in lx-glass flex max-h-[calc(100vh-20vh)] w-[34rem] max-w-[96vw] flex-col overflow-hidden"
        style={{ borderRadius: "var(--lx-radius-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-edge bg-[radial-gradient(circle_at_top_left,var(--lx-raised),transparent_56%)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-medium text-muted">{t("Projects and terminals")}</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 focus-within:border-transparent">
            <Search size={15} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onEscape();
                if (e.key === "ArrowDown" || ((e.key === "p" || e.key === "r") && e.ctrlKey && !e.shiftKey)) {
                  e.preventDefault();
                  setSelected((s) => (filtered.length ? (s + 1) % filtered.length : 0));
                }
                if (e.key === "ArrowUp" || ((e.key === "P" || e.key === "R" || e.key === "p" || e.key === "r") && e.ctrlKey && e.shiftKey)) {
                  e.preventDefault();
                  setSelected((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0));
                }
                if (e.key === "Enter" && filtered[selected]) {
                  e.preventDefault();
                  pick(filtered[selected]);
                }
              }}
              placeholder={t("Switch to a project or terminal…")}
              className="min-w-0 flex-1 bg-transparent py-3 text-strong outline-none placeholder:text-muted/70"
            />
            <span className="rounded-full border border-edge px-2 py-0.5 text-3xs text-muted">
              {filtered.length}/{rows.length}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5 [max-height:min(24rem,58vh)]">
          {filtered.map((row, i) => {
            const sel = i === selected;
            const rowClass = `group flex w-full min-w-0 items-center gap-3 rounded-md text-left text-sm transition-colors duration-[var(--lx-dur-fast)] ${
              sel ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
            }`;
            if (row.kind === "terminal") {
              const act = activity[row.term.panelId] ?? "idle";
              return (
                <button
                  key={row.key}
                  onClick={() => pick(row)}
                  onMouseEnter={() => setSelected(i)}
                  aria-selected={sel}
                  role="option"
                  data-testid="switcher-terminal"
                  className={`${rowClass} py-1.5 pl-8 pr-3`}
                >
                  <TerminalSquare size={14} className={`shrink-0 ${sel ? "text-strong" : "text-muted"}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <FuzzyText text={row.term.title} query={query} />
                    {query.trim() && <span className="ml-2 text-xs text-muted">{row.owner}</span>}
                  </span>
                  <ActivityBadge activity={act} hidden={!row.term.visible} />
                  {sel && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
                </button>
              );
            }
            const p = row.project;
            return (
              <button
                key={row.key}
                onClick={() => pick(row)}
                onMouseEnter={() => setSelected(i)}
                aria-selected={sel}
                role="option"
                className={`${rowClass} px-3 py-2`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    sel ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"
                  }`}
                >
                  {p.path === "" ? (
                    <LayoutGrid size={14} />
                  ) : !p.path_exists ? (
                    <TriangleAlert size={14} className="text-warning" />
                  ) : (
                    <FolderGit2 size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-strong">
                    <FuzzyText text={p.name} query={query} />
                  </span>
                  <span className="block truncate text-xs text-muted">{p.path || t("Blank workspace")}</span>
                </span>
                {p.id === activeId && <span className="rounded-full border border-edge px-2 py-0.5 text-3xs text-muted">{t("active")}</span>}
                {sel && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="m-2 rounded-lg border border-dashed border-edge px-4 py-7 text-center text-sm text-muted">
              <Search size={19} className="mx-auto mb-2 text-accent" />
              <div className="font-medium text-strong">{t("No matching projects or terminals")}</div>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-5">
                {t("Search by project name, path or terminal title, or clear the query to see everything.")}
              </p>
            </div>
          )}
        </div>
        {/* Keyboard cheat sheet: the open chord cycles forward, so holding it
            after opening flips through projects like a browser tab switcher. */}
        <div className="flex min-h-9 items-center justify-end gap-2.5 border-t border-edge bg-surface/60 px-3 py-1.5 text-xs text-muted">
          <span className="flex items-center gap-1"><SwitcherKbd>↑↓ / {hintFor("projects.switch", useAppStore.getState().config) || "Ctrl+R"}</SwitcherKbd> {t("navigate")}</span>
          <span className="flex items-center gap-1"><SwitcherKbd>↵</SwitcherKbd> {t("switch")}</span>
          <span className="flex items-center gap-1"><SwitcherKbd>Esc</SwitcherKbd> {t("close")}</span>
        </div>
      </div>
    </div>
  );
}

/** What a terminal is doing, as a small dot + word. */
function ActivityBadge({ activity, hidden }: { activity: TerminalActivity; hidden: boolean }) {
  const dot =
    activity === "running"
      ? "animate-pulse bg-accent"
      : activity === "failed"
        ? "bg-danger"
        : activity === "exited"
          ? "bg-muted/50"
          : "bg-success/70";
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-3xs text-muted" data-activity={activity}>
      {hidden && <span className="rounded border border-edge px-1">{t("hidden")}</span>}
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {t(ACTIVITY_LABEL[activity])}
    </span>
  );
}

function SwitcherKbd({ children }: { children: React.ReactNode }) {
  return <kbd className="shrink-0 rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-3xs text-muted">{children}</kbd>;
}

