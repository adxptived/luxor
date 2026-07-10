/** Quick-action launcher buttons (external terminal, file manager, IDE,
 *  favorites). Renders horizontally in the top bar, as a vertical side rail,
 *  or as full-width labelled rows inside the sidebar (`expanded`). */

import {
  AppWindow,
  ChevronDown,
  FolderOpen,
  Play,
  Plus,
  SquareTerminal,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { DetectedIde } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { effectiveHotkeys } from "@/lib/hotkeys";
import { useDockStore } from "@/layout/dockStore";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";
import { useActiveProject, useProjectsStore } from "@/state/projectsStore";

/** Stable brand color per IDE command for the dropdown badges. */
const IDE_COLORS: Record<string, string> = {
  code: "#22a7f2",
  "code-insiders": "#1fb87a",
  cursor: "#8b8b94",
  windsurf: "#0ea5a4",
  zed: "#1f6feb",
  subl: "#ff9800",
  idea: "#fe315d",
  clion: "#21d789",
  rustrover: "#ff6f3d",
  webstorm: "#07c3f2",
  pycharm: "#21d789",
  fleet: "#7c3aed",
  studio64: "#3ddc84",
  "notepad++": "#90c53f",
};

/** Pseudo "IDEs": open the folder with whatever the OS associates, or in the
 *  file explorer — mirrors the Windows "Open with" experience. */
const SENTINEL_IDES: DetectedIde[] = [
  { command: "__default__", label: "System default" }, // label translated at render
  { command: "__explorer__", label: "File explorer" },
];

function ideColor(command: string): string {
  const base = command.split(/[\\/]/).pop()?.replace(/\.exe$/i, "").toLowerCase() ?? command;
  if (IDE_COLORS[base]) return IDE_COLORS[base];
  let hash = 0;
  for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 55%)`;
}

function ideShort(label: string): string {
  const words = label.split(/[\s-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

export function QuickActions({ vertical, expanded = false }: { vertical: boolean; expanded?: boolean }) {
  const project = useActiveProject();
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const toast = useAppStore((s) => s.toast);
  const updateProject = useProjectsStore((s) => s.updateProject);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const [detected, setDetected] = useState<DetectedIde[]>([]);
  const [ideMenu, setIdeMenu] = useState(false);
  const [favMenu, setFavMenu] = useState(false);
  const ideRef = useRef<HTMLSpanElement>(null);
  const favRef = useRef<HTMLSpanElement>(null);
  const hks = effectiveHotkeys(config);
  // Dismissal is handled inside <Dropdown/> (it knows both anchor and popup),
  // so portaled menu clicks are not treated as "outside".

  const dir = project && project.path !== "" ? project.path : null;

  useEffect(() => {
    if (!dir) {
      setDetected([]);
      return;
    }
    let disposed = false;
    let idle = false;
    const run = () => {
      void ipc.launcherDetectIdes().then((list) => {
        if (!disposed) setDetected(list);
      }, () => {});
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    idle = typeof w.requestIdleCallback === "function";
    const id = idle ? w.requestIdleCallback!(run, { timeout: 1500 }) : window.setTimeout(run, 350);
    return () => {
      disposed = true;
      if (idle) w.cancelIdleCallback?.(id);
      else window.clearTimeout(id);
    };
  }, [dir]);

  // Detected IDEs + custom entries from settings (deduped, custom wins),
  // plus Windows-style fallbacks: system default app and the file explorer.
  const ides = useMemo(() => {
    const list: DetectedIde[] = [];
    const seen = new Set<string>();
    for (const c of config?.custom_ides ?? []) {
      if (c.command.trim() && !seen.has(c.command)) {
        seen.add(c.command);
        list.push({ command: c.command, label: c.label || c.command });
      }
    }
    for (const d of detected) {
      if (!seen.has(d.command)) {
        seen.add(d.command);
        list.push(d);
      }
    }
    list.push(...SENTINEL_IDES);
    return list;
  }, [detected, config?.custom_ides]);

  /** Run a launcher action: success and failure both give visible feedback. */
  const act = (label: string, fn: () => Promise<unknown>, success?: string) =>
    void fn().then(
      () => toast(success ?? `${label}…`, "success"),
      (e) => toast(`${label} — ${t("failed:")} ${errorMessage(e)}`, "error"),
    );

  const defaultIde = useMemo(() => {
    const preferred = project?.preferred_ide ?? config?.default_ide ?? null;
    return ides.find((i) => i.command === preferred) ?? ides[0] ?? null;
  }, [ides, project?.preferred_ide, config?.default_ide]);

  const openIde = (command?: string) => {
    if (!dir) return;
    const cmd = command ?? defaultIde?.command;
    if (cmd === "__default__") {
      act(t("Open"), () => ipc.launcherOpenDefaultApp(dir), t("Opening with the system default"));
      return;
    }
    if (cmd === "__explorer__") {
      act(t("Open file manager"), () => ipc.launcherOpenFileManager(dir), t("Opening file manager"));
      return;
    }
    const name = ides.find((i) => i.command === cmd)?.label ?? cmd ?? "IDE";
    act(t("Open IDE"), () => ipc.launcherOpenIde(dir, cmd), `${t("Opening in")} ${name}`);
  };

  const setDefault = (command: string) => {
    if (!config) return;
    void saveConfig({ ...config, default_ide: command });
    toast(t("Default IDE updated"), "success");
  };

  const addFavorite = async () => {
    if (!project) return;
    const cmd = await useUiStore.getState().prompt({
      title: t("Add favorite command"),
      message: t("It will run in a new terminal of this project."),
      placeholder: t("e.g. cargo run"),
    });
    const next = cmd?.trim();
    if (!next) return;
    if (project.favorite_commands.some((existing) => existing.trim() === next)) {
      toast(t("Favorite command already exists"), "info");
      return;
    }
    void updateProject({ ...project, favorite_commands: [...project.favorite_commands, next] });
    toast(t("Favorite command added"), "success");
  };

  const btn = expanded
    ? "lx-square-btn flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-strong disabled:opacity-30"
    : `lx-square-btn flex h-7 w-7 items-center justify-center text-muted hover:text-strong disabled:opacity-30 ${
        vertical && !expanded ? "w-9" : ""
      }`;
  const label = (text: string) =>
    expanded && <span className="min-w-0 flex-1 truncate text-xs">{text}</span>;
  const menuSide = vertical || expanded;

  return (
    <div
      className={`flex shrink-0 gap-0.5 ${
        expanded ? "flex-col items-stretch pb-1" : vertical ? "flex-col items-center py-1" : "items-center"
      }`}
      data-testid="quick-actions"
    >
      <button
        className={btn}
        disabled={!dir}
        title={`${t("Open external terminal")} (${hks["terminal.new"]})`}
        onClick={() => dir && act(t("Open terminal"), () => ipc.launcherOpenTerminal(dir), t("Opening external terminal"))}
      >
        <SquareTerminal size={16} />
        {label(t("External terminal"))}
      </button>
      <button
        className={btn}
        disabled={!dir}
        title={t("Open in file manager")}
        onClick={() => dir && act(t("Open file manager"), () => ipc.launcherOpenFileManager(dir), t("Opening file manager"))}
      >
        <FolderOpen size={16} />
        {label(t("File manager"))}
      </button>

      {/* IDE split button — the chevron sits to the RIGHT of the launch icon */}
      <span className={`relative ${expanded ? "w-full" : ""}`} ref={ideRef}>
        <span className={`flex items-center ${vertical && !expanded ? "flex-col" : ""}`}>
          <button
            className={`${btn} ${expanded ? "min-w-0 flex-1" : ""}`}
            disabled={!dir || !defaultIde}
            title={defaultIde ? `${t("Open in")} ${t(defaultIde.label)}` : t("No IDE found")}
            data-testid="ide-launch"
            onClick={() => openIde()}
          >
            <AppWindow size={16} className="shrink-0" />
            {label(defaultIde ? `${t("Open in")} ${t(defaultIde.label)}` : t("No IDE found"))}
          </button>
          <button
            className="lx-square-btn flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:text-strong disabled:opacity-30"
            disabled={ides.length === 0}
            title={t("Choose IDE")}
            data-testid="ide-chevron"
            onClick={() => setIdeMenu((v) => !v)}
          >
            <ChevronDown size={12} />
          </button>
        </span>
        {ideMenu && (
          <Dropdown anchor={ideRef} side={menuSide} onClose={() => setIdeMenu(false)}>
            <div className="mb-1 rounded-lg bg-surface/70 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Open project in…
            </div>
            {ides.map((ide) => (
              <div key={ide.command} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-black/80"
                  style={{ backgroundColor: ideColor(ide.command) }}
                >
                  {ideShort(ide.label)}
                </span>
                <button
                  className="min-w-0 flex-1 truncate text-left text-strong"
                  disabled={!dir}
                  onClick={() => {
                    setIdeMenu(false);
                    openIde(ide.command);
                  }}
                  title={ide.command}
                >
                  {t(ide.label)}
                </button>
                <button
                  className={`shrink-0 ${
                    (config?.default_ide ?? null) === ide.command
                      ? "text-accent"
                      : "text-muted opacity-0 hover:text-accent group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  }`}
                  title={t("Set as default IDE")}
                  onClick={() => setDefault(ide.command)}
                >
                  <Star size={13} fill={(config?.default_ide ?? null) === ide.command ? "currentColor" : "none"} />
                </button>
              </div>
            ))}
            {ides.length === 0 && <div className="px-2 py-1 text-xs text-muted">No IDEs found.</div>}
          </Dropdown>
        )}
      </span>

      {/* Favorites */}
      <span className={`relative ${expanded ? "w-full" : ""}`} ref={favRef}>
        <button className={btn} disabled={!project} title={t("Favorite commands")} onClick={() => setFavMenu((v) => !v)}>
          <Zap size={16} />
          {label(t("Favorite commands"))}
        </button>
        {favMenu && project && (
          <Dropdown anchor={favRef} side={menuSide} onClose={() => setFavMenu(false)}>
            <div className="mb-1 rounded-lg bg-surface/70 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Favorite commands
            </div>
            {project.favorite_commands.map((cmd, i) => (
              <div key={`${cmd}-${i}`} className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-raised">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-strong"
                  onClick={() => {
                    setFavMenu(false);
                    addTerminal({ cwd: dir, autorun: [cmd] });
                  }}
                  title={`${t("Run in new terminal:")} ${cmd}`}
                >
                  <Play size={11} className="shrink-0 text-muted" />
                  <span className="truncate font-mono text-xs">{cmd}</span>
                </button>
                <button
                  className="shrink-0 rounded p-0.5 text-muted hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100"
                  title={t("Remove favorite")}
                  onClick={() =>
                    void updateProject({
                      ...project,
                      favorite_commands: project.favorite_commands.filter((_, j) => j !== i),
                    })
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {project.favorite_commands.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted">No favorites yet.</div>
            )}
            <button
              className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-edge px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong"
              onClick={() => {
                setFavMenu(false);
                void addFavorite();
              }}
            >
              <Plus size={12} /> Add command…
            </button>
          </Dropdown>
        )}
      </span>
    </div>
  );
}

/** Popup menu rendered in a body-level portal so it is never clipped by an
 *  ancestor `overflow:hidden` (the "+ menu sometimes not visible" bug) and
 *  always layers above panels. Position is computed from the anchor's rect and
 *  clamped into the viewport; dismissal accounts for both anchor and popup so
 *  clicks inside the menu still register. */
function Dropdown(props: {
  anchor: React.RefObject<HTMLElement | null>;
  side: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = props.anchor.current;
    const el = ref.current;
    if (!a || !el) return;
    const ar = a.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const pad = 8;
    // `side` → open to the right of the rail; otherwise drop below, right-aligned.
    let left = props.side ? ar.right + 4 : ar.right - er.width;
    let top = props.side ? ar.top : ar.bottom + 4;
    if (left + er.width > window.innerWidth - pad) left = window.innerWidth - er.width - pad;
    if (left < pad) left = pad;
    if (top + er.height > window.innerHeight - pad) {
      const above = (props.side ? ar.bottom : ar.top) - er.height;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - er.height - pad);
    }
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [props.side, props.anchor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const tgt = e.target as Node | null;
      if (tgt && !ref.current?.contains(tgt) && !props.anchor.current?.contains(tgt)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", props.onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", props.onClose);
    };
  }, [props]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, borderRadius: "var(--lx-radius-xl)" }}
      className="lx-pop-in lx-glass z-[var(--lx-z-menu)] w-[min(18rem,calc(100vw-1rem))] p-2 text-sm"
    >
      {props.children}
    </div>,
    document.body,
  );
}
