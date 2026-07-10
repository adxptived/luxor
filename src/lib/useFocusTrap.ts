/**
 * Focus trap hook for modal dialogs.
 *
 * When active, Tab/Shift+Tab cycles focus within the container, and the
 * first focusable element is focused on mount. Esc is handled by the
 * caller (the hook does not close the modal — it just traps focus).
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open);
 *   <div ref={ref} role="dialog" aria-modal="true">…</div>
 */

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  opts?: { initialFocus?: React.RefObject<HTMLElement | null> },
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement;

    // Focus the initial target or the first focusable element.
    const focusInitial = opts?.initialFocus?.current;
    if (focusInitial) {
      focusInitial.focus();
    } else {
      const focusable = container.querySelector<HTMLElement>(FOCUSABLE);
      focusable?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the element that had it before the modal opened.
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}