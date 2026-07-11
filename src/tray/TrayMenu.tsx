/**
 * Shared, presentational tray menu.
 *
 * Rendered both inside the real tray popup window (`TrayPopup`) and as a live
 * preview in Settings → Interface → Tray menu. Keeping it in one place means
 * the preview is always pixel-accurate.
 *
 * Style goal: Telegram-like minimalism — a flat dark panel with plain text
 * rows. No branded header, no icons, no badges, no section labels. Just
 * generously padded text rows with a quiet hover, exactly like the native
 * tray menus of Telegram/Spotify on Windows.
 */

import { Check } from "lucide-react";

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

function MenuRow(props: {
  label: string;
  onClick?: () => void;
  title?: string;
  leading?: React.ReactNode;
}) {
  const { label, onClick, title, leading } = props;
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="lx-menu-row flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-[var(--lx-strong)]"
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

export function TrayMenu(props: TrayMenuProps) {
  const {
    config,
    projects,
    closeToTray,
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

  return (
    <div className="tray-popup flex w-full flex-col overflow-hidden rounded-lg border border-[var(--lx-edge)] bg-[var(--lx-surface)] py-1.5 text-[var(--lx-strong)]">
      <div className="max-h-[360px] overflow-y-auto">
        <MenuRow label={t("Open Luxor")} onClick={onOpenApp} />

        {config.show_projects &&
          safeProjects.map((p) => (
            <MenuRow
              key={p.id}
              label={p.name}
              title={p.path || p.name}
              onClick={() => onProject?.(p.id)}
            />
          ))}

        {(config.show_new_terminal || showNewWindow || config.show_settings) && (
          <div className="mx-3 my-1.5 h-px bg-[var(--lx-edge)]" />
        )}

        {config.show_new_terminal && (
          <MenuRow label={t("New Terminal")} onClick={onNewTerminal} />
        )}
        {showNewWindow && <MenuRow label={t("New Window")} onClick={onNewWindow} />}
        {config.show_settings && <MenuRow label={t("Settings")} onClick={onOpenSettings} />}

        {config.show_close_to_tray && (
          <button
            onClick={onToggleCloseToTray}
            title={t("Keep running when window closes")}
            role="menuitemcheckbox"
            aria-checked={closeToTray}
            className="lx-menu-row flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-[var(--lx-strong)]"
          >
            <span className="min-w-0 flex-1 truncate">
              {t("Keep running when window closes")}
            </span>
            {closeToTray && (
              <Check size={14} className="shrink-0 text-[var(--lx-muted)]" />
            )}
          </button>
        )}

        <div className="mx-3 my-1.5 h-px bg-[var(--lx-edge)]" />
        <MenuRow label={t("Quit Luxor")} onClick={onQuit} />
      </div>
    </div>
  );
}
