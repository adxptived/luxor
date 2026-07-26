/**
 * Keep a node mounted long enough to play an exit animation.
 *
 * Luxor's animations were enter-only: overlays faded/scaled in, then vanished on
 * the same frame they closed. Only four things (modal, palette, dialog, toast)
 * had a leaving state, and each hand-rolled its own timer. Everything else —
 * dropdowns, side panels, right-panel widgets — appeared smoothly and
 * disappeared with a jump cut.
 *
 * Usage:
 *
 *     const { mounted, className } = useEnterExit(open, {
 *       enter: "lx-anim-dropdown",
 *       exit: "lx-anim-dropdown-out",
 *     });
 *     if (!mounted) return null;
 *     return <div className={className}>…</div>;
 *
 * The exit duration is READ FROM THE DOM rather than passed as a magic number,
 * so it automatically collapses to ~0 under `prefers-reduced-motion` (the global
 * rule sets `animation-duration: 0.01ms`) without this hook knowing anything
 * about the preference. A `fallbackMs` ceiling guarantees the node is released
 * even if the animation never fires (display:none, a dropped frame, a browser
 * that skips animations on a hidden tab).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface EnterExitOptions {
  /** Class applied while entering / open. */
  enter: string;
  /** Class applied while playing the exit animation. */
  exit: string;
  /**
   * Hard ceiling before the node is unmounted regardless of animation events.
   * Only a safety net — the real duration comes from the computed style.
   */
  fallbackMs?: number;
}

export interface EnterExitResult {
  /** Whether the node should be in the DOM at all. */
  mounted: boolean;
  /** `enter` while open, `exit` while closing. */
  className: string;
  /** Attach to the animated node to measure its real animation duration. */
  ref: (node: HTMLElement | null) => void;
}

/** Longest animation/transition duration declared on `node`, in ms. */
function playbackMs(node: HTMLElement | null): number {
  if (!node) return 0;
  const style = getComputedStyle(node);
  const parse = (value: string) =>
    value
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        const n = Number.parseFloat(trimmed);
        if (Number.isNaN(n)) return 0;
        return trimmed.endsWith("ms") ? n : n * 1000;
      })
      .reduce((a, b) => Math.max(a, b), 0);
  return Math.max(
    parse(style.animationDuration) + parse(style.animationDelay),
    parse(style.transitionDuration) + parse(style.transitionDelay),
  );
}

export function useEnterExit(open: boolean, options: EnterExitOptions): EnterExitResult {
  const { enter, exit, fallbackMs = 400 } = options;
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    // Measure AFTER the exit class lands, on the next frame, so the duration
    // read belongs to the exit animation and not the enter one.
    const raf = requestAnimationFrame(() => {
      const ms = Math.min(playbackMs(nodeRef.current) || fallbackMs, fallbackMs);
      timerRef.current = setTimeout(() => {
        setMounted(false);
        setLeaving(false);
      }, ms);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `mounted` is read but must not retrigger this effect: it is set by the
    // effect itself, and depending on it would restart the exit timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fallbackMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { mounted, className: leaving ? exit : enter, ref };
}
