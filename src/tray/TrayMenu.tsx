/**
 * Shared, presentational tray menu.
 *
 * Rendered both inside the real tray popup window (`TrayPopup`) and as a live
 * preview in Settings → Interface → Tray menu. Keeping it in one place means
 * the preview is always pixel-accurate.
 *
 * Style goal: a clean, native-feeling context menu (à la the OS tray menus) —
 * a flat list of rows with one consistent corner radius (rounded-md), no pill
 * shapes. The header (open Luxor) and Quit are always present; every other row
 * is opt-in via `config`.
 *
 * Motion: each row carries `lx-menu-item-in` with a per-row `--lx-i` index so
 * the list cascades in right after the card's pop animation (see tray.css).
 * Hovers use `lx-menu-row` for the accent-tinted background + icon nudge.
 */

import {
  AppWindow,
  Check,
  ExternalLink,
  Power,
  Settings,
  TerminalSquare,
} from "lucide-react";

import { t } from "@/lib/i18n";
import type { Project, TrayConfig } from "@/lib/types";

export interface TrayMenuProps {
  config: TrayConfig;
  projects: Project[];
  closeToTray: boolean;
  version?: string;
  /** Allow a second window (gates the "New window" row). */
  allowSecondWindow?: boolean;
  /** Preview mode: non-interactive, used inside Settings. */
  preview?: boolean;
  onOpenApp?: () => void;
  onOpenSettings?: () => void;
  onProject?: (id: string) => void;
  onNewTerminal?: () => void;
  onNewWindow?: () => void;
  onToggleCloseToTray?: () => void;
  onQuit?: () => void;
}

/** First letter (uppercased) for the project avatar chip. */
function initial(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : "·";
}

/** Inline style carrying the stagger index consumed by `lx-menu-item-in`. */
function stagger(i: number): React.CSSProperties {
  return { "--lx-i": i } as React.CSSProperties;
}

function MenuRow(props: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  index: number;
  onClick?: () => void;
  danger?: boolean;
  title?: string;
  trailing?: React.ReactNode;
}) {
  const { icon: Icon, label, index, onClick, danger, title, trailing } = props;
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      style={stagger(index)}
      className={`lx-menu-item-in lx-menu-row flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] ${
        danger
          ? "lx-menu-danger text-[var(--lx-danger)] hover:bg-[var(--lx-danger-soft)]"
          : "text-[var(--lx-strong)]"
      }`}
    >
      <Icon
        size={14}
        className={danger ? "shrink-0" : "lx-menu-row-icon shrink-0 text-[var(--lx-muted)]"}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

export function TrayMenu(props: TrayMenuProps) {
  const {
    config,
    projects,
    closeToTray,
    version,
    allowSecondWindow = true,
    onOpenApp,
    onOpenSettings,
    onProject,
    onNewTerminal,
    onNewWindow,
    onToggleCloseToTray,
    onQuit,
  } = props;

  const showNewWindow = config.show_new_window && allowSecondWindow;
  const safeProjects = projects.filter(
    (p): p is Project => Boolean(p && typeof p.id === "string" && p.id.length > 0),
  );

  // Running stagger index across every visible row, so the cascade is smooth
  // no matter which sections are enabled.
  let idx = 0;
  const next = () => idx++;

  return (
    <div className="tray-popup flex w-full flex-col overflow-hidden rounded-lg border border-[var(--lx-edge)] bg-[var(--lx-surface)] text-[var(--lx-strong)]">
      {/* Header — open / focus the app */}
      <button
        onClick={onOpenApp}
        title={t("Open Luxor")}
        className="group flex items-center gap-2.5 border-b border-[var(--lx-edge)] bg-[var(--lx-bar)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--lx-raised)]"
      >
        <span className="lx-brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--lx-surface)]">
          <span className="text-[14px] font-black">L</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold leading-tight">{t("Open Luxor")}</span>
          <span className="block truncate text-[10px] leading-relaxed text-[var(--lx-muted)]">
            {version ? `v${version}` : t("Desktop cockpit")}
          </span>
        </span>
        <ExternalLink
          size={13}
          className="shrink-0 text-[var(--lx-muted)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--lx-accent)]"
        />
      </button>

      {/* Body */}
      <div className="max-h-[320px] overflow-y-auto p-1.5">
        {/* Projects */}
        {config.show_projects && (
          <div className="mb-1">
            <div
              style={stagger(next())}
              className="lx-menu-item-in flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--lx-muted)]"
            >
              <span>{t("Projects")}</span>
              {safeProjects.length > 0 && (
                <span className="rounded-full border border-[var(--lx-edge)] px-1.5 py-px text-[8px] font-medium tabular-nums">
                  {safeProjects.length}
                </span>
              )}
            </div>
            {safeProjects.length === 0 ? (
              <div
                style={stagger(next())}
                className="lx-menu-item-in mx-1 rounded-md border border-dashed border-[var(--lx-edge)] px-2 py-2 text-center text-[11px] text-[var(--lx-muted)]"
              >
                {t("No projects")}
              </div>
            ) : (
              safeProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onProject?.(p.id)}
                  title={p.path || p.name}
                  style={stagger(next())}
                  className="lx-menu-item-in lx-menu-row group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--lx-edge)] bg-[var(--lx-bar)] text-[10px] font-semibold text-[var(--lx-muted)] transition-colors group-hover:border-[var(--lx-accent)] group-hover:bg-[var(--lx-accent-soft)] group-hover:text-[var(--lx-accent)]">
                    {initial(p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}</span>
                </button>
              ))
            )}
            <div className="mx-1 my-1.5 h-px bg-[var(--lx-edge)]" />
          </div>
        )}

        {/* Actions */}
        {config.show_new_terminal && (
          <MenuRow icon={TerminalSquare} label={t("New Terminal")} index={next()} onClick={onNewTerminal} />
        )}
        {showNewWindow && (
          <MenuRow icon={AppWindow} label={t("New Window")} index={next()} onClick={onNewWindow} />
        )}
        {config.show_settings && (
          <MenuRow icon={Settings} label={t("Settings")} index={next()} onClick={onOpenSettings} />
        )}

        {/* Background toggle */}
        {config.show_close_to_tray && (
          <button
            onClick={onToggleCloseToTray}
            title={t("Keep running when window closes")}
            role="menuitemcheckbox"
            aria-checked={closeToTray}
            style={stagger(next())}
            className="lx-menu-item-in lx-menu-row flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--lx-strong)]"
          >
            <span
              className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-all ${
                closeToTray
                  ? "scale-100 border-[var(--lx-accent)] bg-[var(--lx-accent)] text-[var(--lx-surface)]"
                  : "border-[var(--lx-edge)] text-transparent"
              }`}
            >
              <Check size={10} strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t("Keep running when window closes")}</span>
          </button>
        )}

        <div className="mx-1 my-1.5 h-px bg-[var(--lx-edge)]" />
        <MenuRow icon={Power} label={t("Quit Luxor")} index={next()} onClick={onQuit} danger />
      </div>
    </div>
  );
}
