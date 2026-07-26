import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_DISCORD_SETTINGS,
  DEFAULT_DISCORD_TEMPLATES,
  loadDiscordSettings,
  saveDiscordSettings,
} from "./analytics";

/** Minimal in-memory localStorage stand-in for the bun test runtime. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

// Installed with `defineProperty`, not by assignment: Bun exposes a real
// `localStorage` on Linux/macOS as an accessor with no setter, so `globalThis
// .localStorage = …` threw there and took every test in this file down with it
// (green on Windows, where the global simply does not exist).
const g = globalThis as { localStorage?: Storage };
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: fakeStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete g.localStorage;
});

describe("discord settings persistence", () => {
  test("defaults when nothing is stored", () => {
    expect(loadDiscordSettings()).toEqual(DEFAULT_DISCORD_SETTINGS);
  });

  test("save → load round-trips (the restart-persistence bug fix)", () => {
    const next = { ...DEFAULT_DISCORD_SETTINGS, enabled: true, rotate_seconds: 30, mask_projects: true };
    saveDiscordSettings(next);
    expect(loadDiscordSettings()).toEqual(next);
  });

  test("malformed stored JSON falls back to defaults", () => {
    g.localStorage!.setItem("luxor.discord.settings", "{not json");
    expect(loadDiscordSettings()).toEqual(DEFAULT_DISCORD_SETTINGS);
  });

  test("partial stored payloads are backfilled with defaults", () => {
    g.localStorage!.setItem("luxor.discord.settings", JSON.stringify({ enabled: true }));
    const loaded = loadDiscordSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.rotate_seconds).toBe(DEFAULT_DISCORD_SETTINGS.rotate_seconds);
    expect(loaded.client_id).toBe(DEFAULT_DISCORD_SETTINGS.client_id);
  });

  test("load returns a copy — mutating it does not poison later loads", () => {
    const a = loadDiscordSettings();
    a.enabled = !DEFAULT_DISCORD_SETTINGS.enabled;
    expect(loadDiscordSettings().enabled).toBe(DEFAULT_DISCORD_SETTINGS.enabled);
  });

  test("RPC is enabled by default (always-on presence out of the box)", () => {
    // The original "RPC doesn't work" report: a fresh install sat at
    // enabled:false until the user found the Analytics panel toggle.
    expect(DEFAULT_DISCORD_SETTINGS.enabled).toBe(true);
    expect(loadDiscordSettings().enabled).toBe(true);
  });

  test("a stored explicit opt-out is respected over the new default", () => {
    g.localStorage!.setItem(
      "luxor.discord.settings",
      JSON.stringify({ ...DEFAULT_DISCORD_SETTINGS, enabled: false }),
    );
    expect(loadDiscordSettings().enabled).toBe(false);
  });
});

describe("discord status templates", () => {
  test("default templates are English", () => {
    for (const value of Object.values(DEFAULT_DISCORD_TEMPLATES)) {
      // No Cyrillic in any default status text.
      expect(/[а-яА-ЯёЁ]/.test(value)).toBe(false);
    }
    expect(DEFAULT_DISCORD_TEMPLATES.idle_details).toBe("Idle");
  });

  test("custom templates round-trip through persistence", () => {
    const next = {
      ...DEFAULT_DISCORD_SETTINGS,
      templates: { ...DEFAULT_DISCORD_TEMPLATES, idle_details: "AFK, brb" },
    };
    saveDiscordSettings(next);
    expect(loadDiscordSettings().templates.idle_details).toBe("AFK, brb");
    // Untouched fields keep their defaults.
    expect(loadDiscordSettings().templates.project_details).toBe(
      DEFAULT_DISCORD_TEMPLATES.project_details,
    );
  });

  test("settings persisted before templates existed are backfilled", () => {
    // Simulates a user upgrading from a version without the templates field.
    g.localStorage!.setItem(
      "luxor.discord.settings",
      JSON.stringify({ enabled: true, rotate_seconds: 20 }),
    );
    const loaded = loadDiscordSettings();
    expect(loaded.templates).toEqual(DEFAULT_DISCORD_TEMPLATES);
  });

  test("a partial stored templates object is backfilled per-field", () => {
    g.localStorage!.setItem(
      "luxor.discord.settings",
      JSON.stringify({ templates: { agent_details: "vibing with {agent}" } }),
    );
    const loaded = loadDiscordSettings();
    expect(loaded.templates.agent_details).toBe("vibing with {agent}");
    expect(loaded.templates.idle_details).toBe(DEFAULT_DISCORD_TEMPLATES.idle_details);
  });

  test("default settings object exposes a fresh templates copy", () => {
    const a = loadDiscordSettings();
    a.templates.idle_details = "mutated";
    expect(loadDiscordSettings().templates.idle_details).toBe(
      DEFAULT_DISCORD_TEMPLATES.idle_details,
    );
  });
});
