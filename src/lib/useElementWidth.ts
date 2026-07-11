import { useEffect, useRef, useState } from "react";

/**
 * Track an element's content width with a ResizeObserver. Lets panels adapt
 * their layout to the *panel* size (not the window), so a narrow split or a
 * small window collapses toolbars/tab bars gracefully.
 *
 * Returns a ref to attach and the latest width in px (0 until first measure).
 */
export function useElementWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let resizeRaf = 0;
    const ro = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries.at(-1)?.contentRect.width ?? el.clientWidth);
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => setWidth(nextWidth));
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
    };
  }, []);

  return { ref, width };
}
