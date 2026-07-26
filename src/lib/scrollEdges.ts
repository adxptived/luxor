/**
 * Scroll-edge detection for the sidebar's scrollable stacks (project tab strip,
 * nav button stack). Drives the fade hints that tell the user there is more
 * content above/below (or left/right) of what the container currently shows.
 */

import { useEffect, useState, type RefObject } from "react";

export interface ScrollEdges {
  /** Scrolled away from the top (vertical) / left (horizontal) edge. */
  start: boolean;
  /** More content past the bottom (vertical) / right (horizontal) edge. */
  end: boolean;
}

/**
 * Track whether `ref`'s scroll container is scrolled away from either edge.
 *
 * `deps` re-runs the measurement when the content changes (e.g. a tab was
 * opened): a ResizeObserver on the container alone does not fire when only its
 * children grow.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  axis: "x" | "y",
  deps: unknown[] = [],
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const [pos, client, scroll] =
        axis === "y"
          ? [el.scrollTop, el.clientHeight, el.scrollHeight]
          : [el.scrollLeft, el.clientWidth, el.scrollWidth];
      setEdges((prev) => {
        const start = pos > 2;
        const end = pos + client < scroll - 2;
        // Bail out on no-ops: this runs from a ResizeObserver, and a fresh
        // object every time would re-render the (large) sidebar on each frame.
        return prev.start === start && prev.end === end ? prev : { start, end };
      });
    };
    check();
    // Defer the observer callback to the next frame: `check` sets state that
    // toggles the fade hints and can change the container's own layout, which
    // would re-enter the observer synchronously and fire the
    // "ResizeObserver loop completed" warning.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    });
    ro.observe(el);
    // Observe the children too, so growing content (not just a resized
    // container) updates the hints.
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, axis, ...deps]);

  return edges;
}
