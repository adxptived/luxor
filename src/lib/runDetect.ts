/**
 * Project run/build detection for the Dev Tools → Run tab.
 *
 * Pure, dependency-free parsers + a `buildRunGroups` aggregator so the whole
 * "which commands can I run here" decision is unit-tested without any IO. The
 * panel does the file reads and feeds the raw text/flags in here.
 */

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface RunCommand {
  /** Button label. */
  label: string;
  /** Shell command run in a new integrated terminal tab. */
  cmd: string;
  /** Optional one-line hint (tooltip). */
  hint?: string;
}

export interface RunGroup {
  /** Toolchain name, e.g. "Cargo", "npm scripts". */
  tool: string;
  commands: RunCommand[];
}

/** Files we probe at the project root (presence + contents where useful). */
export interface ProjectProbe {
  cargoToml?: string | null;
  packageJson?: string | null;
  makefile?: string | null;
  pyproject?: string | null;
  goMod?: boolean;
  requirementsTxt?: boolean;
  mainPy?: boolean;
  /** Lockfile / marker filenames present at root (lowercased basename). */
  present: string[];
}

/** Detect the JS package manager from the lockfiles present at the root. */
export function detectPackageManager(present: string[]): PackageManager {
  const set = new Set(present.map((p) => p.toLowerCase()));
  if (set.has("bun.lock") || set.has("bun.lockb")) return "bun";
  if (set.has("pnpm-lock.yaml")) return "pnpm";
  if (set.has("yarn.lock")) return "yarn";
  return "npm";
}

/** The `run` prefix a package manager uses to invoke a script. */
export function pmRun(pm: PackageManager): string {
  // npm needs `npm run <s>`; the others accept the bare script name but
  // `<pm> run <s>` is valid everywhere and unambiguous.
  return `${pm} run`;
}

/** Parse the `scripts` map of a package.json into ordered script names. */
export function parsePackageScripts(packageJson: string): string[] {
  try {
    const json = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
    if (!json.scripts || typeof json.scripts !== "object") return [];
    return Object.keys(json.scripts).filter((k) => typeof json.scripts![k] === "string");
  } catch {
    return [];
  }
}

/** Extract `[[bin]] name = "..."` entries from a Cargo.toml (workspaces/multi-bin). */
export function parseCargoBins(cargoToml: string): string[] {
  const bins: string[] = [];
  // Walk [[bin]] tables and grab the first `name = "..."` after each header.
  const sections = cargoToml.split(/\[\[bin\]\]/g).slice(1);
  for (const sec of sections) {
    // Stop at the next table header so we don't read a sibling table's name.
    const upToNextTable = sec.split(/\n\s*\[/)[0] ?? sec;
    const m = upToNextTable.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m && !bins.includes(m[1])) bins.push(m[1]);
  }
  return bins;
}

/** Parse top-level Make targets (`target:`), skipping `.PHONY` & pattern rules. */
export function parseMakeTargets(makefile: string): string[] {
  const targets: string[] = [];
  for (const line of makefile.split("\n")) {
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/);
    if (!m) continue;
    const name = m[1];
    if (name.startsWith(".") || targets.includes(name)) continue;
    targets.push(name);
  }
  return targets;
}

/** Build the ordered groups of runnable commands for a probed project. */
export function buildRunGroups(probe: ProjectProbe): RunGroup[] {
  const groups: RunGroup[] = [];

  // --- Rust / Cargo --------------------------------------------------------
  if (probe.cargoToml != null) {
    const bins = parseCargoBins(probe.cargoToml);
    const cmds: RunCommand[] = [];
    if (bins.length > 1) {
      // Multi-bin: `cargo run` is ambiguous, so offer one button per binary.
      for (const b of bins) cmds.push({ label: `run ${b}`, cmd: `cargo run --bin ${b}` });
    } else {
      cmds.push({ label: "run", cmd: "cargo run", hint: "Build + run (debug)" });
    }
    cmds.push(
      { label: "run --release", cmd: "cargo run --release", hint: "Optimized build + run" },
      { label: "build", cmd: "cargo build" },
      { label: "build --release", cmd: "cargo build --release" },
      { label: "test", cmd: "cargo test" },
      { label: "check", cmd: "cargo check", hint: "Fast type-check, no codegen" },
      { label: "clippy", cmd: "cargo clippy" },
      { label: "fmt", cmd: "cargo fmt" },
    );
    groups.push({ tool: "Cargo", commands: cmds });
  }

  // --- Node / JS scripts ---------------------------------------------------
  if (probe.packageJson != null) {
    const pm = detectPackageManager(probe.present);
    const run = pmRun(pm);
    const scripts = parsePackageScripts(probe.packageJson);
    // Surface the common dev-loop scripts first, then the rest.
    const priority = ["dev", "start", "build", "test", "lint", "preview", "typecheck"];
    const ordered = [
      ...priority.filter((s) => scripts.includes(s)),
      ...scripts.filter((s) => !priority.includes(s)),
    ];
    const cmds: RunCommand[] = [{ label: "install", cmd: `${pm} install` }];
    for (const s of ordered) cmds.push({ label: s, cmd: `${run} ${s}` });
    groups.push({ tool: `${pm} scripts`, commands: cmds });
  }

  // --- Go ------------------------------------------------------------------
  if (probe.goMod) {
    groups.push({
      tool: "Go",
      commands: [
        { label: "run", cmd: "go run ." },
        { label: "build", cmd: "go build ./..." },
        { label: "test", cmd: "go test ./..." },
      ],
    });
  }

  // --- Python --------------------------------------------------------------
  if (probe.pyproject != null || probe.requirementsTxt || probe.mainPy) {
    const cmds: RunCommand[] = [];
    if (probe.mainPy) cmds.push({ label: "run main.py", cmd: "python main.py" });
    if (probe.requirementsTxt)
      cmds.push({ label: "pip install", cmd: "pip install -r requirements.txt" });
    if (probe.pyproject != null) {
      const poetry = /\[tool\.poetry\]/.test(probe.pyproject);
      if (poetry) {
        cmds.push({ label: "poetry install", cmd: "poetry install" });
      } else {
        cmds.push({ label: "pip install .", cmd: "pip install ." });
      }
    }
    if (cmds.length) groups.push({ tool: "Python", commands: cmds });
  }

  // --- Make ----------------------------------------------------------------
  if (probe.makefile != null) {
    const targets = parseMakeTargets(probe.makefile).slice(0, 12);
    if (targets.length)
      groups.push({
        tool: "Make",
        commands: targets.map((tg) => ({ label: tg, cmd: `make ${tg}` })),
      });
  }

  return groups;
}

/** Profile (debug/release/—) inferred from a built executable's path. */
export function exeProfile(path: string): "debug" | "release" | null {
  const p = path.replace(/\\/g, "/");
  if (/\/release\//.test(p)) return "release";
  if (/\/debug\//.test(p)) return "debug";
  return null;
}

/** Basename of an executable path (for display). */
export function exeName(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1) || path;
}
