/**
 * UI overlay state: the custom context menu and promise-based dialogs
 * (replacing the browser's `contextmenu`, `window.confirm` and `window.prompt`).
 */

import type { LucideIcon } from "lucide-react";
import { create } from "zustand";
import { t } from "@/lib/i18n";

import { useAppStore } from "./appStore";

export interface MenuItem {
  label?: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a separator line instead of an item. */
  separator?: boolean;
  /** Small hint shown on the right (e.g. a hotkey). */
  hint?: string;
  /** Colored dot rendered before the label (CSS color), e.g. for tab colors. */
  swatch?: string;
  onClick?: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface DialogState {
  kind: "confirm" | "prompt";
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (value: string | boolean | null) => void;
}

interface UiStore {
  menu: MenuState | null;
  dialog: DialogState | null;

  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;

  confirm: (opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  prompt: (opts: {
    title: string;
    message?: string;
    placeholder?: string;
    initial?: string;
    confirmLabel?: string;
  }) => Promise<string | null>;
  resolveDialog: (value: string | boolean | null) => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  menu: null,
  dialog: null,

  openMenu: (x, y, items) => {
    if (items.length === 0) return;
    // Store the raw cursor position. Clamping happens exactly once in
    // <ContextMenu> with the *measured* menu size — pre-clamping here with an
    // estimated height made the menu land far away from the cursor (the
    // status-bar right-click menu ended up ~400px above the pointer).
    set({ menu: { x, y, items } });
  },

  closeMenu: () => set({ menu: null }),

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          kind: "confirm",
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? t("Confirm"),
          danger: opts.danger ?? false,
          resolve: (v) => resolve(v === true),
        },
      });
    }),

  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          kind: "prompt",
          title: opts.title,
          message: opts.message,
          placeholder: opts.placeholder,
          initial: opts.initial,
          confirmLabel: opts.confirmLabel ?? t("OK"),
          danger: false,
          resolve: (v) => resolve(typeof v === "string" ? v : null),
        },
      });
    }),

  resolveDialog: (value) => {
    const dialog = get().dialog;
    set({ dialog: null });
    dialog?.resolve(value);
  },
}));

/** Open the custom context menu from a mouse event. */
export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
  items: MenuItem[],
) {
  e.preventDefault();
  e.stopPropagation();
  useUiStore.getState().openMenu(e.clientX, e.clientY, items);
}

/** Confirm a destructive action — auto-approves when the setting is off. */
export async function confirmDestructive(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
}): Promise<boolean> {
  const enabled = useAppStore.getState().config?.confirm_destructive ?? true;
  if (!enabled) return true;
  return useUiStore.getState().confirm({ ...opts, danger: true });
}
