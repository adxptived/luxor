/**
 * Locale detection utility.
 *
 * Detects the user's preferred language from:
 * 1. Stored config (highest priority — handled by the caller)
 * 2. navigator.language / navigator.languages
 * 3. OS locale via Tauri (if available)
 * 4. Fallback to "en"
 */

import type { Language } from "./i18n";

const SUPPORTED: Language[] = ["en", "ru"];

/** Detect the user's preferred language from the browser/OS. */
export function detectLocale(): Language {
  // 1. Check navigator.languages (most browsers).
  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    for (const lang of langs) {
      const normalized = normalizeLanguageCode(lang);
      if (normalized) return normalized;
    }
  }

  // 2. Check the HTML lang attribute.
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
      const normalized = normalizeLanguageCode(htmlLang);
      if (normalized) return normalized;
    }
  }

  // 3. Fallback.
  return "en";
}

/** Normalize a language code (e.g. "ru-RU", "ru_RU", "Russian") to our Language type. */
export function normalizeLanguageCode(code: string): Language | null {
  if (!code) return null;
  const lower = code.toLowerCase().trim();

  // Direct match.
  if (SUPPORTED.includes(lower as Language)) return lower as Language;

  // Match by prefix (e.g. "ru-RU" → "ru").
  const prefix = lower.split(/[-_]/)[0];
  if (SUPPORTED.includes(prefix as Language)) return prefix as Language;

  // Match by language name.
  if (lower.includes("russian") || lower.includes("русский")) return "ru";
  if (lower.includes("english")) return "en";

  return null;
}

/** Check if a language is supported. */
export function isSupportedLanguage(lang: string): boolean {
  return SUPPORTED.includes(lang as Language);
}

/** Get the display name for a language code in the user's locale. */
export function languageDisplayName(lang: Language): string {
  const names: Record<Language, string> = {
    en: "English",
    ru: "Русский",
  };
  return names[lang] ?? lang;
}