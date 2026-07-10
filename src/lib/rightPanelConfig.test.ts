import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ENABLED,
  RIGHT_WIDGET_IDS,
  defaultRightPanelConfig,
  moveWidget,
  normalizeAccent,
  parseRightPanelConfig,
  sanitizeOptions,
  serializeRightPanelConfig,
  setWidgetAccent,
  setWidgetEnabled,
  setWidgetOptions,
  toLegacyWidgetList,
} from "./rightPanelConfig";

describe("defaults", () => {
  test("default config contains every widget exactly once", () => {
    const cfg = defaultRightPanelConfig();
    expect(cfg.widgets.map((w) => w.id)).toEqual([...RIGHT_WIDGET_IDS]);
  });

  test("default enabled set matches DEFAULT_ENABLED", () => {
    const cfg = defaultRightPanelConfig();
    const enabled = cfg.widgets.filter((w) => w.enabled).map((w) => w.id);
    expect(enabled.sort()).toEqual([...DEFAULT_ENABLED].sort());
  });
});

describe("parse / migrate", () => {
  test("round-trips through serialize", () => {
    let cfg = defaultRightPanelConfig();
    cfg = setWidgetEnabled(cfg, "system", true);
    cfg = setWidgetAccent(cfg, "git", "#1971C2");
    cfg = setWidgetOptions(cfg, "clock", { hour12: true, show_seconds: false });
    cfg = moveWidget(cfg, "notes", 0);
    const parsed = parseRightPanelConfig(serializeRightPanelConfig(cfg), []);
    expect(parsed).toEqual(cfg);
  });

  test("empty blob + empty legacy list = defaults", () => {
    expect(parseRightPanelConfig("", [])).toEqual(defaultRightPanelConfig());
  });

  test("invalid JSON falls back to legacy migration", () => {
    const cfg = parseRightPanelConfig("{oops", ["git", "clock"]);
    expect(toLegacyWidgetList(cfg)).toEqual(["git", "clock"]);
    // Every other widget is present but disabled.
    expect(cfg.widgets).toHaveLength(RIGHT_WIDGET_IDS.length);
  });

  test("legacy migration preserves order and drops unknown ids", () => {
    const cfg = parseRightPanelConfig("", ["notes", "bogus", "git"]);
    expect(toLegacyWidgetList(cfg)).toEqual(["notes", "git"]);
    expect(cfg.widgets[0].id).toBe("notes");
    expect(cfg.widgets[1].id).toBe("git");
  });

  test("duplicate widget entries are ignored", () => {
    const json = JSON.stringify({
      widgets: [
        { id: "git", enabled: true },
        { id: "git", enabled: false, accent: "#e03131" },
      ],
    });
    const cfg = parseRightPanelConfig(json, []);
    const gits = cfg.widgets.filter((w) => w.id === "git");
    expect(gits).toHaveLength(1);
    expect(gits[0].enabled).toBe(true);
  });

  test("unknown widget ids in the blob are dropped, missing ones appended disabled", () => {
    const json = JSON.stringify({ widgets: [{ id: "flux-capacitor", enabled: true }, { id: "clock", enabled: true }] });
    const cfg = parseRightPanelConfig(json, []);
    expect(cfg.widgets.map((w) => w.id).sort()).toEqual([...RIGHT_WIDGET_IDS].sort());
    expect(cfg.widgets.find((w) => w.id === "clock")?.enabled).toBe(true);
  });

  test("all-disabled config re-enables the defaults instead of an empty panel", () => {
    const json = JSON.stringify({ widgets: RIGHT_WIDGET_IDS.map((id) => ({ id, enabled: false })) });
    const cfg = parseRightPanelConfig(json, []);
    expect(toLegacyWidgetList(cfg).sort()).toEqual([...DEFAULT_ENABLED].sort());
  });

  test("density falls back to comfortable for unknown values", () => {
    const cfg = parseRightPanelConfig(JSON.stringify({ widgets: [], density: "cozy" }), []);
    expect(cfg.density).toBe("comfortable");
  });
});

describe("accents", () => {
  test("normalizeAccent lowercases valid hex and rejects everything else", () => {
    expect(normalizeAccent("#1971C2")).toBe("#1971c2");
    expect(normalizeAccent("#fff")).toBeNull();
    expect(normalizeAccent("red")).toBeNull();
    expect(normalizeAccent(42)).toBeNull();
    expect(normalizeAccent(null)).toBeNull();
  });

  test("setWidgetAccent stores normalized hex and clears with null", () => {
    let cfg = defaultRightPanelConfig();
    cfg = setWidgetAccent(cfg, "git", "#E03131");
    expect(cfg.widgets.find((w) => w.id === "git")?.accent).toBe("#e03131");
    cfg = setWidgetAccent(cfg, "git", null);
    expect(cfg.widgets.find((w) => w.id === "git")?.accent).toBeNull();
  });
});

describe("options sanitization", () => {
  test("clamps row counts and note height", () => {
    expect(sanitizeOptions("tasks", { max_items: 999 }).max_items).toBe(20);
    expect(sanitizeOptions("tasks", { max_items: -3 }).max_items).toBe(1);
    expect(sanitizeOptions("notes", { height: 10_000 }).height).toBe(400);
  });

  test("timer presets are deduped, clamped and capped at 4", () => {
    const o = sanitizeOptions("timer", { presets: [0, 5, 5, 25, 999, 45, 60] });
    expect(o.presets).toEqual([1, 5, 25, 240]);
  });

  test("non-boolean flags are stripped", () => {
    const o = sanitizeOptions("clock", { hour12: "yes", show_seconds: true });
    expect(o.hour12).toBeUndefined();
    expect(o.show_seconds).toBe(true);
  });

  test("non-object input yields empty options", () => {
    expect(sanitizeOptions("clock", "junk")).toEqual({});
    expect(sanitizeOptions("clock", [1, 2])).toEqual({});
  });
});

describe("update helpers", () => {
  test("moveWidget reorders and clamps the target index", () => {
    const cfg = defaultRightPanelConfig();
    const first = moveWidget(cfg, "embed", 0);
    expect(first.widgets[0].id).toBe("embed");
    const last = moveWidget(cfg, "project", 10_000);
    expect(last.widgets[last.widgets.length - 1].id).toBe("project");
  });

  test("moveWidget is a no-op for same index or unknown id", () => {
    const cfg = defaultRightPanelConfig();
    expect(moveWidget(cfg, "project", 0)).toBe(cfg);
    expect(moveWidget(cfg, "nope" as never, 3)).toBe(cfg);
  });

  test("setWidgetOptions merges patches through sanitization", () => {
    let cfg = defaultRightPanelConfig();
    cfg = setWidgetOptions(cfg, "tasks", { max_items: 8 });
    cfg = setWidgetOptions(cfg, "tasks", { max_items: 50 });
    expect(cfg.widgets.find((w) => w.id === "tasks")?.options.max_items).toBe(20);
  });

  test("update helpers never mutate the input", () => {
    const cfg = defaultRightPanelConfig();
    const snapshot = JSON.parse(JSON.stringify(cfg));
    setWidgetEnabled(cfg, "git", false);
    setWidgetAccent(cfg, "git", "#e03131");
    setWidgetOptions(cfg, "git", { show_counts: false });
    moveWidget(cfg, "git", 5);
    expect(cfg).toEqual(snapshot);
  });
});
