/**
 * Settings profiles: named, switchable configuration presets.
 *
 * Each profile stores a complete AppConfig snapshot. Users can create
 * profiles like "Dark mode + large fonts", "Light mode + compact",
 * "Presentation", etc., and switch between them instantly.
 */

import type { AppConfig } from "./types";

export interface SettingsProfile {
  id: string;
  name: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last modification. */
  modifiedAt: string;
  /** The config snapshot. */
  config: AppConfig;
  /** Optional description. */
  description?: string;
}

const STORAGE_KEY = "luxor.settingsProfiles";
const MAX_PROFILES = 20;

/** Load all saved profiles. */
export function loadProfiles(): SettingsProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is SettingsProfile =>
      typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.name === "string",
    );
  } catch {
    return [];
  }
}

/** Save all profiles. */
export function saveProfiles(profiles: SettingsProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.slice(0, MAX_PROFILES)));
  } catch { /* best effort */ }
}

/** Create a new profile from the current config. */
export function createProfile(name: string, config: AppConfig, description?: string): SettingsProfile {
  const now = new Date().toISOString();
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    modifiedAt: now,
    config: JSON.parse(JSON.stringify(config)),
    description,
  };
}

/** Update an existing profile's config. */
export function updateProfile(id: string, config: AppConfig, name?: string): SettingsProfile[] {
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return profiles;
  profiles[idx] = {
    ...profiles[idx],
    config: JSON.parse(JSON.stringify(config)),
    name: name ?? profiles[idx].name,
    modifiedAt: new Date().toISOString(),
  };
  saveProfiles(profiles);
  return profiles;
}

/** Delete a profile by id. */
export function deleteProfile(id: string): SettingsProfile[] {
  const profiles = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(profiles);
  return profiles;
}

// ---------------------------------------------------------------------------
// URL-based config sharing
// ---------------------------------------------------------------------------

/**
 * Encode a config into a compact URL-safe string.
 * Uses base64 of the JSON config, with URL-safe characters.
 */
export function encodeConfigToUrl(config: AppConfig): string {
  try {
    const json = JSON.stringify(config);
    // Use btoa with Unicode-safe encoding.
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const urlSafe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `luxor://settings#${urlSafe}`;
  } catch {
    return "";
  }
}

/**
 * Decode a config from a URL hash string.
 * Returns null if the string is not a valid Luxor settings URL.
 */
export function decodeConfigFromUrl(url: string): AppConfig | null {
  try {
    const hashIdx = url.indexOf("#");
    if (hashIdx === -1) return null;
    const encoded = url.slice(hashIdx + 1);
    // Restore standard base64.
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    const config = JSON.parse(json);
    if (typeof config === "object" && config !== null && "theme" in config) {
      return config as AppConfig;
    }
    return null;
  } catch {
    return null;
  }
}