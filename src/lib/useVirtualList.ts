/**
 * Virtual scrolling hook for long lists.
 *
 * Renders only the visible window of items plus an overscan buffer. Works
 * with fixed-height rows. For variable heights, supply a `rowHeights` map
 * keyed by index.
 *
 * Usage:
 *   const { containerRef, totalHeight, offsetY, visibleItems } = useVirtualList({
 *     itemCount: files.length,
 *     rowHeight: 28,
 *     overscan: 8,
 *   });
 *   <div ref={containerRef} onScroll={onScroll} style={{ overflowY: 'auto', maxHeight: '100%' }}>
 *     <div style={{ height: totalHeight, position: 'relative' }}>
 *       <div style={{ transform: `translateY(${offsetY}px)` }}>
 *         {visibleItems.map(({ index, key }) => <Row key={key} data={files[index]} />)}
 *       </div>
 *     </div>
 *   </div>
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface VirtualItem {
  index: number;
  key: string | number;
  /** Top offset in px relative to the scroll content. */
  top: number;
}

export interface VirtualListOptions {
  itemCount: number;
  rowHeight: number;
  /** Extra rows rendered above/below the viewport. Default 10. */
  overscan?: number;
  /** Optional variable heights: index → height in px. Falls back to rowHeight. */
  rowHeights?: Map<number, number>;
}

export interface VirtualListResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  totalHeight: number;
  offsetY: number;
  visibleItems: VirtualItem[];
  scrollToIndex: (index: number) => void;
}

export function useVirtualList(opts: VirtualListOptions): VirtualListResult {
  const { itemCount, rowHeight, overscan = 10, rowHeights } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  const getHeight = useCallback(
    (index: number) => rowHeights?.get(index) ?? rowHeight,
    [rowHeights, rowHeight],
  );

  // Compute cumulative offsets for variable heights.
  const offsets = useRef<number[]>([]);
  const totalHeight = (() => {
    if (!rowHeights || rowHeights.size === 0) return itemCount * rowHeight;
    let sum = 0;
    const arr: number[] = new Array(itemCount + 1);
    arr[0] = 0;
    for (let i = 0; i < itemCount; i++) {
      sum += getHeight(i);
      arr[i + 1] = sum;
    }
    offsets.current = arr;
    return sum;
  })();

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Throttle scroll → state to one update per animation frame. Scroll events
  // can fire far more often than the display refreshes (high-poll mice,
  // trackpads); re-rendering the list on every event causes visible jank.
  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = containerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  useLayoutEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Binary search for the first visible index (variable height).
  const firstVisible = (() => {
    if (!rowHeights || rowHeights.size === 0) {
      return Math.floor(scrollTop / rowHeight);
    }
    let lo = 0;
    let hi = itemCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets.current[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  })();

  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(itemCount, start + visibleCount);

  const visibleItems: VirtualItem[] = [];
  for (let i = start; i < end; i++) {
    const top = rowHeights && rowHeights.size > 0
      ? offsets.current[i] ?? i * rowHeight
      : i * rowHeight;
    visibleItems.push({ index: i, key: i, top });
  }

  const offsetY = rowHeights && rowHeights.size > 0
    ? offsets.current[start] ?? start * rowHeight
    : start * rowHeight;

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const top = rowHeights && rowHeights.size > 0
        ? offsets.current[index] ?? index * rowHeight
        : index * rowHeight;
      el.scrollTo({ top, behavior: "smooth" });
    },
    [rowHeights, rowHeight],
  );

  return { containerRef, onScroll, totalHeight, offsetY, visibleItems, scrollToIndex };
}
