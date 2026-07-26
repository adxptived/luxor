import { describe, expect, test } from "bun:test";

import { HOTKEY_ACTIONS, actionForEvent, hotkeyLookup, normalizeChord } from "./hotkeys";

describe("normalizeChord", () => {
  test("normalizes modifier order", () => {
    expect(normalizeChord("Shift+Ctrl+P")).toBe("Ctrl+Shift+P");
    expect(normalizeChord("Alt+Ctrl+Shift+P")).toBe("Ctrl+Alt+Shift+P");
  });

  test("treats Meta as the cross-platform Ctrl alias", () => {
    expect(normalizeChord("Meta+Shift+P")).toBe("Ctrl+Shift+P");
  });

  test("trims whitespace and ignores empty parts", () => {
    expect(normalizeChord(" Ctrl +  Shift + P ")).toBe("Ctrl+Shift+P");
    expect(normalizeChord("+")).toBe("");
  });
});

describe("actionForEvent", () => {
  const ev = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

  test("resolves a default binding", () => {
    expect(actionForEvent(ev({ ctrlKey: true, shiftKey: true, code: "KeyP" }), null)).toBe(
      "palette",
    );
    expect(actionForEvent(ev({ ctrlKey: true, code: "Backquote" }), null)).toBe("terminal.new");
    expect(actionForEvent(ev({ ctrlKey: true, code: "KeyW" }), null)).toBe("tab.close");
  });

  test("returns undefined for unbound and modifier-only events", () => {
    expect(actionForEvent(ev({ code: "KeyQ" }), null)).toBeUndefined();
    // Bare modifiers cannot form a chord.
    expect(actionForEvent(ev({ ctrlKey: true, code: "ControlLeft" }), null)).toBeUndefined();
  });

  test("honours a user override and drops the replaced default", () => {
    const config = { hotkeys: [{ action: "palette", chord: "Ctrl+Alt+K" }] } as never;
    expect(actionForEvent(ev({ ctrlKey: true, altKey: true, code: "KeyK" }), config)).toBe(
      "palette",
    );
    expect(
      actionForEvent(ev({ ctrlKey: true, shiftKey: true, code: "KeyP" }), config),
    ).toBeUndefined();
  });

  test("matches the whole action registry, not just a hand-picked subset", () => {
    // Guards the map against silently losing an action during refactors.
    const lookup = hotkeyLookup(null);
    for (const action of HOTKEY_ACTIONS) {
      expect([...lookup.values()]).toContain(action.id);
    }
  });
});
