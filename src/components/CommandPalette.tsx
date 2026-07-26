import { Command as CommandIcon, CornerDownLeft, FileSearch, Hash, PanelRight, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import * as ipc from "@/lib/ipc";
import { useDelayedUnmount } from "@/lib/dismiss";
import { errorMessage, type SessionSnapshot } from "@/lib/types";
import { fuzzyFilter, fuzzyPositions } from "@/lib/fuzzy";
import { saveAllEditors } from "@/lib/editorBus";
import { applyRecents, loadRecents, recordRecent } from "@/lib/paletteRecents";
import { THEMES } from "@/lib/themes";
import { ZOOM_STEP } from "@/lib/zoom";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";
import { categoryOf, groupByCategory } from "@/lib/paletteCategories";
import { hintFor } from "@/lib/hotkeys";
import { filterFiles, filterPanels, filterSymbols, listProjectFiles, listProjectSymbols, NAV_PANELS, type NavFile, type NavPanel, type NavSymbol } from "@/lib/globalNav";

type PaletteMode = "commands" | "files" | "symbols" | "panels";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

type PaletteItem = Command | NavFile | NavSymbol | NavPanel;

function commandParts(label: string): { section: string; title: string } {
  const idx = label.indexOf(":");
  if (idx <= 0) return { section: t("Command"), title: label };
  return { section: label.slice(0, idx).trim(), title: label.slice(idx + 1).trim() };
}

/**
 * Thin always-mounted shell. The heavy inner component below subscribes to
 * the WHOLE app/dock/projects stores (it needs dozens of actions to build the
 * command list), which used to make the palette re-render on every store
 * update — git polls, stats ticks, toasts — even while closed. The shell
 * subscribes to a single boolean, so the inner tree only exists (and only
 * re-renders) while the palette is actually open or animating out.
 */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const { mounted, leaving } = useDelayedUnmount(open, 180);
  if (!mounted) return null;
  return <CommandPaletteInner open={open} leaving={leaving} />;
}

function CommandPaletteInner({ open, leaving }: { open: boolean; leaving: boolean }) {
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [mode, setMode] = useState<PaletteMode>("commands");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Phase 8: focus trap keeps Tab cycling within the palette while open.
  useFocusTrap(containerRef, open, { initialFocus: inputRef });

  const dock = useDockStore();
  const appStore = useAppStore();
  const projectsStore = useProjectsStore();
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);

  // Global nav data sources (lazy-loaded when switching modes).
  const [navFiles, setNavFiles] = useState<NavFile[]>([]);
  const [navSymbols, setNavSymbols] = useState<NavSymbol[]>([]);
  const [navLoading, setNavLoading] = useState(false);

  useEffect(() => {
    if (open) void ipc.sessionList().then(setSessions).catch(() => setSessions([]));
  }, [open]);

  // Load global nav data when switching to files/symbols mode.
  useEffect(() => {
    if (!open) return;
    if (mode === "files" && navFiles.length === 0) {
      const project = projectsStore.projects.find((p) => p.id === projectsStore.activeId);
      if (project?.path) {
        setNavLoading(true);
        void listProjectFiles(project.path).then((files) => {
          setNavFiles(files);
          setNavLoading(false);
        }).catch(() => setNavLoading(false));
      }
    }
    if (mode === "symbols" && navSymbols.length === 0) {
      const project = projectsStore.projects.find((p) => p.id === projectsStore.activeId);
      if (project?.path && navFiles.length > 0) {
        setNavLoading(true);
        void listProjectSymbols(project.path, navFiles).then((syms) => {
          setNavSymbols(syms);
          setNavLoading(false);
        }).catch(() => setNavLoading(false));
      } else if (project?.path) {
        setNavLoading(true);
        void listProjectFiles(project.path).then((files) => {
          setNavFiles(files);
          void listProjectSymbols(project.path, files).then((syms) => {
            setNavSymbols(syms);
            setNavLoading(false);
          }).catch(() => setNavLoading(false));
        }).catch(() => setNavLoading(false));
      }
    }
  }, [open, mode, projectsStore, navFiles, navSymbols]);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const cmds: Command[] = [
      { id: "terminal.new", label: t("cmd.terminal.new", "Terminal: New terminal"), hint: "Ctrl+`", run: close(() => dock.addTerminal()) },
      { id: "git.open", label: t("cmd.git.open", "Git: Open explorer"), hint: "Ctrl+Shift+G", run: close(() => dock.openPanel("git")) },
      { id: "files.open", label: t("cmd.files.open", "Files: Open file explorer"), hint: "Ctrl+Shift+E", run: close(() => dock.openPanel("files")) },
      { id: "project.add", label: "Project: Add project folder…", run: close(() => void projectsStore.addProject()) },
      { id: "project.addBlank", label: "Project: New blank workspace", run: close(() => void projectsStore.addBlank()) },
      { id: "project.switcher", label: "Project: Quick switcher…", hint: "Ctrl+P", run: close(() => appStore.setSwitcherOpen(true)) },
      { id: "settings.open", label: t("cmd.settings.open", "Settings: Open settings"), hint: "Ctrl+,", run: close(() => appStore.setSettingsOpen(true)) },
      {
        id: "appearance.toggleTheme",
        label: "Appearance: Toggle dark/light theme",
        run: close(() => {
          const config = appStore.config;
          if (!config) return;
          const current =
            config.theme === "system"
              ? window.matchMedia?.("(prefers-color-scheme: light)").matches
                ? "light"
                : "dark"
              : config.theme;
          void appStore.saveConfig({ ...config, theme: current === "dark" ? "light" : "dark" });
        }),
      },
      {
        id: "project.rename",
        label: "Project: Rename active tab…",
        run: close(() => {
          const active = projectsStore.projects.find((p) => p.id === projectsStore.activeId);
          if (!active) return;
          void useUiStore
            .getState()
            .prompt({ title: "Tab name", initial: active.name })
            .then((name) => {
              if (name?.trim() && name.trim() !== active.name) {
                void projectsStore.updateProject({ ...active, name: name.trim() });
              }
            });
        }),
      },
      {
        id: "tab.reopen",
        label: t("cmd.tab.reopen", "Tab: Reopen closed tab"),
        hint: "Ctrl+Shift+T",
        run: close(() => dock.reopenLastClosed()),
      },
      {
        id: "tab.close",
        label: t("cmd.tab.close", "Tab: Close active tab"),
        hint: "Ctrl+W",
        run: close(() => dock.closeActivePanel()),
      },
      { id: "layout.reset", label: "Layout: Reset to default", run: close(() => dock.resetLayout(
        projectsStore.projects.find((p) => p.id === projectsStore.activeId)?.path ?? null,
      )) },
      {
        id: "layout.splitRight",
        label: "Layout: Split right with new terminal",
        run: close(() => dock.splitWithTerminal("right")),
      },
      {
        id: "layout.splitDown",
        label: "Layout: Split down with new terminal",
        run: close(() => dock.splitWithTerminal("below")),
      },
      { id: "launcher.open", label: t("cmd.launcher.open", "Launcher: Open launcher panel"), run: close(() => dock.openPanel("launcher")) },
      { id: "tasks.open", label: t("cmd.tasks.open", "Tasks: Open kanban board"), run: close(() => dock.openPanel("tasks")) },
      { id: "skills.open", label: t("cmd.skills.open", "Skills: Open manager & market"), run: close(() => dock.openPanel("skills")) },
      { id: "activity.open", label: t("cmd.activity.open", "Activity: Open activity log"), run: close(() => dock.openPanel("activity")) },
      { id: "search.open", label: t("cmd.search.open", "Search: Find in project…"), hint: "Ctrl+Shift+F", run: close(() => dock.openPanel("search")) },
      {
        id: "file.saveAll",
        label: t("cmd.file.saveAll", "File: Save all files"),
        hint: "Ctrl+Alt+S",
        run: close(() =>
          void saveAllEditors().then((n) =>
            appStore.toast(
              n > 0 ? `${t("Saved files:")} ${n}` : t("No unsaved changes"),
              n > 0 ? "success" : "info",
            ),
          ),
        ),
      },
      { id: "snippets.open", label: t("cmd.snippets.open", "Snippets: Open snippets, notes & bookmarks"), run: close(() => dock.openPanel("snippets")) },
      { id: "http.open", label: t("cmd.http.open", "HTTP: Open REST client"), run: close(() => dock.openPanel("http")) },
      { id: "docker.open", label: t("cmd.docker.open", "Docker: Open containers & images"), run: close(() => dock.openPanel("docker")) },
      { id: "devtools.open", label: t("cmd.devtools.open", "Dev Tools: Env / logs / disk / deps / processes / crashes"), run: close(() => dock.openPanel("devtools")) },
      { id: "github.open", label: t("cmd.github.open", "GitHub: Issues, pull requests & CI"), run: close(() => dock.openPanel("github")) },
      { id: "zen.toggle", label: t("cmd.zen.toggle", "View: Toggle zen mode (hide bars)"), hint: "Ctrl+Shift+Z", run: close(() => appStore.toggleZen()) },
      {
        id: "update.check",
        label: t("cmd.update.check", "Updates: Check for a new version"),
        run: close(() => {
          const repo = appStore.config?.ui.update_repo ?? "";
          void ipc
            .updateCheck(repo)
            .then((info) =>
              appStore.toast(
                info.update_available
                  ? `${t("update.available", "Luxor update available")}: ${info.latest}`
                  : t("settings.updates.latest", "You are on the latest version"),
                info.update_available ? "info" : "success",
              ),
            )
            .catch((e) => appStore.toast(errorMessage(e), "error"));
        }),
      },
      {
        id: "session.save",
        label: t("cmd.session.save", "Session: Save layout snapshot…"),
        run: close(() => {
          void useUiStore
            .getState()
            .prompt({ title: "Snapshot name", placeholder: "e.g. review setup" })
            .then((name) => {
              if (!name) return;
              const layout = dock.serialize();
              void ipc
                .sessionSave(projectsStore.activeId ?? null, name, JSON.stringify(layout ?? {}))
                .then(() => appStore.toast(`Session "${name}" saved`, "success"));
            });
        }),
      },
      {
        id: "files.openFile",
        label: "Files: Open file in viewer/editor…",
        run: close(() => {
          void ipc.pickFile().then((path) => path && dock.openFile(path));
        }),
      },
      {
        id: "db.open",
        label: "Database: Open SQLite database…",
        run: close(() => {
          void ipc.pickFile().then((path) => path && dock.openFile(path));
        }),
      },
      {
        id: "zoom.in",
        label: "View: Zoom in",
        hint: "Ctrl+= / Ctrl+wheel",
        run: () => appStore.setZoom((appStore.config?.ui.zoom ?? 1) + ZOOM_STEP),
      },
      {
        id: "zoom.out",
        label: "View: Zoom out",
        hint: "Ctrl+-",
        run: () => appStore.setZoom((appStore.config?.ui.zoom ?? 1) - ZOOM_STEP),
      },
      { id: "zoom.reset", label: "View: Reset zoom (100%)", hint: "Ctrl+0", run: () => appStore.setZoom(1) },
      {
        id: "sidebar.customize",
        label: "Sidebar: Customize nav buttons…",
        run: close(() => appStore.setSettingsOpen(true, "interface")),
      },
      {
        id: "statusbar.customize",
        label: "Status bar: Customize segments…",
        run: close(() => appStore.setSettingsOpen(true, "statusbar")),
      },
      {
        id: "layout.save",
        label: "Layout: Save as preset…",
        run: close(() => {
          void useUiStore
            .getState()
            .prompt({ title: "Preset name" })
            .then((name) => {
              if (name?.trim()) void dock.savePreset(name.trim());
            });
        }),
      },
    ];
    for (const theme of THEMES) {
      cmds.push({
        id: `appearance.theme.${theme.id}`,
        label: `Appearance: Theme — ${theme.label}`,
        run: close(() => {
          const config = appStore.config;
          if (config) void appStore.saveConfig({ ...config, theme: theme.id });
        }),
      });
    }
    for (const preset of dock.presets) {
      cmds.push({
        id: `layout.apply.${preset.id}`,
        label: `${t("cmd.preset.apply", "Layout: Apply preset")} "${preset.name}"`,
        run: close(() => dock.applyPreset(preset)),
      });
    }
    for (const session of sessions) {
      cmds.push({
        id: `session.restore.${session.id}`,
        label: `${t("cmd.session.restore", "Session: Restore")} "${session.name}"`,
        run: close(() => {
          try {
            const layout = JSON.parse(session.data) as import("dockview").SerializedDockview;
            const api = dock.apis[dock.activeKey];
            if (api && layout && Object.keys(layout).length > 0) api.fromJSON(layout);
            appStore.toast(`Session "${session.name}" restored`, "success");
          } catch {
            appStore.toast("Could not restore session layout", "error");
          }
        }),
      });
      cmds.push({
        id: `session.delete.${session.id}`,
        label: `${t("cmd.session.delete", "Session: Delete")} "${session.name}"`,
        run: close(() => {
          void ipc.sessionDelete(session.id).then(() => appStore.toast("Snapshot deleted", "success"));
        }),
      });
    }
    for (const project of projectsStore.projects) {
      cmds.push({
        id: `project.switch.${project.id}`,
        label: `${t("cmd.project.switch", "Project: Switch to")} ${project.name}`,
        run: close(() => projectsStore.setActive(project.id)),
      });
    }
    // P2SH-02: derive hints for remappable actions from the live key map so the
    // palette always reflects the user's current (possibly overridden) bindings
    // and renders them OS-aware (⌘ on macOS). The literal hints above act as a
    // fallback for commands with no corresponding remappable action.
    const cmdToAction: Record<string, string> = {
      "terminal.new": "terminal.new",
      "git.open": "git.open",
      "files.open": "files.open",
      "project.switcher": "projects.switch",
      "settings.open": "settings.open",
      "tab.reopen": "tab.reopen",
      "tab.close": "tab.close",
      "search.open": "search.open",
      "file.saveAll": "file.saveAll",
      "zen.toggle": "zen.toggle",
    };
    for (const cmd of cmds) {
      const actionId = cmdToAction[cmd.id];
      if (actionId) {
        const hint = hintFor(actionId, appStore.config);
        if (hint) cmd.hint = hint;
      }
    }
    return cmds;
  }, [dock, projectsStore, appStore, setOpen, sessions]);

  // Empty query: recently used commands first. Otherwise: fuzzy match + rank.
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return applyRecents(commands, recents);
    return fuzzyFilter(commands, query, (c) => c.label);
  }, [commands, query, recents]);

  const filteredFiles = useMemo(() => filterFiles(navFiles, query), [navFiles, query]);
  const filteredSymbols = useMemo(() => filterSymbols(navSymbols, query), [navSymbols, query]);
  const filteredPanels = useMemo(() => filterPanels(NAV_PANELS, query), [query]);

  // The active filtered list depends on the mode.
  const filtered = useMemo<PaletteItem[]>(() => {
    if (mode === "files") return filteredFiles;
    if (mode === "symbols") return filteredSymbols;
    if (mode === "panels") return filteredPanels;
    return filteredCommands;
  }, [mode, filteredCommands, filteredFiles, filteredSymbols, filteredPanels]);

  const totalCount = mode === "files" ? navFiles.length : mode === "symbols" ? navSymbols.length : mode === "panels" ? NAV_PANELS.length : commands.length;

  const recentCount = mode === "commands" && !query.trim() ? recents.filter((id) => commands.some((c) => c.id === id)).length : 0;

  // Grouped commands for display (commands mode only, empty query).
  const groupedCommands = useMemo(() => {
    if (mode !== "commands" || query.trim()) return null;
    return groupByCategory(filteredCommands, recents);
  }, [mode, query, filteredCommands, recents]);

  const runCommand = (cmd: Command) => {
    setRecents(recordRecent(cmd.id));
    cmd.run();
  };

  /** Execute a palette item (command, file, symbol, or panel). */
  const runItem = (item: PaletteItem) => {
    if ("run" in item && typeof (item as Command).run === "function") {
      runCommand(item as Command);
      return;
    }
    // NavFile: open in editor.
    if ("path" in item && "name" in item && !("kind" in item)) {
      const project = projectsStore.projects.find((p) => p.id === projectsStore.activeId);
      const fullPath = project?.path ? `${project.path}/${(item as NavFile).path}` : (item as NavFile).path;
      setOpen(false);
      dock.openFile(fullPath);
      return;
    }
    // NavSymbol: open the file at the symbol's line.
    if ("kind" in item && "file" in item && "line" in item) {
      const sym = item as NavSymbol;
      const project = projectsStore.projects.find((p) => p.id === projectsStore.activeId);
      const fullPath = project?.path ? `${project.path}/${sym.file}` : sym.file;
      setOpen(false);
      dock.openFile(fullPath);
      return;
    }
    // NavPanel: open the panel.
    if ("kind" in item && "label" in item && "id" in item && !("line" in item)) {
      const panel = item as NavPanel;
      setOpen(false);
      if (panel.kind === "terminal") dock.addTerminal();
      // `panel.kind` is a broad string here; the "terminal" case is handled
      // above, so the remaining values are valid PanelKinds at runtime.
      else dock.openPanel(panel.kind as Parameters<typeof dock.openPanel>[0]);
      return;
    }
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setMode("commands");
      setRecents(loadRecents());
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query, mode]);

  // Two-step Escape (matches SettingsModal): first press clears an active
  // query so the user lands back on the full list; second press closes.
  const onEscape = () => {
    if (inputRef.current?.value) {
      setQuery("");
      inputRef.current.focus();
      return;
    }
    setOpen(false);
  };

  // Window-level Escape so the palette responds even when the input loses focus.
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

  const selectedCommand = mode === "commands" ? (filtered[selected] as Command | undefined) ?? null : null;

  return (
    <div
      ref={containerRef}
      className={`lx-command-palette fixed inset-0 z-[var(--lx-z-overlay)] flex items-start justify-center bg-black/60 px-3 pt-[12vh] ${leaving ? "lx-palette-leaving" : ""}`} style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("Command palette")}
      onClick={() => setOpen(false)}
    >
      {/* Bounded by the viewport and laid out as a column: on a short window the
          palette used to run past the bottom edge, cutting off the last results
          and the shortcut footer entirely. The result list (flex-1, min-h-0)
          absorbs the difference instead. */}
      <div
        className="lx-glass flex max-h-[calc(100vh-16vh)] w-[44rem] max-w-[96vw] flex-col overflow-hidden"
        style={{ borderRadius: "var(--lx-radius-xl)" }}
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-edge bg-[radial-gradient(circle_at_top_left,var(--lx-raised),transparent_52%)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
                <CommandIcon size={13} />
              </span>
              {t("Command palette")}
            </div>
            {/* Mode tabs */}
            <div className="flex items-center gap-1">
              {([
                { id: "commands" as const, label: t("Commands"), icon: CommandIcon },
                { id: "files" as const, label: t("Files"), icon: FileSearch },
                { id: "symbols" as const, label: t("Symbols"), icon: Hash },
                { id: "panels" as const, label: t("Panels"), icon: PanelRight },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setMode(m.id); setSelected(0); }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-3xs font-medium transition-colors ${
                    mode === m.id ? "bg-raised text-strong" : "text-muted hover:bg-raised/70 hover:text-strong"
                  }`}
                >
                  <m.icon size={11} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 focus-within:border-transparent">
            <Search size={16} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onEscape();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelected((sv) => (filtered.length === 0 ? 0 : (sv + 1) % filtered.length));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelected((sv) => (filtered.length === 0 ? 0 : (sv - 1 + filtered.length) % filtered.length));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const item = filtered[selected];
                  if (item) runItem(item);
                }
                // Mode switching: Ctrl+P for files, Ctrl+G for symbols, Ctrl+Shift+P
                // back to commands (E-wave: give the default mode its own shortcut).
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
                  e.preventDefault();
                  setMode("commands");
                } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "p") {
                  e.preventDefault();
                  setMode("files");
                }
                if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "g") {
                  e.preventDefault();
                  setMode("symbols");
                }
              }}
              data-testid="palette-input"
              placeholder={t("Type a command, panel, theme, project…")}
              className="min-w-0 flex-1 bg-transparent py-3 text-strong outline-none placeholder:text-muted/70"
            />
            <span className="rounded-full border border-edge px-2 py-0.5 text-3xs text-muted">
              {filtered.length}/{totalCount}
            </span>
          </div>
        </div>

        <div role="listbox" aria-label={t("Results")} className="min-h-0 flex-1 overflow-auto p-1.5 [max-height:min(28rem,62vh)]">
          {navLoading && (
            <div className="m-2 rounded-lg border border-dashed border-edge px-4 py-8 text-center text-sm text-muted">
              <Sparkles size={20} className="mx-auto mb-2 text-muted" />
              <div className="font-medium text-strong">{t("Loading…")}</div>
            </div>
          )}
          {!navLoading && mode === "commands" && groupedCommands && groupedCommands.map((group) => (
            <div key={group.category.id}>
              <div className="px-3 pb-0.5 pt-2 text-3xs font-semibold uppercase tracking-wide text-muted">
                {t(group.category.label)}
              </div>
              {group.items.map((c) => {
                const idx = filtered.indexOf(c);
                if (idx < 0) return null;
                const parts = commandParts(c.label);
                const RowIcon = categoryOf(c.label).icon;
                return (
                  <button
                    key={c.id}
                    onClick={() => runItem(c)}
                    onMouseEnter={() => setSelected(idx)}
                    role="option"
                    aria-selected={idx === selected}
                    className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                      idx === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${idx === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"}`}>
                      <RowIcon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-strong">{parts.title || c.label}</span>
                      <span className="block truncate text-2xs uppercase tracking-wide text-muted">{parts.section}</span>
                    </span>
                    {c.hint && <Kbd>{c.hint}</Kbd>}
                    {idx === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
                  </button>
                );
              })}
            </div>
          ))}
          {!navLoading && mode === "commands" && !groupedCommands && filtered.map((item, i) => {
            const c = item as Command;
            const parts = commandParts(c.label);
            const RowIcon = categoryOf(c.label).icon;
            return (
              <div key={c.id}>
                {recentCount > 0 && i === 0 && (
                  <div className="px-3 pb-0.5 pt-1 text-3xs font-semibold uppercase tracking-wide text-muted">
                    {t("Recently used")}
                  </div>
                )}
                {recentCount > 0 && i === recentCount && (
                  <div className="px-3 pb-0.5 pt-2 text-3xs font-semibold uppercase tracking-wide text-muted">
                    {t("All commands")}
                  </div>
                )}
                <button
                  onClick={() => runItem(c)}
                  onMouseEnter={() => setSelected(i)}
                  role="option"
                  aria-selected={i === selected}
                  className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                    i === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${i === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"}`}>
                    <RowIcon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-strong">
                      <FuzzyText text={parts.title || c.label} query={query} />
                    </span>
                    <span className="block truncate text-2xs uppercase tracking-wide text-muted">{parts.section}</span>
                  </span>
                  {c.hint && <Kbd>{c.hint}</Kbd>}
                  {i === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
                </button>
              </div>
            );
          })}
          {!navLoading && mode === "files" && filtered.map((item, i) => {
            const f = item as NavFile;
            return (
              <button
                key={f.path}
                onClick={() => runItem(f)}
                onMouseEnter={() => setSelected(i)}
                role="option"
                aria-selected={i === selected}
                className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                  i === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${i === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"}`}>
                  <FileSearch size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-strong">
                    <FuzzyText text={f.name} query={query} />
                  </span>
                  <span className="block truncate text-2xs text-muted">{f.dir}</span>
                </span>
                {i === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
              </button>
            );
          })}
          {!navLoading && mode === "symbols" && filtered.map((item, i) => {
            const s = item as NavSymbol;
            return (
              <button
                key={`${s.file}:${s.line}:${s.name}`}
                onClick={() => runItem(s)}
                onMouseEnter={() => setSelected(i)}
                role="option"
                aria-selected={i === selected}
                className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                  i === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${i === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"}`}>
                  <Hash size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-strong">
                    <FuzzyText text={s.name} query={query} />
                  </span>
                  <span className="block truncate text-2xs text-muted">{s.kind} · {s.file}:{s.line}</span>
                </span>
                {i === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
              </button>
            );
          })}
          {!navLoading && mode === "panels" && filtered.map((item, i) => {
            const p = item as NavPanel;
            return (
              <button
                key={p.id}
                onClick={() => runItem(p)}
                onMouseEnter={() => setSelected(i)}
                role="option"
                aria-selected={i === selected}
                className={`group flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
                  i === selected ? "bg-accent/10 text-strong lx-active-strip" : "text-muted hover:bg-raised/70 hover:text-strong"
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${i === selected ? "border-muted bg-raised text-strong" : "border-edge bg-surface text-muted"}`}>
                  <PanelRight size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-strong">
                    <FuzzyText text={p.label} query={query} />
                  </span>
                </span>
                {i === selected && <CornerDownLeft size={14} className="hidden shrink-0 text-muted sm:block" />}
              </button>
            );
          })}
          {!navLoading && filtered.length === 0 && (
            <div className="m-2 rounded-lg border border-dashed border-edge px-4 py-8 text-center text-sm text-muted">
              <Sparkles size={20} className="mx-auto mb-2 text-accent" />
              <div className="font-medium text-strong">{t("No matching commands")}</div>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5">
                {t("Try a panel name, a project name, Git, theme, layout, session, or a shorter query.")}
              </p>
            </div>
          )}
        </div>

        <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-t border-edge bg-surface/60 px-3 py-2 text-xs text-muted">
          <span className="min-w-0 truncate">
            {selectedCommand ? `${commandParts(selectedCommand.label).section} · ${commandParts(selectedCommand.label).title}` : t("Ready")}
          </span>
          {/* Keyboard cheat sheet: surfaces the otherwise-invisible mode
              shortcuts (Ctrl+P files / Ctrl+G symbols) and list navigation. */}
          <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
            <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> {t("navigate")}</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> {t("run")}</span>
            <span className="flex items-center gap-1"><Kbd>Ctrl+P</Kbd> {t("Files")}</span>
            <span className="flex items-center gap-1"><Kbd>Ctrl+G</Kbd> {t("Symbols")}</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd> {t("close")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="shrink-0 rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-3xs text-muted">{children}</kbd>;
}

/**
 * Render `text` with the characters matched by the fuzzy `query` tinted in the
 * accent color, so users see WHY a result matched. Falls back to plain text
 * when the query is empty or does not match this particular string (e.g. the
 * match came from another part of the label).
 */
export function FuzzyText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const positions = fuzzyPositions(query, text);
  if (positions.length === 0) return <>{text}</>;
  const hits = new Set(positions);
  // Group consecutive characters into runs to keep the DOM small.
  const parts: { str: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.str += text[i];
    else parts.push({ str: text[i], hit });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <span key={i} className="text-accent">
            {p.str}
          </span>
        ) : (
          p.str
        ),
      )}
    </>
  );
}
