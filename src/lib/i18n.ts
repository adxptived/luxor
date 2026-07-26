/**
 * Lightweight i18n. English strings live inline in the components as
 * fallbacks; `t(key, english)` returns the translated string for the active
 * language. The language comes from `config.ui.language` and is applied via
 * `setLanguage()`.
 *
 * Startup optimisation: the ~100 KB Russian dictionary lives in a separate
 * module (`i18n.ru.ts`) and is imported lazily the first time the language is
 * switched to `ru`. English users never fetch or parse it, so it stays off the
 * startup critical path. `t()` remains synchronous — it reads whatever is in
 * `dict`, and `subscribeLanguage()` lets the UI re-render once the RU chunk
 * finishes loading (App also keys its subtree on `getLanguage()`).
 */

import { useSyncExternalStore } from "react";

export type Language = "en" | "ru";

let lang: Language = "en";
/** Active translation table. Empty for English; the RU map once loaded. */
let dict: Record<string, string> = {};
/** Memoized dynamic import of the RU dictionary chunk. */
let ruLoading: Promise<void> | null = null;
/** Bumped whenever the effective translations change (RU load / lang switch). */
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const cb of listeners) cb();
}

/** Subscribe to translation changes (drives `useSyncExternalStore`). */
export function subscribeLanguage(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Monotonic snapshot for `useSyncExternalStore`. */
export function getLanguageVersion(): number {
  return version;
}

export function getLanguage(): Language {
  return lang;
}

/**
 * BCP-47 locale for `Intl` / `toLocale*` date & number formatting, derived from
 * the active UI language rather than the OS. Without this, `toLocaleDateString`
 * falls back to the system locale, so an English UI on a Russian OS still
 * renders "Пятница, 3 Июля" in the clock and "окт., нояб." in the heatmap.
 */
export function getLocale(): string {
  return lang === "ru" ? "ru-RU" : "en-US";
}

/**
 * Set the active language, lazily loading the RU dictionary chunk on first use.
 * Returns a promise that resolves once translations are ready; callers in a
 * render body can safely ignore it — `subscribeLanguage()` drives the re-render
 * when the RU chunk arrives. Awaiting it (e.g. before dismissing the splash or
 * remounting on a Settings change) avoids a brief English flash.
 */
export function setLanguage(next: string): Promise<void> {
  const target: Language = next === "ru" ? "ru" : "en";
  const changed = target !== lang;
  lang = target;
  if (target === "ru" && Object.keys(dict).length === 0) {
    // Load once; notify when the dictionary is available.
    ruLoading ??= import("./i18n.ru").then((m) => {
      dict = m.RU;
      notify();
    });
    return ruLoading;
  }
  // English (or RU already loaded): only re-notify on an actual change so a
  // render-body call every frame can't create a re-render loop.
  if (changed) notify();
  return Promise.resolve();
}

/**
 * Translate a string. Two forms:
 * - `t("some.key", "English text")` — keyed entry (stable across rewordings);
 * - `t("English text")` — gettext style, the English string is the key.
 */
export function t(key: string, english?: string): string {
  const src = english ?? key;
  if (lang === "en") return src;
  return dict[key] ?? dict[src] ?? src;
}

/**
 * Reactive `t` for components that must re-render when the language changes.
 *
 * Plain `t()` reads module state, so a component only picks up a new language if
 * something else re-renders it. That is true for the vast majority of the tree
 * (App re-renders on a language switch and almost nothing is memoized), but a
 * `memo`-wrapped component whose props did not change would keep showing the old
 * language. Such components must call `useT()` instead of importing `t`.
 *
 * This replaces the previous blunt instrument — `<div key={getLanguage()}>` on
 * the App root — which forced a full remount of the tree and therefore killed
 * every running PTY (TerminalPanel's cleanup calls `ptyKill`), discarded the
 * dockview layout, editor undo history and scroll positions.
 */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLanguage, getLanguageVersion, getLanguageVersion);
  return t;
}

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];
