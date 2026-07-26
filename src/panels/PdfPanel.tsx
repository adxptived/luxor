/** PDF viewer: streams the local file through Tauri's asset protocol into the
 *  webview's native PDF renderer (WebView2 / WebKit both ship one). */

import { AlertTriangle, Copy, FileText, FileX2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/state/appStore";

export function PdfPanel(props: IDockviewPanelProps) {
  const path = (props.params as { path?: string }).path ?? "";
  const toast = useAppStore((s) => s.toast);
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setSrc(null);
    ipc
      .fileSrc(path)
      .then((s) => {
        if (alive) setSrc(s);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [path, reloadKey]);

  const fileName = path.split(/[\\/]/).pop() || path || "PDF";

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6 text-sm text-muted">
        <div className="rounded-lg border border-edge bg-bar/45 px-5 py-4 text-center shadow-sm">
          <Loader2 size={22} className="mx-auto mb-2 animate-spin text-accent" />
          <div className="font-medium text-strong">{t("Loading PDF…")}</div>
          <div className="mt-1 max-w-sm truncate text-xs" title={path}>{path}</div>
        </div>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface p-6 text-center text-muted">
        <div className="max-w-md rounded-lg border border-edge bg-bar/40 p-5 shadow-sm">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-warning-soft-strong bg-warning-soft text-warning">
            <FileX2 size={24} />
          </div>
          <div className="text-sm font-medium text-strong">{t("PDF preview needs the desktop app")}</div>
          <div className="mt-1 text-xs leading-5">{t("The asset protocol is only available inside the Tauri runtime.")}</div>
          <div className="mt-3 truncate rounded-lg border border-edge bg-surface px-2 py-1 font-mono text-2xs" title={path}>{path}</div>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:bg-raised hover:text-strong"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-bar/55 px-3 py-2 text-xs text-muted">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <FileText size={15} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-strong" title={path}>{fileName}</div>
            <div className="truncate font-mono text-3xs opacity-70" title={path}>{path}</div>
          </div>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-lg border border-edge px-2 py-1.5 hover:bg-raised hover:text-strong"
          title={t("Reload")}
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={() => void navigator.clipboard.writeText(path).then(() => toast(t("Copied"), "success"))}
          className="rounded-lg border border-edge px-2 py-1.5 hover:bg-raised hover:text-strong"
          title={t("Copy path")}
        >
          <Copy size={13} />
        </button>
        <span className="hidden items-center gap-1 rounded-full border border-edge bg-surface px-2 py-1 text-3xs sm:flex">
          <AlertTriangle size={11} className="text-muted" /> Native viewer
        </span>
      </div>
      <iframe src={src} title={path} className="min-h-0 flex-1 border-0 bg-surface" />
    </div>
  );
}
