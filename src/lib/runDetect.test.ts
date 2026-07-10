import { describe, expect, it } from "bun:test";

import {
  buildRunGroups,
  detectPackageManager,
  exeName,
  exeProfile,
  parseCargoBins,
  parseMakeTargets,
  parsePackageScripts,
  pmRun,
} from "./runDetect";

describe("detectPackageManager", () => {
  it("prefers bun, then pnpm, then yarn, else npm", () => {
    expect(detectPackageManager(["bun.lock"])).toBe("bun");
    expect(detectPackageManager(["bun.lockb"])).toBe("bun");
    expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
    expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
    expect(detectPackageManager(["package-lock.json"])).toBe("npm");
    expect(detectPackageManager([])).toBe("npm");
  });
  it("is case-insensitive", () => {
    expect(detectPackageManager(["Bun.Lock"])).toBe("bun");
  });
});

describe("pmRun", () => {
  it("always produces a valid `<pm> run` prefix", () => {
    expect(pmRun("npm")).toBe("npm run");
    expect(pmRun("bun")).toBe("bun run");
  });
});

describe("parsePackageScripts", () => {
  it("returns string-valued script names in order", () => {
    const json = JSON.stringify({ scripts: { dev: "vite", build: "vite build", bad: 5 } });
    expect(parsePackageScripts(json)).toEqual(["dev", "build"]);
  });
  it("tolerates missing scripts and invalid JSON", () => {
    expect(parsePackageScripts("{}")).toEqual([]);
    expect(parsePackageScripts("not json")).toEqual([]);
  });
});

describe("parseCargoBins", () => {
  it("extracts each [[bin]] name once", () => {
    const toml = `
[package]
name = "app"

[[bin]]
name = "server"
path = "src/server.rs"

[[bin]]
name = "cli"
`;
    expect(parseCargoBins(toml)).toEqual(["server", "cli"]);
  });
  it("returns [] when no [[bin]] tables exist", () => {
    expect(parseCargoBins(`[package]\nname = "x"`)).toEqual([]);
  });
  it("does not leak a sibling table's name", () => {
    const toml = `[[bin]]\npath = "src/a.rs"\n[dependencies]\nname = "nope"`;
    expect(parseCargoBins(toml)).toEqual([]);
  });
});

describe("parseMakeTargets", () => {
  it("collects real targets, skips .PHONY and assignments", () => {
    const mk = `.PHONY: build test\nCC = gcc\nbuild:\n\tcargo build\ntest: build\n\tcargo test\n`;
    expect(parseMakeTargets(mk)).toEqual(["build", "test"]);
  });
});

describe("buildRunGroups", () => {
  it("offers the cargo dev loop for a single-bin crate", () => {
    const groups = buildRunGroups({ cargoToml: `[package]\nname = "x"`, present: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].tool).toBe("Cargo");
    const cmds = groups[0].commands.map((c) => c.cmd);
    expect(cmds).toContain("cargo run");
    expect(cmds).toContain("cargo run --release");
    expect(cmds).toContain("cargo clippy");
  });

  it("uses --bin per binary for multi-bin crates", () => {
    const toml = `[[bin]]\nname = "a"\n[[bin]]\nname = "b"`;
    const groups = buildRunGroups({ cargoToml: toml, present: [] });
    const cmds = groups[0].commands.map((c) => c.cmd);
    expect(cmds).toContain("cargo run --bin a");
    expect(cmds).toContain("cargo run --bin b");
    expect(cmds).not.toContain("cargo run");
  });

  it("maps package.json scripts through the detected package manager", () => {
    const pkg = JSON.stringify({ scripts: { dev: "vite", custom: "node x" } });
    const groups = buildRunGroups({ packageJson: pkg, present: ["bun.lock"] });
    expect(groups[0].tool).toBe("bun scripts");
    const cmds = groups[0].commands.map((c) => c.cmd);
    expect(cmds[0]).toBe("bun install");
    expect(cmds).toContain("bun run dev");
    expect(cmds).toContain("bun run custom");
    // priority script "dev" comes before the non-priority "custom"
    expect(cmds.indexOf("bun run dev")).toBeLessThan(cmds.indexOf("bun run custom"));
  });

  it("combines multiple toolchains in a polyglot repo", () => {
    const groups = buildRunGroups({
      cargoToml: `[package]\nname="x"`,
      goMod: true,
      makefile: "build:\n\tgo build",
      present: [],
    });
    expect(groups.map((g) => g.tool)).toEqual(["Cargo", "Go", "Make"]);
  });

  it("returns nothing for an unrecognized project", () => {
    expect(buildRunGroups({ present: [] })).toEqual([]);
  });
});

describe("exe helpers", () => {
  it("infers profile from the path", () => {
    expect(exeProfile("/p/target/release/app")).toBe("release");
    expect(exeProfile("C:\\p\\target\\debug\\app.exe")).toBe("debug");
    expect(exeProfile("/p/bin/tool")).toBeNull();
  });
  it("takes the basename for display", () => {
    expect(exeName("/p/target/debug/app")).toBe("app");
    expect(exeName("C:\\p\\target\\debug\\app.exe")).toBe("app.exe");
  });
});
