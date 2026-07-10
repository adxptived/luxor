import { describe, expect, test } from "bun:test";

import { parseConfigImport, serializeConfig } from "./configShare";
import type { AppConfig } from "./types";

/** Minimal config slice good enough for merge tests. */
function fakeConfig(): AppConfig {
  return {
    theme: "dark",
    accent_color: "#e8b059",
    tab_bar_position: "top",
    ui: { zoom: 1, topbar_size: 36, browser_enabled: false, nav_hidden: [] },
    terminal: {
      shell: null,
      external_terminal: null,
      shell_args: [],
      fast_powershell_startup: true,
      font_family: "Cascadia Mono",
      font_size: 14,
      scrollback: 10000,
      webgl: true,
      cursor_style: "block",
      cursor_blink: true,
      copy_on_select: false,
      bell_notifications: true,
      show_stats: true,
    },
    status_bar: { show_cpu: true, refresh_secs: 2 },
    hotkeys: [],
    preferred_editors: [],
    custom_ides: [],
    default_ide: null,
  } as unknown as AppConfig;
}

describe("config export / import", () => {
  test("round-trip preserves the config", () => {
    const cfg = fakeConfig();
    const json = serializeConfig(cfg, "0.4.5");
    const merged = parseConfigImport(json, fakeConfig());
    expect(merged).toEqual(cfg);
  });

  test("envelope metadata is included", () => {
    const parsed = JSON.parse(serializeConfig(fakeConfig(), "0.4.5"));
    expect(parsed.kind).toBe("luxor-settings");
    expect(parsed.app_version).toBe("0.4.5");
    expect(parsed.config.theme).toBe("dark");
  });

  test("imports known keys, drops junk, keeps missing keys", () => {
    const incoming = {
      kind: "luxor-settings",
      config: {
        theme: "nord",
        totally_unknown_key: "evil",
        ui: { zoom: 1.4, unknown_nested: true },
      },
    };
    const merged = parseConfigImport(JSON.stringify(incoming), fakeConfig());
    expect(merged.theme).toBe("nord");
    expect(merged.ui.zoom).toBe(1.4);
    expect(merged.ui.topbar_size).toBe(36); // kept from current
    expect("totally_unknown_key" in merged).toBe(false);
    expect("unknown_nested" in merged.ui).toBe(false);
  });

  test("accepts a bare config object (no envelope)", () => {
    const merged = parseConfigImport(
      JSON.stringify({ theme: "dracula", ui: { zoom: 1.2 } }),
      fakeConfig(),
    );
    expect(merged.theme).toBe("dracula");
    expect(merged.ui.zoom).toBe(1.2);
  });

  test("type mismatches are rejected per-field", () => {
    const current = fakeConfig();
    current.terminal.shell_args = ["-NoExit"];
    const merged = parseConfigImport(
      JSON.stringify({ theme: 42, ui: { zoom: "huge" }, terminal: { shell_args: "-NoLogo" } }),
      current,
    );
    expect(merged.theme).toBe("dark");
    expect(merged.ui.zoom).toBe(1);
    expect(merged.terminal.shell_args).toEqual(["-NoExit"]);
  });

  test("old terminal imports keep defaults for new terminal fields", () => {
    const merged = parseConfigImport(
      JSON.stringify({ terminal: { shell: "pwsh" } }),
      fakeConfig(),
    );
    expect(merged.terminal.shell).toBe("pwsh");
    expect(merged.terminal.external_terminal).toBeNull();
    expect(merged.terminal.shell_args).toEqual([]);
    expect(merged.terminal.fast_powershell_startup).toBe(true);
  });

  test("nullable string fields accept strings and nulls only", () => {
    const current = fakeConfig();
    const imported = parseConfigImport(
      JSON.stringify({ terminal: { shell: "pwsh", external_terminal: "wt.exe" }, default_ide: "code" }),
      current,
    );
    expect(imported.terminal.shell).toBe("pwsh");
    expect(imported.terminal.external_terminal).toBe("wt.exe");
    expect(imported.default_ide).toBe("code");
    const rejected = parseConfigImport(
      JSON.stringify({ terminal: { shell: 42, external_terminal: false }, default_ide: [] }),
      imported,
    );
    expect(rejected.terminal.shell).toBe("pwsh");
    expect(rejected.terminal.external_terminal).toBe("wt.exe");
    expect(rejected.default_ide).toBe("code");
  });

  test("known arrays reject invalid item shapes", () => {
    const current = fakeConfig();
    current.hotkeys = [{ action: "command_palette", chord: "Ctrl+K" }];
    const merged = parseConfigImport(
      JSON.stringify({ hotkeys: ["bad"], terminal: { shell_args: ["-NoLogo", 42] } }),
      current,
    );
    expect(merged.hotkeys).toEqual(current.hotkeys);
    expect(merged.terminal.shell_args).toEqual([]);
  });

  test("garbage input throws a friendly error", () => {
    expect(() => parseConfigImport("not json at all", fakeConfig())).toThrow("Not a valid JSON file");
    expect(() => parseConfigImport("[1,2,3]", fakeConfig())).toThrow("Not a Luxor settings file");
    expect(() => parseConfigImport('{"foo":1}', fakeConfig())).toThrow("Not a Luxor settings file");
  });
});
