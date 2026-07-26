/** Ctrl+P quick project switcher (browser-tab-style fuzzy jump). */

import { CornerDownLeft, FolderGit2, LayoutGrid, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fuzzyFilter } from "@/lib/fuzzy";
import { FuzzyText } from "@/components/CommandPalette";
import { useAppStore } from "@/state/appStore";
import { t } from "@/lib/i18n";
import { useProjectsStore } from "@/state/projectsStore";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useDelayedUnmount } from "@/lib/dismiss";
import { announce } from "@/lib/useAriaLive";

export function ProjectSwitcher() {
  const open = useAppStore((s) => s.switcherOpen);
  const setOpen = useAppStore((s) => s.setSwitcherOpen);
  const { projects, activeId, setActive } = useProjectsStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { mounted, leaving } = useDelayedUnmount(open, 180);

  const filtered = useMemo(
    () => fuzzyFilter(projects, query, (p) => `${p.name} ${p.path}`),
    [projects, query],
  );

  // Focus trap: keep Tab cycling within the switcher while open.
  useFocusTrap(containerRef, open, { initialFocus: inputRef });

  useEffect(() => {
    if (open) {
      setQuery("");
      // Pre-select the next project for fast cycling.
      const idx = projects.findIndex((p) => p.id === activeId);
      setSelected(projects.length > 1 ? (idx + 1) % projects.length : 0);
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

  const pick = (id: string) => {
    setActive(id);
    setOpen(false);
    const p = projects.find((x) => x.id === id);
    if (p) announce(`${t("Switched to")} ${p.name}`);
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
      <div
        className="lx-pop-in lx-glass w-[34rem] max-w-[96vw] overflow-hidden" style={{ borderRadius: "var(--lx-radius-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-edge bg-[radial-gradient(circle_at_top_left,var(--lx-raised),transparent_56%)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t("Switch project")}</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 focus-within:border-transparent">
            <Search size={15} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onEscape();
                if (e.key === "ArrowDown" || (e.key === "p" && e.ctrlKey && !e.shiftKey)) {
                  e.preventDefault();
                  setSelected((s) => (filtered.length ? (s + 1) % filtered.length : 0));
                }
                if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey && e.shiftKey)) {
                  e.preventDefault();
                  setSelected((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0));
                }
                if (e.key === "Enter" && filtered[selected]) {
                  e.preventDefault();
                  pick(filtered[selected].id);
                }
              }}
              placeholder={t("Switch to project…")}
              className="min-w-0 flex-1 bg-transparent py-3 text-strong outline-none placeholder:text-muted/70"
            />
            <span className="rounded-full border border-edge px-2 py-0.5 text-3xs text-muted">
              {filtered.length}/{projects.length}
            </span>
          </div>
        </div>
        <div className="max-h-[min(24rem,58vh)] overflow-auto p-1.5">
          {filtered.map((p, i) => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              onMouseEnter={() => setSelected(i)}
              aria-selected={i === selected}
              role="option"
              className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                i === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                  i === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"
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
              {p.id === activeId && <span className="rounded-full border border-edge px-2 py-0.5 text-3xs uppercase text-muted">{t("active")}</span>}
              {i === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="m-2 rounded-lg border border-dashed border-edge px-4 py-7 text-center text-sm text-muted">
              <Search size={19} className="mx-auto mb-2 text-accent" />
              <div className="font-medium text-strong">{t("No matching projects")}</div>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-5">
                {t("Search by project name or path, or clear the query to see every workspace.")}
              </p>
            </div>
          )}
        </div>
        {/* Keyboard cheat sheet: Ctrl+P cycles forward, so holding the chord
            after opening flips through projects like a browser tab switcher. */}
        <div className="flex min-h-9 items-center justify-end gap-2.5 border-t border-edge bg-surface/60 px-3 py-1.5 text-xs text-muted">
          <span className="flex items-center gap-1"><SwitcherKbd>↑↓ / Ctrl+P</SwitcherKbd> {t("navigate")}</span>
          <span className="flex items-center gap-1"><SwitcherKbd>↵</SwitcherKbd> {t("switch")}</span>
          <span className="flex items-center gap-1"><SwitcherKbd>Esc</SwitcherKbd> {t("close")}</span>
        </div>
      </div>
    </div>
  );
}

function SwitcherKbd({ children }: { children: React.ReactNode }) {
  return <kbd className="shrink-0 rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-3xs text-muted">{children}</kbd>;
}

