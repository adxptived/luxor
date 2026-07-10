import { describe, expect, test } from "bun:test";

import { SETTINGS_ITEMS, searchSettings } from "./settingsSearch";

describe("searchSettings", () => {
  test("empty query matches nothing (caller shows all sections)", () => {
    expect(searchSettings("").sections).toEqual([]);
    expect(searchSettings("   ").sections).toEqual([]);
  });

  test("finds settings by content, not just section names", () => {
    const r = searchSettings("scrollback");
    expect(r.sections).toEqual(["terminal"]);
    expect(r.matches.terminal).toContain("Scrollback");
  });

  test("finds by keyword synonyms", () => {
    expect(searchSettings("tray").sections).toContain("interface");
    expect(searchSettings("backup").matches.appearance).toContain("Export settings");
    expect(searchSettings("keybindings").sections).toContain("hotkeys");
  });

  test("multi-word queries require every word", () => {
    const r = searchSettings("editor theme");
    expect(r.matches.appearance).toContain("Code editor theme");
    expect(searchSettings("editor zzz").sections).toEqual([]);
  });

  test("case-insensitive", () => {
    expect(searchSettings("SCROLLBACK").sections).toEqual(["terminal"]);
  });

  test("finds terminal shell argument settings", () => {
    expect(searchSettings("shell arguments").matches.terminal).toContain("Shell arguments");
    expect(searchSettings("NoProfile").matches.terminal).toEqual(expect.arrayContaining(["Shell arguments", "Load my PowerShell profile"]));
    expect(searchSettings("fast powershell").matches.terminal).toContain("Load my PowerShell profile");
    expect(searchSettings("oh-my-posh").matches.terminal).toContain("Load my PowerShell profile");
  });

  test("limits hint titles per section", () => {
    const r = searchSettings("e", 2); // matches a lot everywhere
    for (const list of Object.values(r.matches)) {
      expect(list.length).toBeLessThanOrEqual(2);
    }
  });

  test("index covers every section", () => {
    const sections = new Set(SETTINGS_ITEMS.map((i) => i.section));
    for (const s of ["appearance", "interface", "terminal", "git", "launcher", "statusbar", "hotkeys"]) {
      expect(sections.has(s as never)).toBe(true);
    }
  });
});
