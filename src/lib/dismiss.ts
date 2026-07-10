/**
 * Shared dismissal behavior for non-modal popups (dropdown menus etc.):
 * close on Escape and on any pointerdown outside the popup.
 *
 * Unlike an invisible full-screen backdrop, this never swallows the click —
 * the element under the cursor receives it normally, so a single click both
 * closes the open menu and activates whatever was clicked (fixes "buttons
 * sometimes need two clicks").
 *
 * Phase 4: supports exit animations via the `leavingClass` option. When
 * provided, dismissal adds the CSS class to the popup element, waits for the
 * animation to finish, then calls onClose. This coordinates enter/exit for
 * Command Palette, ProjectSwitcher, Settings, and dialogs.
 */

import { useEffect, useRef, useState } from "react";

export interface DismissOptions {
  /** CSS class to add for exit animation (e.g. "lx-palette-leaving").
   *  When set, onClose is deferred until the animation ends. */
  leavingClass?: string;
}

/**
 * Phase 4: Keeps a component mounted briefly after `open` turns false so an
 * exit animation can play. Returns `mounted` (whether to render) and `leaving`
 * (whether to apply the exit-animation CSS class).
 */
export function useDelayedUnmount(
  open: boolean,
  duration = 200,
): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(open);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    if (open) {
      setLeaving(false);
      mountedRef.current = true;
      setMounted(true);
      return undefined;
    }

    if (!mountedRef.current) {
      setLeaving(false);
      return undefined;
    }

    setLeaving(true);
    timerRef.current = setTimeout(() => {
      setLeaving(false);
      mountedRef.current = false;
      setMounted(false);
      timerRef.current = undefined;
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [open, duration]);

  return { mounted, leaving };
}

export function useDismiss(
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
  options?: DismissOptions,
): void {
  const closingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      return;
    }
    const leavingClass = options?.leavingClass;

    const doClose = () => {
      if (closingRef.current) return;
      const el = ref.current;
      if (leavingClass && el) {
        closingRef.current = true;
        el.classList.add(leavingClass);
        // `done` guards against onEnd running twice: both the animationend
        // listener AND the safety timeout used to invoke it, so onClose()
        // fired twice and the never-cancelled stale timeout could instantly
        // dismiss a popup that had just been reopened.
        let done = false;
        let timeoutId = 0;
        const onEnd = () => {
          if (done) return;
          done = true;
          window.clearTimeout(timeoutId);
          el.removeEventListener("animationend", onEnd);
          el.classList.remove(leavingClass);
          closingRef.current = false;
          onClose();
        };
        el.addEventListener("animationend", onEnd, { once: true });
        // Safety timeout in case animationend doesn't fire
        timeoutId = window.setTimeout(onEnd, 300);
      } else {
        onClose();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) doClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") doClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", doClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", doClose);
    };
  }, [open, onClose, ref, options?.leavingClass]);
}
