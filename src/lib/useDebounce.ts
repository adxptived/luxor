/**
 * Debounce and throttle utilities for expensive operations.
 *
 * `useDebouncedCallback` — returns a stable callback that fires `fn` after
 * `delay` ms of inactivity. Leading-edge option fires immediately on first
 * call then suppresses until quiet.
 *
 * `useDebouncedValue` — returns a value that only updates after `delay` ms
 * of the source value being stable. Ideal for search inputs that trigger
 * expensive filtering or IPC calls.
 *
 * `useThrottledCallback` — fires at most once per `interval` ms. Useful for
 * scroll/resize handlers and layout-change persistence.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
  opts?: { leading?: boolean },
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadingRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const leading = opts?.leading ?? false;

  return useCallback(
    (...args: Parameters<T>) => {
      if (leading && leadingRef.current) {
        leadingRef.current = false;
        fnRef.current(...args);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        leadingRef.current = true;
        if (!leading) fnRef.current(...args);
      }, delay);
    },
     
    [delay, leading],
  ) as T;
}

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useThrottledCallback<T extends (...args: never[]) => void>(
  fn: T,
  interval: number,
): T {
  const lastRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastRef.current >= interval) {
        lastRef.current = now;
        fnRef.current(...args);
      }
    },
     
    [interval],
  ) as T;
}