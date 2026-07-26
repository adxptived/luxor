/**
 * HTML Preview Panel — a first-class dockview tab for rendering local HTML
 * files. Mirrors the Source ↔ View toggle pattern used in EditorPanel for
 * Markdown and HTML files, extended with:
 *   • Tauri-native rendering via ipc.fileSrc (asset protocol). The preview
 *     iframe is sandboxed WITHOUT `allow-same-origin` so previewed HTML cannot
 *     reach the asset protocol or IPC — scripts run in an opaque origin.
 *   • Fallback to srcDoc in browser/dev mode (reads file text via ipc)
 *   • Auto-refresh with configurable interval + on/off toggle
 *   • "Open in browser" and "Open in editor" shortcuts
 *   • Responsive toolbar that collapses labels on narrow panels
 */

import { formatTime } from "@/lib/format";
import {
  Code2,
  Eye,
  ExternalLink,
  FileCode,
  Loader2,
  Pencil,
  Play,
  Pause,
  RefreshCw,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";

import * as ipc from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useDockStore } from "@/layout/dockStore";
import { useElementWidth } from "@/lib/useElementWidth";

type ViewMode = "preview" | "source";

const AUTO_REFRESH_INTERVALS = [
  { label: "1s",  ms: 1_000 },
  { label: "2s",  ms: 2_000 },
  { label: "5s",  ms: 5_000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
];
const DEFAULT_INTERVAL_MS = 2_000;

function fileNameFromPath(path: string): string {
  return path.split(/[\/]/).pop() ?? path;
}

async function resolvePreviewSrc(_path: string): Promise<string | null> {
  // Security: previews render via sandboxed `srcDoc` only. Serving arbitrary
  // project files through the asset protocol required a wide-open
  // `assetProtocol.scope` ("**"), which let any previewed HTML read any file
  // on disk. The scope is now narrowed to app data (see tauri.conf.json), so
  // asset URLs for project files would be denied anyway — srcDoc in an
  // opaque-origin sandbox is the single, safe rendering path.
  return null;
}

async function readHtmlText(path: string): Promise<string> {
  const file = await ipc.fsReadText(path, 2 * 1024 * 1024);
  return file.content;
}

export function HtmlPreviewPanel(props: IDockviewPanelProps) {
  // Guard: dockview may deliver params after Suspense unwrap; fail gracefully.
  const rawPath = (props.params as Record<string, unknown> | undefined)?.path;
  const path = typeof rawPath === "string" ? rawPath : "";

  const toast = useAppStore((s) => s.toast);
  const openFile = useDockStore((s) => s.openFile);

  const { ref: containerRef, width } = useElementWidth<HTMLDivElement>();
  const compact = width > 0 && width < 480;

  const [mode, setMode] = useState<ViewMode>("preview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [htmlText, setHtmlText] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const name = path ? fileNameFromPath(path) : "HTML Preview";

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!path) {
      setLoading(false);
      setError("No file path provided.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [src, text] = await Promise.all([
        resolvePreviewSrc(path),
        readHtmlText(path),
      ]);
      setPreviewSrc(src);
      setHtmlText(text);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  const doRefresh = useCallback(() => {
    if (isTauri && previewSrc) {
      setReloadKey((k) => k + 1);
      setLastRefreshed(new Date());
    } else {
      if (!path) return;
      void readHtmlText(path).then((text) => {
        setHtmlText(text);
        setLastRefreshed(new Date());
      }).catch(() => {});
    }
  }, [path, previewSrc]);

  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(doRefresh, refreshIntervalMs);
    }
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, [autoRefresh, refreshIntervalMs, doRefresh]);

  const handleManualRefresh = () => void load().then(() => setReloadKey((k) => k + 1));

  const handleOpenInBrowser = () => {
    if (!path) return;
    void ipc.openPath(path).catch((e) =>
      toast(errorMessage(e), "error"),
    );
  };

  const handleOpenInEditor = () => {
    if (!path) return;
    openFile(path);
  };

  // ── Early exits ───────────────────────────────────────────────────────────
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-muted">
        <div className="text-center">
          <FileCode size={32} className="mx-auto mb-2 opacity-30" />
          <div>No file path provided.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface text-sm text-muted">
        <Loader2 size={22} className="animate-spin text-accent" />
        <div className="text-xs font-medium">{t("Loading HTML preview…")}</div>
        <div className="max-w-xs truncate rounded border border-edge bg-raised px-2 py-1 font-mono text-[10px]">
          {path}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center text-sm text-muted">
        <div className="max-w-md rounded-lg border border-danger-soft-strong bg-danger-soft p-5 shadow-sm">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-danger-soft-strong bg-danger-soft text-danger">
            <FileCode size={22} />
          </div>
          <div className="font-medium text-strong">{t("Could not load HTML file")}</div>
          <div className="mt-1 break-words text-xs leading-5 text-muted">{error}</div>
          <div className="mt-3 truncate rounded border border-edge bg-surface px-2 py-1 font-mono text-[11px]">{path}</div>
          <button
            onClick={handleManualRefresh}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:bg-raised hover:text-strong transition"
          >
            <RefreshCw size={13} /> {t("Retry")}
          </button>
        </div>
      </div>
    );
  }

  const intervalLabel = AUTO_REFRESH_INTERVALS.find((i) => i.ms === refreshIntervalMs)?.label ?? "—";

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-surface">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge bg-bar/55 px-2 py-1.5">
        {/* File badge */}
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <FileCode size={13} className="shrink-0 text-accent" />
          <span className="truncate font-mono font-medium text-strong max-w-[160px]" title={path}>{name}</span>
        </div>

        <div className="flex-1" />

        {/* Source / View toggle (same pattern as EditorPanel) */}
        <div className="flex items-center overflow-hidden rounded-lg border border-edge bg-bar/60">
          <button
            onClick={() => setMode("preview")}
            title={t("Show rendered preview")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors font-medium ${
              mode === "preview"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-raised hover:text-strong"
            }`}
          >
            <Eye size={12} />
            {!compact && <span>{t("View")}</span>}
          </button>
          <div className="w-px h-3.5 bg-edge/60" />
          <button
            onClick={() => setMode("source")}
            title={t("Show HTML source")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors font-medium ${
              mode === "source"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-raised hover:text-strong"
            }`}
          >
            <Code2 size={12} />
            {!compact && <span>{t("Source")}</span>}
          </button>
        </div>

        <div className="w-px h-4 bg-edge" />

        {/* Auto-refresh toggle */}
        <button
          onClick={() => { setAutoRefresh((v) => !v); setShowIntervalPicker(false); }}
          title={autoRefresh ? t("Stop auto-refresh") : t("Start auto-refresh")}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition font-medium ${
            autoRefresh
              ? "border-success-soft-strong bg-success-soft text-success"
              : "border-edge bg-surface text-muted hover:bg-raised hover:text-strong"
          }`}
        >
          {autoRefresh ? <Pause size={12} /> : <Play size={12} />}
          {!compact && <span>{autoRefresh ? t("Live") : t("Auto")}</span>}
        </button>

        {/* Interval picker */}
        <div className="relative">
          <button
            onClick={() => setShowIntervalPicker((v) => !v)}
            title={t("Refresh interval")}
            className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-xs transition ${
              showIntervalPicker
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-edge bg-surface text-muted hover:bg-raised"
            }`}
          >
            <Timer size={12} />
            <span className="font-mono">{intervalLabel}</span>
          </button>
          {showIntervalPicker && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label={t("Close refresh interval menu")}
                onClick={() => setShowIntervalPicker(false)}
              />
              <div className="absolute right-0 top-full z-[var(--lx-z-dropdown)] mt-1 flex flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-xl">
                {AUTO_REFRESH_INTERVALS.map((opt) => (
                  <button
                    key={opt.ms}
                    onClick={() => { setRefreshIntervalMs(opt.ms); setShowIntervalPicker(false); }}
                    className={`flex items-center gap-2 px-4 py-2 text-xs text-left transition hover:bg-raised ${
                      refreshIntervalMs === opt.ms ? "text-accent font-semibold" : "text-strong"
                    }`}
                  >
                    <Timer size={11} className="text-muted" />
                    {opt.label}
                    {refreshIntervalMs === opt.ms && <span className="ml-auto text-accent">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="w-px h-4 bg-edge" />

        <button onClick={handleManualRefresh} title={t("Reload from disk")} className="rounded-lg border border-edge bg-surface p-1.5 text-muted hover:bg-raised hover:text-strong transition">
          <RefreshCw size={13} />
        </button>
        <button onClick={handleOpenInEditor} title={t("Open in code editor")} className="rounded-lg border border-edge bg-surface p-1.5 text-muted hover:bg-raised hover:text-strong transition">
          <Pencil size={13} />
        </button>
        <button onClick={handleOpenInBrowser} title={t("Open in system browser")} className="rounded-lg border border-edge bg-surface p-1.5 text-muted hover:bg-raised hover:text-strong transition">
          <ExternalLink size={13} />
        </button>
      </div>

      {/* Status bar */}
      {(autoRefresh || lastRefreshed) && (
        <div className="flex shrink-0 items-center justify-between border-b border-edge bg-bar/20 px-3 py-0.5 text-[10px] text-muted select-none">
          <span className="flex items-center gap-1.5">
            {autoRefresh && (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-success font-medium">Live — every {intervalLabel}</span>
              </>
            )}
          </span>
          {lastRefreshed && (
            <span className="font-mono">{formatTime(lastRefreshed)}</span>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      {mode === "preview" ? (
        isTauri && previewSrc ? (
          <iframe
            key={`tauri-${reloadKey}`}
            src={previewSrc}
            title={name}
            // No `allow-same-origin`: combined with `allow-scripts` it would let
            // previewed HTML fetch arbitrary asset: URLs (i.e. read local files).
            // Scripts still run, but in an opaque origin without IPC/asset reach.
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        ) : (
          <iframe
            key={`srcdoc-${reloadKey}`}
            srcDoc={htmlText || "<html><body style='font-family:sans-serif;padding:20px;color:#888'>Empty file</body></html>"}
            title={name}
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        )
      ) : (
        /* Source view */
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <div className="flex items-center justify-between border-b border-edge bg-raised px-4 py-1.5">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted flex items-center gap-1.5">
              <Code2 size={11} /> HTML Source — {name}
            </span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(htmlText).then(() =>
                  toast(t("Source copied to clipboard"), "success"),
                );
              }}
              className="text-xs text-muted hover:text-strong transition flex items-center gap-1 px-2 py-0.5 rounded border border-edge hover:border-muted"
            >
              <Code2 size={11} /> Copy
            </button>
          </div>
          <pre className="select-text whitespace-pre-wrap break-all px-4 py-4 font-mono text-[12px] leading-relaxed text-strong">
            {htmlText || "(empty file)"}
          </pre>
        </div>
      )}
    </div>
  );
}
