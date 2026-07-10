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
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}
