/** Global overlays: custom context menu, confirm/prompt dialogs, toasts. */

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useAppStore } from "@/state/appStore";
import { t } from "@/lib/i18n";
import { useUiStore } from "@/state/uiStore";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useDelayedUnmount } from "@/lib/dismiss";

/** Render children into <body> so no ancestor `overflow:hidden`, `transform`
 *  or stacking context can clip or mis-layer the popup. SSR-safe (returns null
 *  until a document exists). */
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function Overlays() {
  return (
    <>
      <ContextMenu />
      <Dialog />
      <Toasts />
    </>
  );
}

function ContextMenu() {
  const menu = useUiStore((s) => s.menu);
  const closeMenu = useUiStore((s) => s.closeMenu);
  const menuRef = useRef<HTMLDivElement>(null);
  // The control that had focus when the menu opened, so we can restore it on
  // close (WCAG 2.4.3 — focus must not be lost when a transient popup closes).
  const triggerRef = useRef<HTMLElement | null>(null);

  // Esc / outside pointerdown / window blur all close the menu. No invisible
  // backdrop: the element under the cursor receives the click normally, so a
  // single click both dismisses the menu and acts on the target.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    const onBlur = () => closeMenu();
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) closeMenu();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [menu, closeMenu]);

  // Remember the opener, and restore focus to it when the menu closes.
  useEffect(() => {
    if (menu) {
      triggerRef.current = document.activeElement as HTMLElement | null;
    } else if (triggerRef.current) {
      triggerRef.current.focus?.();
      triggerRef.current = null;
    }
  }, [menu]);

  // All enabled menuitem buttons, in DOM order.
  const itemButtons = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
    );

  // Keyboard model for the menu: Up/Down move (wrapping), Home/End jump to
  // ends, Enter/Space activate the focused item (native button behaviour).
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = itemButtons();
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  // Place the menu so it always stays fully on screen. Status-bar menus are
  // opened from the very bottom edge with many items, so we measure the menu's
  // natural height and decide whether to drop down, flip up, or (when it is
  // taller than the whole viewport) anchor to the roomier side and scroll. A
  // dynamic max-height + overflow-y:auto guarantees the last items are always
  // reachable. Runs in a layout effect (before paint); the menu is kept
  // `visibility:hidden` until positioned so there is never a flash at the wrong
  // spot or a zero-size measurement.
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = el.getBoundingClientRect().width;
    // scrollHeight is the full content height, unaffected by any prior
    // max-height clamp — exactly what we need to choose a placement.
    const naturalH = el.scrollHeight;
    const spaceBelow = vh - menu.y - pad;
    const spaceAbove = menu.y - pad;
    let top: number;
    let maxHeight: number;
    if (naturalH <= spaceBelow) {
      top = menu.y; // fits opening downward (preferred)
      maxHeight = naturalH;
    } else if (naturalH <= spaceAbove) {
      top = menu.y - naturalH; // flip up (status-bar / bottom-edge menus)
      maxHeight = naturalH;
    } else if (spaceBelow >= spaceAbove) {
      top = menu.y; // taller than the viewport: use the roomier side + scroll
      maxHeight = spaceBelow;
    } else {
      top = pad;
      maxHeight = spaceAbove;
    }
    let left = menu.x;
    if (left + width > vw - pad) left = Math.max(pad, vw - width - pad);
    setPos({ left, top, maxHeight });
    // Move focus into the menu (first enabled item) so keyboard users can drive
    // it immediately; the trigger is restored on close by the effect above.
    const first = el.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [menu]);

  if (!menu) return null;
  return (
    <Portal>
      <div
        ref={menuRef}
        data-testid="context-menu"
        className="lx-context-menu lx-glass fixed z-[var(--lx-z-menu)] min-w-[13.5rem] max-w-[min(18rem,calc(100vw-1rem))] overflow-y-auto overflow-x-hidden p-1.5 text-sm"
        role="menu"
        aria-orientation="vertical"
        onKeyDown={onMenuKeyDown}
        style={{
          left: pos?.left ?? menu.x,
          top: pos?.top ?? menu.y,
          maxHeight: pos?.maxHeight,
          visibility: pos ? "visible" : "hidden",
          borderRadius: "var(--lx-radius-lg)",
        }}
      >
        {menu.items.map((item, i) =>
          item.separator ? (
            <div key={i} className="mx-1.5 my-1 border-t border-edge/80" role="separator" />
          ) : (
            <button
              key={i}
              disabled={item.disabled}
              role="menuitem"
              aria-label={item.label}
              onClick={() => {
                closeMenu();
                item.onClick?.();
              }}
              className={`group flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger
                  ? "text-danger hover:bg-danger-soft focus:bg-danger-soft"
                  : "text-strong hover:bg-raised focus:bg-raised"
              }`}
            >
              {item.swatch && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-edge shadow-inner"
                  style={{ background: item.swatch }}
                />
              )}
              {item.icon && <item.icon size={14} className="shrink-0 text-muted group-hover:text-strong" />}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 rounded border border-edge bg-surface px-1 py-0.5 font-mono text-[10px] text-muted">{item.hint}</span>}
            </button>
          ),
        )}
      </div>
    </Portal>
  );
}

function Dialog() {
  const dialog = useUiStore((s) => s.dialog);
  const resolve = useUiStore((s) => s.resolveDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Trap focus inside the dialog and restore it to the opener on close. The
  // initial target is the text field for prompts, otherwise the confirm button.
  useFocusTrap(containerRef, !!dialog, {
    initialFocus: dialog?.kind === "prompt" ? inputRef : confirmRef,
  });

  useEffect(() => {
    if (dialog) setValue(dialog.initial ?? "");
  }, [dialog]);

  // Window-level Escape so the dialog closes even when focus is elsewhere.
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolve(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog, resolve]);

  // Keep the dialog mounted through its exit animation (lx-dialog-leaving).
  // The store clears `dialog` synchronously on resolve, so retain the last
  // content to render during the fade-out.
  const { mounted, leaving } = useDelayedUnmount(!!dialog, 160);
  const lastDialogRef = useRef(dialog);
  if (dialog) lastDialogRef.current = dialog;
  const view = dialog ?? lastDialogRef.current;

  if (!mounted || !view) return null;

  // Ignore interactions once the dialog is animating out.
  const submit = () => dialog && resolve(dialog.kind === "prompt" ? value : true);
  const close = () => dialog && resolve(null);
  const DialogIcon = view.danger ? AlertTriangle : view.kind === "confirm" ? CheckCircle2 : Info;
  const messageId = view.message ? "lx-dialog-message" : undefined;

  return (
    <Portal>
      <div
        ref={containerRef}
        className={`lx-dialog-overlay fixed inset-0 z-[var(--lx-z-dialog)] flex items-center justify-center bg-black/60 px-4 ${leaving ? "lx-dialog-leaving" : ""}`} style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        aria-describedby={messageId}
        onMouseDown={(e) => e.target === e.currentTarget && close()}
      >
        <div className="lx-pop-in w-[26rem] max-w-full overflow-hidden rounded-lg border border-edge bg-bar shadow-2xl shadow-black/40">
          <div className="border-b border-edge bg-[radial-gradient(circle_at_top_left,var(--lx-raised),transparent_58%)] p-4">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                  view.danger ? "border-danger-soft-strong bg-danger-soft text-danger" : "border-edge bg-raised text-muted"
                }`}
              >
                <DialogIcon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-strong">{view.title}</div>
                {view.message && <div id={messageId} className="mt-1 text-xs leading-5 text-muted">{view.message}</div>}
              </div>
            </div>
          </div>
          {/* A real form so Enter submits only from the text field / focused
              submit button — never from a focused Cancel button (P1AX-02). */}
          <form
            className="p-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {view.kind === "prompt" && (
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={view.placeholder}
                className="mb-4 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-strong outline-none focus:border-muted"
              />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-muted hover:bg-raised hover:text-strong"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                type="submit"
                ref={confirmRef}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm ${
                  view.danger ? "bg-danger text-on-danger hover:opacity-90" : "bg-raised border border-edge text-strong hover:bg-surface"
                }`}
              >
                {view.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const TOAST_STYLES = {
  info: "border-edge bg-bar text-strong",
  success: "border-success-soft-strong bg-bar text-success",
  warning: "border-warning-soft-strong bg-bar text-warning",
  error: "border-danger-soft-strong bg-bar text-danger",
} as const;

const MAX_VISIBLE_TOASTS = 5;

function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const pause = useAppStore((s) => s.pauseToasts);
  const resume = useAppStore((s) => s.resumeToasts);
  // Mirrors the paused state of the store timers so the visual countdown bar
  // freezes exactly when auto-dismiss freezes (hover/focus on the stack).
  const [paused, setPaused] = useState(false);
  const onPause = () => {
    setPaused(true);
    pause();
  };
  const onResume = () => {
    setPaused(false);
    resume();
  };

  // Show the newest few; collapse the rest into a "+N more" chip so a burst
  // never buries the screen (SH-05). Newest sit at the bottom, nearest the eye.
  const hiddenCount = Math.max(0, toasts.length - MAX_VISIBLE_TOASTS);
  const visible = toasts.slice(toasts.length - MAX_VISIBLE_TOASTS);
  const dismissAll = () => {
    for (const toast of toasts) dismiss(toast.id);
  };

  return (
    <Portal>
      <div
        className="pointer-events-none fixed bottom-8 right-4 z-[var(--lx-z-toast)] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label={t("Notifications")}
        aria-live="polite"
        // Hover/focus pauses auto-dismiss so notifications can be read (SH-05).
        onMouseEnter={onPause}
        onMouseLeave={onResume}
        onFocusCapture={onPause}
        onBlurCapture={onResume}
      >
        {/* Stack header: overflow count + one-click "clear all" once the
            stack has more than one toast (saves N individual dismiss clicks). */}
        {(hiddenCount > 0 || toasts.length > 1) && (
          <div className="flex items-center justify-end gap-2 self-end">
            {hiddenCount > 0 && (
              <span className="pointer-events-none rounded-full border border-edge bg-bar px-2 py-0.5 text-xs text-muted shadow-sm">
                {`+${hiddenCount} ${t("more")}`}
              </span>
            )}
            <button
              onClick={dismissAll}
              className="pointer-events-auto rounded-full border border-edge bg-bar px-2 py-0.5 text-xs text-muted shadow-sm hover:bg-raised hover:text-strong"
            >
              {t("Clear all")}
            </button>
          </div>
        )}
        {visible.map((toast) => {
          const Icon = TOAST_ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              // Errors announce assertively (interrupt), everything else politely
              // via the region's aria-live (AX-08).
              role={toast.kind === "error" ? "alert" : "status"}
              className={`lx-toast pointer-events-auto relative flex items-start gap-2 overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-lg shadow-black/20 backdrop-blur ${TOAST_STYLES[toast.kind]} ${toast.leaving ? "lx-toast-leaving" : ""}`}
            >
              <Icon size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words leading-5">{toast.text}</span>
              <button
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 text-muted hover:bg-raised hover:text-strong"
                title={t("Dismiss")}
              >
                <X size={13} />
              </button>
              {/* Auto-dismiss countdown: shrinks over the toast's ttl and
                  freezes while the stack is hovered/focused (timers paused). */}
              {!toast.leaving && (
                <span
                  aria-hidden="true"
                  className="lx-toast-progress absolute bottom-0 left-0 h-0.5 w-full origin-left bg-current opacity-30"
                  style={{ animationDuration: `${toast.ttl}ms`, animationPlayState: paused ? "paused" : "running" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Portal>
  );
}
