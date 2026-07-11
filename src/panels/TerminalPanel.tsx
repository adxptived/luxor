import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { IDockviewPanelProps } from "dockview";
import { useEffect, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";

import * as ipc from "@/lib/ipc";
import { attachPty, ensurePtyBus, forgetPty } from "@/lib/ptyBus";
import { appendHistory, emptyLine, feedInput, loadHistory } from "@/lib/cmdHistory";
import { logActivity } from "@/lib/activityLog";
import { gateAutorun } from "@/lib/autorunGuard";
import { captureBuffer, suggestOutputFilename } from "@/lib/terminalBuffer";
import { shellQuote } from "@/lib/shellQuote";
import { CommandTracker, type TrackerNotice } from "@/lib/commandTracker";
import { matchPathLinks, resolveMatchedPath } from "@/lib/terminalLinks";
import { t } from "@/lib/i18n";
import { notifyDone, osNotifyIfAway } from "@/lib/notify";
import { schedulePoll } from "@/lib/poll";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { openContextMenu } from "@/state/uiStore";
import { useProjectsStore } from "@/state/projectsStore";
import type { TerminalPanelParams } from "@/layout/dockStore";
import { useDockStore } from "@/layout/dockStore";
import { ClipboardCopy, ClipboardPaste, Eraser, FileDown, History, MousePointerSquareDashed, OctagonX, RotateCcw, Search, SplitSquareHorizontal, X } from "lucide-react";
import { loadProfiles } from "@/lib/shellProfiles";

/** "1h 4m" / "2m 5s" / "42s" for notification bodies. */
function formatDuration(secs: number): string {
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  return `${Math.max(1, Math.floor(secs))}s`;
}

/** Build the xterm theme from the live CSS variables of the active app theme. */
function xtermTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--lx-surface", "#101014"),
    foreground: v("--lx-strong", "#d6d6dd"),
    cursor: v("--lx-strong", "#d6d6dd"),
    selectionBackground: `${v("--lx-accent", "#e8b059")}55`,
  };
}

export function TerminalPanel(props: IDockviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const params = (props.params ?? {}) as TerminalPanelParams;
  const [exited, setExited] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [sessionRestored, setSessionRestored] = useState(false);
  const searchRef = useRef<SearchAddon | null>(null);
  const restartRef = useRef<(() => void) | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const openHistoryRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [treeStats, setTreeStats] = useState<import("@/lib/types").TreeStats | null>(null);
  const showStats = useAppStore((s) => s.config?.terminal.show_stats ?? true);
  const notifyEnabled = useAppStore((s) => s.config?.notifications.enabled ?? true);
  const trackerRef = useRef<CommandTracker | null>(null);
  const splitWithTerminal = useDockStore((s) => s.splitWithTerminal);

  /** Route a tracker notice to toast/OS notifications (config-gated). */
  const handleNotice = (notice: TrackerNotice) => {
    const cfg = useAppStore.getState().config?.notifications;
    if (!cfg?.enabled) return;
    // The user is staring at this very terminal — nothing to announce.
    if (props.api.isActive && document.hasFocus() && !document.hidden) return;
    if (notice.kind === "command_done") {
      if (!cfg.command_done) return;
      const secs = Math.round(notice.durationSecs ?? 0);
      if (secs < cfg.min_command_secs) return;
      const code = notice.exitCode;
      const status =
        code === null || code === undefined
          ? ""
          : code === 0
            ? ` · ${t("term.notify.ok", "success")}`
            : ` · ${t("term.notify.exit_code", "exit code")} ${code}`;
      notifyDone(
        t("term.notify.command_done", "Command finished"),
        `${formatDuration(secs)}${status}`,
      );
    } else if (notice.kind === "agent_done") {
      if (!cfg.agent_done) return;
      const who = (notice.agents ?? []).join(", ") || t("term.notify.agent", "AI agent");
      notifyDone(`${who}`, t("term.notify.agent_done", "finished responding — your turn"));
    }
  };
  // Stable ref so the long-lived terminal effect always calls the latest closure.
  const handleNoticeRef = useRef(handleNotice);
  handleNoticeRef.current = handleNotice;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const cfg = useAppStore.getState().config?.terminal;
    const term = new Terminal({
      fontFamily: cfg?.font_family ?? "Cascadia Mono, JetBrains Mono, Consolas, monospace",
      fontSize: cfg?.font_size ?? 14,
      scrollback: cfg?.scrollback ?? 10000,
      cursorStyle: cfg?.cursor_style === "underline" ? "underline" : cfg?.cursor_style === "bar" ? "bar" : "block",
      cursorBlink: cfg?.cursor_blink ?? true,
      allowProposedApi: true,
      theme: xtermTheme(),
    });
    termRef.current = term;
    const fit = new FitAddon();
    const search = new SearchAddon();
    searchRef.current = search;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((e, uri) => {
        e.preventDefault();
        if (ipc.isTauri) {
          void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(uri));
        } else {
          window.open(uri, "_blank", "noopener");
        }
      }),
    );
    // Clickable file paths: compiler/test output like `src/main.rs:12:34`
    // opens the file in the editor at the right line (Ctrl+Click, matching
    // the URL addon's modifier so plain clicks still position the cursor).
    const fileLinkProvider = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const bufLine = term.buffer.active.getLine(bufferLineNumber - 1);
        const text = bufLine?.translateToString(true) ?? "";
        const matches = matchPathLinks(text);
        if (matches.length === 0) return callback(undefined);
        callback(
          matches.map((match) => ({
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: match.end, y: bufferLineNumber },
            },
            text: text.slice(match.start, match.end),
            activate(event: MouseEvent) {
              if (!event.ctrlKey && !event.metaKey) return;
              const projectPath = useProjectsStore.getState().projects.find(
                (p) => p.id === useProjectsStore.getState().activeId,
              )?.path;
              const full = resolveMatchedPath(match.path, params.cwd ?? projectPath ?? null);
              useDockStore.getState().openFile(full, match.line !== undefined ? { line: match.line } : undefined);
            },
          })),
        );
      },
    });

    if (cfg?.copy_on_select) {
      term.onSelectionChange(() => {
        const text = term.getSelection();
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
      });
    }

    // Ctrl+F opens the in-terminal search bar; Escape is handled by the bar itself.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      // Ctrl+Shift+R: command history overlay (plain Ctrl+R stays with the shell).
      if (e.type === "keydown" && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
        openHistoryRef.current?.();
        return false;
      }
      return true;
    });

    let sessionId: string | null = null;
    let disposed = false;
    let opened = false;
    const pendingWrites: Array<{ data: string | Uint8Array; size: number }> = [];
    let pendingWriteBytes = 0;
    const unlisteners: Array<() => void> = [];

    // PTY output can arrive before a hidden dock panel has enough layout to
    // open xterm. Writing before term.open() makes xterm schedule viewport work
    // without a renderer and crashes while reading renderer dimensions.
    const writeTerminal = (data: string | Uint8Array) => {
      if (disposed) return;
      if (!opened) {
        // A noisy process in a permanently hidden panel must not grow memory
        // without bound. Retain the newest ~2 MiB, matching terminal semantics
        // where recent output is more useful than the oldest unseen output.
        const MAX_PENDING_BYTES = 2 * 1024 * 1024;
        const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
        pendingWrites.push({ data, size });
        pendingWriteBytes += size;
        while (pendingWriteBytes > MAX_PENDING_BYTES && pendingWrites.length > 1) {
          pendingWriteBytes -= pendingWrites.shift()?.size ?? 0;
        }
        return;
      }
      term.write(data);
    };

    // xterm's renderer initializes asynchronously; calling fit() before
    // open() or while the container has no size makes Viewport.syncScrollArea
    // crash with "Cannot read properties of undefined (reading 'dimensions')".
    const safeFit = () => {
      if (disposed || !opened || !el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        /* renderer not ready yet — the next resize/visibility event retries */
      }
    };

    // Opening xterm inside a hidden or 0×0 dockview panel starts its internal
    // viewport RAF loop before the renderer can initialize, which crashes in
    // Viewport.syncScrollArea. Only open once the container actually has
    // layout; the ResizeObserver below retries when the panel becomes visible.
    const openTerminal = (): boolean => {
      if (opened || disposed) return opened;
      if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return false;
      opened = true;
      term.open(el);
      // Flush output captured while this dock panel was hidden. Do this only
      // after open() has synchronously created xterm's renderer services.
      for (const write of pendingWrites.splice(0)) term.write(write.data);
      pendingWriteBytes = 0;

      if (cfg?.webgl !== false) {
        // WebGL renderer is much faster; fall back silently when unavailable.
        import("@xterm/addon-webgl")
          .then(({ WebglAddon }) => {
            if (disposed) return;
            try {
              const webgl = new WebglAddon();
              // Browsers cap the number of live WebGL contexts; with many
              // terminals across projects a context can get evicted, which used
              // to glitch the window when switching tabs quickly. Dropping the
              // addon falls back to the DOM renderer for that terminal.
              webgl.onContextLoss(() => {
                try {
                  webgl.dispose();
                } catch {
                  /* already disposed */
                }
                // The DOM renderer takes over with stale dimensions — re-measure
                // on the next frame instead of crashing the scroll viewport.
                requestAnimationFrame(safeFit);
              });
              term.loadAddon(webgl);
            } catch {
              /* canvas fallback */
            }
          })
          .catch(() => {});
      }
      requestAnimationFrame(safeFit);
      if (props.api.isActive) term.focus();
      return true;
    };
    // Try on the next frame — dockview usually finishes layout by then. If the
    // panel is created hidden, the ResizeObserver opens it when it gets size.
    requestAnimationFrame(() => void openTerminal());

    const start = async () => {
      try {
        // The global pty bus must listen BEFORE the shell starts: the banner
        // and first prompt are emitted immediately and are never re-printed.
        await ensurePtyBus();
        const projectPath = useProjectsStore.getState().projects.find(
          (p) => p.id === useProjectsStore.getState().activeId,
        )?.path;
        const cwd = params.cwd ?? (projectPath ? projectPath : null);
        // Phase 19: Shell profiles — use the profile's shell/args if specified.
        const profiles = loadProfiles();
        const profile = params.profileId ? profiles.find((p) => p.id === params.profileId) : undefined;
        const terminalConfig = useAppStore.getState().config?.terminal;
        const info = await ipc.ptySpawn({
          shell: profile?.shell ?? terminalConfig?.shell ?? null,
          args: profile?.args ?? terminalConfig?.shell_args ?? [],
          cwd: profile?.cwd || cwd,
          cols: term.cols,
          rows: term.rows,
          // Audit fix 2.3: autorun from restored layouts/presets must be
          // confirmed by the user; only terminals spawned by a direct user
          // action this session run their commands silently.
          autorun: gateAutorun(props.api.id, params.autorun ?? []),
          fast_powershell_startup: terminalConfig?.fast_powershell_startup ?? true,
        });
        if (disposed) {
          forgetPty(info.session_id);
          void ipc.ptyKill(info.session_id).catch(() => {});
          return;
        }
        sessionId = info.session_id;
        sessionRef.current = sessionId;
        setPid(info.pid ?? null);
        setExited(null);

        // Check if this is a restored session (pty bus had buffered output)
        setSessionRestored(true);
        setTimeout(() => setSessionRestored(false), 2200);

        const id = info.session_id;
        unlisteners.push(
          attachPty(id, {
            onOutput: (dataB64) => {
              trackerRef.current?.output(Date.now());
              writeTerminal(ipc.b64ToBytes(dataB64));
            },
            onExit: (exitCode) => {
              writeTerminal(`\r\n\x1b[90m[process exited ${exitCode ?? ""}]\x1b[0m\r\n`);
              if (sessionId === id) {
                sessionId = null;
                sessionRef.current = null;
              }
              logActivity("terminal", `Shell exited (code ${exitCode ?? 0})`);
              if (!disposed) {
                setPid(null);
                setExited(exitCode ?? 0);
              }
            },
          }),
        );
      } catch (e) {
        writeTerminal(`\r\n\x1b[31mfailed to start shell: ${errorMessage(e)}\x1b[0m\r\n`);
        if (!disposed) setExited(-1);
      }
    };

    restartRef.current = () => {
      // Drop listeners from the previous session before spawning a new one.
      unlisteners.splice(0).forEach((u) => u());
      if (opened) term.clear();
      else {
        pendingWrites.length = 0;
        pendingWriteBytes = 0;
      }
      void start();
    };

    let line = emptyLine();
    // Shell integration (OSC 133): shells that emit prompt marks (fish,
    // recent PowerShell, configured zsh/bash) tell us exactly when a new
    // prompt starts — use it to clear a poisoned line so history capture
    // recovers immediately instead of waiting for the next clean Enter.
    const tracker = new CommandTracker();
    trackerRef.current = tracker;
    const oscDispose = term.parser.registerOscHandler(133, (data) => {
      const kind = data.split(";")[0];
      if (kind === "A" || kind === "B") line = emptyLine();
      // Command lifecycle for completion notifications.
      if (kind === "C") tracker.oscCommandStart(Date.now());
      if (kind === "D") {
        const raw = data.split(";")[1];
        const code = raw !== undefined && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : null;
        const notice = tracker.oscCommandDone(code, Date.now());
        if (notice) handleNoticeRef.current(notice);
      }
      return false; // let other handlers (decorations, etc.) run too
    });
    // Agent-idle detection: an output burst followed by silence means the
    // agent finished its answer (checked once a second, cheap).
    const tickInterval = setInterval(() => {
      const notice = tracker.tick(Date.now());
      if (notice) handleNoticeRef.current(notice);
    }, 1000);
    // BEL: long builds / AI agents ring the bell when they need attention.
    // Notify only when this terminal is not focused-and-visible.
    term.onBell(() => {
      logActivity("terminal", "Terminal bell");
      const wantsToast = useAppStore.getState().config?.terminal.bell_notifications ?? true;
      if (wantsToast && (!props.api.isActive || document.hidden)) {
        const msg = t("term.bell", "Terminal bell — a command wants attention");
        useAppStore.getState().toast(msg, "info");
        osNotifyIfAway("Luxor", msg);
      }
    });

    term.onData((data) => {
      if (!sessionId) return;
      tracker.userInput(Date.now());
      void ipc.ptyWrite(sessionId, ipc.strToB64(data)).catch(() => {});
      // Reconstruct typed commands for the history overlay (Ctrl+Shift+R).
      const fed = feedInput(line, data);
      line = fed.state;
      if (fed.committed.length > 0) appendHistory(fed.committed);
    });
    term.onResize(({ cols, rows }) => {
      if (sessionId) void ipc.ptyResize(sessionId, cols, rows).catch(() => {});
    });
    void start();

    // Follow app theme changes live.
    const unsubTheme = useAppStore.subscribe((state, prev) => {
      if (state.config?.theme !== prev.config?.theme || state.config?.accent_color !== prev.config?.accent_color) {
        // Wait a tick so the DOM data-theme attribute is updated first.
        setTimeout(() => {
          term.options.theme = xtermTheme();
        }, 0);
      }
    });

    // Fit on the next animation frame instead of synchronously inside the
    // ResizeObserver callback: fit() itself mutates layout, which triggers
    // "ResizeObserver loop completed with undelivered notifications".
    let fitRaf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(() => {
        // A panel that mounted hidden gets its real open here, once it
        // finally has non-zero dimensions.
        if (!opened) void openTerminal();
        else safeFit();
      });
    });
    observer.observe(el);

    // Coming back from the tray / a hidden window: some webviews drop the
    // rendered surface while hidden, which left the terminal looking empty.
    // Re-fit and force a full repaint when we become visible again.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      requestAnimationFrame(() => {
        if (disposed) return;
        if (!opened) {
          void openTerminal();
          return;
        }
        safeFit();
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* renderer mid-initialization after visibility change — safe to skip */
        }
      });
    };
    document.addEventListener("visibilitychange", onVisible);

    // Focus terminal when the panel becomes active. Focusing before open()
    // would touch a textarea that doesn't exist yet.
    const disposable = props.api.onDidActiveChange((e) => {
      if (e.isActive && opened) term.focus();
    });
    if (opened) term.focus();

    return () => {
      disposed = true;
      cancelAnimationFrame(fitRaf);
      clearInterval(tickInterval);
      trackerRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      observer.disconnect();
      unsubTheme();
      fileLinkProvider.dispose();
      oscDispose.dispose();
      disposable.dispose();
      unlisteners.forEach((u) => u());
      if (sessionId) void ipc.ptyKill(sessionId).catch(() => {});
      searchRef.current = null;
      restartRef.current = null;
      termRef.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-terminal CPU/RAM badge + command/agent tracking: poll the shell's
  // process tree. Runs for the badge (show_stats) and for completion
  // notifications (the fallback "tree grew → shrank" detector + agent labels).
  useEffect(() => {
    if (pid === null || (!showStats && !notifyEnabled)) {
      setTreeStats(null);
      return;
    }
    let cancelled = false;
    // Shared scheduler: process-tree walks stop entirely while the window is
    // hidden (tray), never overlap on slow IPC, and refresh immediately when
    // the window becomes visible again.
    const unsubscribe = schedulePoll(
      () =>
        ipc
          .ptyTreeStats(pid)
          .then((st) => {
            if (cancelled) return;
            setTreeStats(st);
            const notices = trackerRef.current?.treeSample(
              st?.processes ?? 0,
              st?.agents ?? [],
              Date.now(),
            );
            notices?.forEach((n) => handleNoticeRef.current(n));
          })
          .catch(() => {}),
      5000,
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pid, showStats, notifyEnabled]);

  const saveOutput = () => {
    const term = termRef.current;
    if (!term) return;
    const text = captureBuffer(term.buffer.active);
    void ipc
      .saveTextFile(suggestOutputFilename(), text)
      .then((path) => {
        if (path) useAppStore.getState().toast(`Terminal output saved to ${path}`, "success");
      })
      .catch((e) => useAppStore.getState().toast(`Save failed: ${errorMessage(e)}`, "error"));
  };

  const findNext = (q: string) => q && searchRef.current?.findNext(q, { incremental: false });

  /** Send SIGINT (Ctrl+C) to the foreground process — the "stop" button. */
  const interruptProcess = () => {
    const id = sessionRef.current;
    if (id) void ipc.ptyWrite(id, ipc.strToB64("\x03")).catch(() => {});
    termRef.current?.focus();
  };

  const openHistory = () => {
    setHistory(loadHistory());
    setHistoryFilter("");
    setHistoryOpen(true);
  };
  openHistoryRef.current = openHistory;

  const runFromHistory = (cmd: string, execute: boolean) => {
    const id = sessionRef.current;
    if (id) void ipc.ptyWrite(id, ipc.strToB64(execute ? `${cmd}\r` : cmd)).catch(() => {});
    setHistoryOpen(false);
    termRef.current?.focus();
  };

  // Drag a file from the explorer (or OS) onto the terminal → paste its path
  // at the cursor (not executed, so the user can keep typing the command).
  const onDrop = (e: React.DragEvent) => {
    const dt = e.dataTransfer;
    const paths: string[] = [];
    const custom = dt.getData("application/x-luxor-file");
    if (custom) paths.push(custom);
    else if (dt.files.length > 0) {
      for (const f of Array.from(dt.files)) {
        // Tauri exposes the absolute path on dropped files; fall back to name.
        const p = (f as File & { path?: string }).path || f.name;
        if (p) paths.push(p);
      }
    } else {
      const txt = dt.getData("text/plain");
      if (txt) paths.push(txt);
    }
    if (paths.length === 0) return;
    e.preventDefault();
    const text = paths.map(shellQuote).join(" ");
    const term = termRef.current;
    if (term) {
      term.paste(text + " ");
      term.focus();
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    if (t.includes("application/x-luxor-file") || t.includes("Files") || t.includes("text/plain")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const term = termRef.current;
    openContextMenu(e, [
      {
        label: t("Copy"),
        icon: ClipboardCopy,
        disabled: !term?.hasSelection(),
        onClick: () => {
          const text = term?.getSelection();
          if (text) void navigator.clipboard.writeText(text);
        },
      },
      {
        label: t("Paste"),
        icon: ClipboardPaste,
        onClick: () => void navigator.clipboard.readText().then((t) => t && term?.paste(t)).catch(() => {}),
      },
      { label: t("Select all"), icon: MousePointerSquareDashed, onClick: () => term?.selectAll() },
      { separator: true },
      { label: t("Find…"), icon: Search, hint: "Ctrl+F", onClick: () => setSearchOpen(true) },
      { label: t("Command history…"), icon: History, hint: "Ctrl+Shift+R", onClick: openHistory },
      { label: t("Save output to file…"), icon: FileDown, onClick: saveOutput },
      { label: t("Clear"), icon: Eraser, onClick: () => term?.clear() },
      { label: t("Stop process (Ctrl+C)"), icon: OctagonX, onClick: interruptProcess },
      { label: t("Restart shell"), icon: RotateCcw, onClick: () => restartRef.current?.() },
      { separator: true },
      {
        label: t("term.split", "Split terminal"),
        icon: SplitSquareHorizontal,
        onClick: () => {
          try {
            splitWithTerminal("right", props.api.id);
          } catch { /* dock layout may not support split in all contexts */ }
        },
      },
    ]);
  };

  return (
    <div className="relative h-full w-full" onContextMenu={onContextMenu} onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={containerRef} className="h-full w-full bg-surface px-1 pt-1" />

      {/* Session restore indicator */}
      {sessionRestored && exited === null && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-edge bg-bar/90 px-3 py-1 shadow-sm backdrop-blur animate-session-fade">
          <History size={12} className="text-accent" />
          <span className="text-[11px] font-medium text-strong">{t("term.session_restored", "Session restored")}</span>
        </div>
      )}

      {/* Split terminal button */}
      <button
        className="absolute right-2 top-1 z-10 flex items-center justify-center rounded border border-edge bg-bar/80 p-1 text-muted transition-colors hover:bg-raised hover:text-strong"
        title={t("term.split", "Split terminal")}
        aria-label={t("term.split", "Split terminal")}
        onClick={() => {
          try {
            splitWithTerminal("right", props.api.id);
          } catch { /* dock layout may not support split in all contexts */ }
        }}
      >
        <SplitSquareHorizontal size={13} />
      </button>

      {/* Stop button — appears while a foreground process is running
          (shell tree has children). Sends Ctrl+C. */}
      {treeStats !== null && treeStats.processes > 1 && exited === null && (
        <button
          className="absolute right-9 top-1 z-10 flex items-center justify-center rounded border border-danger-soft-strong bg-danger-soft p-1 text-danger transition-colors hover:bg-danger-soft-strong"
          title={t("Stop process (Ctrl+C)")}
          aria-label={t("Stop process (Ctrl+C)")}
          onClick={interruptProcess}
        >
          <OctagonX size={13} />
        </button>
      )}

      {treeStats && exited === null && (showStats || treeStats.agents.length > 0) && (
        <div
          data-testid="terminal-stats"
          className="pointer-events-none absolute bottom-1 right-3 z-10 flex items-center gap-1.5 rounded bg-bar/80 px-1.5 py-0.5 font-mono text-[10px] text-muted"
          title={`${t("Shell process tree — processes:")} ${treeStats.processes}`}
        >
          {treeStats.agents.length > 0 && (
            <span
              data-testid="terminal-agent-badge"
              className="text-accent"
              title={t("term.agent_running", "AI agent running in this terminal")}
            >
              ⚡ {treeStats.agents.join(", ")}
            </span>
          )}
          {showStats && (
            <span>
              {treeStats.cpu_percent.toFixed(0)}% · {(treeStats.mem_bytes / 1024 ** 2).toFixed(0)}M
            </span>
          )}
        </div>
      )}

      {searchOpen && (
        <div className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded border border-edge bg-bar px-2 py-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) searchRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) searchRef.current?.findPrevious(query);
              else if (e.key === "Enter") findNext(query);
              else if (e.key === "Escape") {
                setSearchOpen(false);
                searchRef.current?.clearDecorations();
              }
            }}
            placeholder={t("Find…")}
            className="w-40 bg-transparent text-xs text-strong outline-none"
          />
          <button className="px-1 text-xs text-muted hover:text-strong" title={t("Previous (Shift+Enter)")} aria-label={t("Previous (Shift+Enter)")} onClick={() => searchRef.current?.findPrevious(query)}>
            ↑
          </button>
          <button className="px-1 text-xs text-muted hover:text-strong" title={t("Next (Enter)")} aria-label={t("Next (Enter)")} onClick={() => findNext(query)}>
            ↓
          </button>
          <button
            className="px-1 text-xs text-muted hover:text-strong"
            title={t("Close (Esc)")}
            aria-label={t("Close (Esc)")}
            onClick={() => {
              setSearchOpen(false);
              searchRef.current?.clearDecorations();
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {historyOpen && (
        <div
          className="absolute inset-0 z-20 flex items-start justify-center bg-black/40 pt-8"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="flex max-h-[70%] w-[28rem] max-w-[92%] flex-col rounded-lg border border-edge bg-bar shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
              <History size={14} className="shrink-0 text-muted" />
              <input
                autoFocus
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setHistoryOpen(false);
                  if (e.key === "Enter") {
                    const first = history.filter((c) =>
                      c.toLowerCase().includes(historyFilter.toLowerCase()),
                    )[0];
                    if (first) runFromHistory(first, !e.shiftKey);
                  }
                }}
                placeholder={t("Filter command history… (Enter = run, Shift+Enter = paste)")}
                className="w-full bg-transparent text-xs text-strong outline-none"
              />
              <button className="shrink-0 text-muted hover:text-strong" onClick={() => setHistoryOpen(false)} aria-label={t("Close (Esc)")} title={t("Close (Esc)")}>
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {history
                .filter((c) => c.toLowerCase().includes(historyFilter.toLowerCase()))
                .map((cmd, i) => (
                  <button
                    key={`${cmd}-${i}`}
                    className="block w-full truncate rounded px-2 py-1 text-left font-mono text-xs text-strong hover:bg-raised"
                    title={`${cmd}\n\nClick = run · Shift+Click = paste without running`}
                    onClick={(e) => runFromHistory(cmd, !e.shiftKey)}
                  >
                    {cmd}
                  </button>
                ))}
              {history.filter((c) => c.toLowerCase().includes(historyFilter.toLowerCase())).length === 0 && (
                <div className="px-2 py-2 text-xs text-muted">
                  No commands recorded yet — type something in a terminal first.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {exited !== null && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50">
          <div className="text-sm text-strong">
            Shell exited{exited >= 0 ? ` (code ${exited})` : ""}.
          </div>
          <button
            className="rounded bg-accent px-4 py-1.5 text-sm text-black hover:opacity-90"
            onClick={() => restartRef.current?.()}
          >
            Restart shell
          </button>
        </div>
      )}
    </div>
  );
}
