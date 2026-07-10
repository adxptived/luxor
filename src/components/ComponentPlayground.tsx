/**
 * Component playground / storybook for Luxor UI components.
 *
 * This is a lightweight, dependency-free playground that renders key UI
 * components in isolation for visual testing and development. It's accessible
 * via the `?playground` query parameter in dev mode.
 *
 * Phase 16 — Documentation and developer experience.
 */

import { useState } from "react";
import { Bot, FolderGit2, Search, Settings, SquareTerminal, X } from "lucide-react";

import { useAppStore } from "@/state/appStore";

interface PlaygroundSection {
  id: string;
  label: string;
  render: () => React.ReactNode;
}

export function ComponentPlayground() {
  const [active, setActive] = useState("buttons");
  const toast = useAppStore((s) => s.toast);

  const sections: PlaygroundSection[] = [
    {
      id: "buttons",
      label: "Buttons",
      render: () => (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-strong">Button variants</h3>
          <div className="flex flex-wrap gap-2">
            <button className="lx-btn-primary">
              Primary
            </button>
            <button className="lx-btn-ghost">
              Ghost
            </button>
            <button className="lx-btn-danger">
              Danger
            </button>
            <button className="lx-btn-primary" disabled>
              Disabled
            </button>
          </div>
          <h3 className="text-sm font-semibold text-strong">Button with icons</h3>
          <div className="flex flex-wrap gap-2">
            <button className="lx-btn-primary">
              <SquareTerminal size={15} /> New Terminal
            </button>
            <button className="lx-btn-ghost">
              <FolderGit2 size={15} /> Open Folder
            </button>
            <button className="lx-btn-danger">
              <X size={15} /> Delete
            </button>
          </div>
          <h3 className="text-sm font-semibold text-strong">Icon buttons</h3>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg border border-edge bg-raised p-2 text-muted hover:text-strong" aria-label="Terminal">
              <SquareTerminal size={16} />
            </button>
            <button className="rounded-lg border border-edge bg-raised p-2 text-muted hover:text-strong" aria-label="Git">
              <FolderGit2 size={16} />
            </button>
            <button className="rounded-lg border border-edge bg-raised p-2 text-muted hover:text-strong" aria-label="Search">
              <Search size={16} />
            </button>
            <button className="rounded-lg border border-edge bg-raised p-2 text-muted hover:text-strong" aria-label="AI">
              <Bot size={16} />
            </button>
            <button className="rounded-lg border border-edge bg-raised p-2 text-muted hover:text-strong" aria-label="Settings">
              <Settings size={16} />
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "toasts",
      label: "Toasts",
      render: () => (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-strong">Toast notifications</h3>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-strong hover:bg-accent/10"
              onClick={() => toast("Info toast message", "info")}
            >
              Info toast
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-strong hover:bg-success-soft"
              onClick={() => toast("Operation completed successfully", "success")}
            >
              Success toast
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-strong hover:bg-warning-soft"
              onClick={() => toast("This is a warning", "warning")}
            >
              Warning toast
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-strong hover:bg-danger-soft"
              onClick={() => toast("Something went wrong", "error")}
            >
              Error toast
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "cards",
      label: "Cards",
      render: () => (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-strong">Card variants</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="lx-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <FolderGit2 size={16} className="text-accent" />
                <span className="text-sm font-medium text-strong">Project card</span>
              </div>
              <p className="text-xs text-muted">A card representing a project with icon and description.</p>
            </div>
            <div className="lx-card p-4" style={{ borderColor: "color-mix(in srgb, var(--lx-accent) 30%, transparent)", background: "var(--lx-accent-soft)" }}>
              <div className="mb-2 flex items-center gap-2">
                <Bot size={16} className="text-accent" />
                <span className="text-sm font-medium text-strong">Accent card</span>
              </div>
              <p className="text-xs text-muted">A card with accent border for highlighting.</p>
            </div>
            <div className="lx-card p-4" style={{ borderStyle: "dashed" }}>
              <div className="mb-2 flex items-center gap-2">
                <Search size={16} className="text-muted" />
                <span className="text-sm font-medium text-muted">Empty state card</span>
              </div>
              <p className="text-xs text-muted">Dashed border for empty/placeholder states.</p>
            </div>
            <div className="lx-card p-4" style={{ borderColor: "color-mix(in srgb, var(--lx-danger) 30%, transparent)", background: "color-mix(in srgb, var(--lx-danger) 5%, transparent)" }}>
              <div className="mb-2 flex items-center gap-2">
                <X size={16} style={{ color: "var(--lx-danger)" }} />
                <span className="text-sm font-medium text-strong">Error card</span>
              </div>
              <p className="text-xs text-muted">Error state with danger accent.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "inputs",
      label: "Inputs",
      render: () => (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-strong">Input fields</h3>
          <div className="flex flex-col gap-3">
            <input
              className="lx-input"
              placeholder="Text input"
              aria-label="Text input"
            />
            <input
              className="lx-input"
              placeholder="Search…"
              aria-label="Search input"
              type="search"
            />
            <textarea
              className="lx-input"
              placeholder="Textarea"
              aria-label="Textarea"
              rows={3}
            />
            <select
              className="lx-input"
              aria-label="Select"
            >
              <option>Option 1</option>
              <option>Option 2</option>
              <option>Option 3</option>
            </select>
          </div>
        </div>
      ),
    },
    {
      id: "badges",
      label: "Badges & Pills",
      render: () => (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-strong">Badges and pills</h3>
          <div className="flex flex-wrap gap-2">
            <span className="lx-badge lx-badge-accent">Active</span>
            <span className="lx-badge" style={{ background: "color-mix(in srgb, var(--lx-muted) 12%, transparent)", color: "var(--lx-muted)" }}>Inactive</span>
            <span className="lx-badge lx-badge-success">Running</span>
            <span className="lx-badge lx-badge-danger">Error</span>
            <span className="lx-badge lx-badge-warning">Warning</span>
            <span className="lx-badge lx-badge-info">Info</span>
          </div>
          <h3 className="text-sm font-semibold text-strong">Status dots</h3>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2 text-xs text-muted"><span className="lx-status-dot lx-status-dot-success" /> Success</span>
            <span className="flex items-center gap-2 text-xs text-muted"><span className="lx-status-dot lx-status-dot-warning" /> Warning</span>
            <span className="flex items-center gap-2 text-xs text-muted"><span className="lx-status-dot lx-status-dot-danger" /> Error</span>
            <span className="flex items-center gap-2 text-xs text-muted"><span className="lx-status-dot lx-status-dot-info" /> Info</span>
          </div>
          <h3 className="text-sm font-semibold text-strong">Keyboard shortcuts</h3>
          <div className="flex flex-wrap items-center gap-2">
            <kbd className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">Ctrl</kbd>
            <span className="text-xs text-muted">+</span>
            <kbd className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">Shift</kbd>
            <span className="text-xs text-muted">+</span>
            <kbd className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">P</kbd>
            <span className="text-xs text-muted">Command palette</span>
          </div>
        </div>
      ),
    },
  ];

  const current = sections.find((s) => s.id === active);

  return (
    <div className="flex h-screen w-screen flex-col bg-surface text-strong">
      <div className="flex items-center justify-between border-b border-edge bg-bar px-4 py-3">
        <h1 className="text-base font-semibold">Luxor Component Playground</h1>
        <a href="/" className="text-xs text-muted hover:text-strong">← Back to app</a>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r border-edge bg-bar p-2" aria-label="Playground sections">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active === s.id ? "bg-raised text-strong" : "text-muted hover:bg-raised hover:text-strong"
              }`}
              aria-current={active === s.id}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          {current?.render()}
        </div>
      </div>
    </div>
  );
}