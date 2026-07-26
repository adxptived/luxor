/** Quick image viewer: base64 data URL, zoom controls, checkerboard backdrop. */

import type { IDockviewPanelProps } from "dockview";
import { AlertTriangle, Copy, Image as ImageIcon, Loader2, Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/types";
import { fileExt } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export function ImagePanel(props: IDockviewPanelProps) {
  const path = (props.params as { path: string }).path;
  const toast = useAppStore((s) => s.toast);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    setSize(null);
    setZoom("fit");
    void ipc
      .fsReadBase64(path)
      .then((b64) => {
        if (!cancelled) setSrc(`data:${MIME[fileExt(path)] ?? "image/png"};base64,${b64}`);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const zoomBy = (factor: number) =>
    setZoom((z) => Math.min(16, Math.max(0.05, (z === "fit" ? 1 : z) * factor)));

  const fileName = path.split(/[\\/]/).pop() ?? path;
  const zoomLabel = zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6 text-sm text-muted">
        <div className="max-w-md rounded-lg border border-edge bg-bar/40 p-5 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-danger-soft-strong bg-danger-soft text-danger">
            <AlertTriangle size={22} />
          </div>
          <div className="font-medium text-strong">{t("Could not open image")}</div>
          <div className="mt-1 break-words text-xs leading-5">{error}</div>
          <div className="mt-3 truncate rounded-lg border border-edge bg-surface px-2 py-1 font-mono text-2xs" title={path}>
            {path}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-bar/55 px-3 py-2 text-xs text-muted">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <ImageIcon size={15} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-strong" title={path}>{fileName}</div>
            <div className="truncate font-mono text-3xs opacity-70" title={path}>{path}</div>
          </div>
        </div>
        {size && (
          <span className="shrink-0 rounded-full border border-edge bg-surface px-2 py-1 font-mono text-3xs text-muted">
            {size.w}×{size.h}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-surface/70 p-1">
          <button className="rounded-lg p-1.5 hover:bg-raised hover:text-strong" title={t("Zoom out")} onClick={() => zoomBy(1 / 1.25)}>
            <ZoomOut size={13} />
          </button>
          <span className="w-12 text-center font-mono text-2xs">{zoomLabel}</span>
          <button className="rounded-lg p-1.5 hover:bg-raised hover:text-strong" title={t("Zoom in")} onClick={() => zoomBy(1.25)}>
            <ZoomIn size={13} />
          </button>
          <button className="rounded-lg p-1.5 hover:bg-raised hover:text-strong" title={t("Fit / 100%")} onClick={() => setZoom((z) => (z === "fit" ? 1 : "fit"))}>
            <Maximize size={13} />
          </button>
          <button className="rounded-lg p-1.5 hover:bg-raised hover:text-strong" title={t("Reset zoom")} onClick={() => setZoom("fit")}>
            <RotateCcw size={13} />
          </button>
        </div>
        <button
          className="rounded-lg border border-edge px-2 py-1.5 text-muted hover:bg-raised hover:text-strong"
          title={t("Copy path")}
          onClick={() => void navigator.clipboard.writeText(path).then(() => toast(t("Copied"), "success"))}
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="lx-checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {src ? (
          <img
            src={src}
            alt={path}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onWheel={(e) => {
              if (e.ctrlKey) {
                e.preventDefault();
                zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
              }
            }}
            style={
              zoom === "fit"
                ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
                : { width: size ? size.w * zoom : undefined, maxWidth: "none" }
            }
            className="select-none rounded-sm shadow-2xl shadow-black/30"
            draggable={false}
          />
        ) : (
          <div className="rounded-lg border border-edge bg-bar/50 px-5 py-4 text-center text-sm text-muted shadow-sm">
            <Loader2 size={22} className="mx-auto mb-2 animate-spin text-accent" />
            {t("Loading image…")}
          </div>
        )}
      </div>
    </div>
  );
}
