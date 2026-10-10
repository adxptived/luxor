import * as ipc from "@/lib/ipc";
import { buildRunGroups, type ProjectProbe, type RunCommand, type RunGroup } from "@/lib/runDetect";

/** Look at the project root and list the run/build/test commands it supports. */
export async function probeRunGroups(root: string): Promise<RunGroup[]> {
  const entries = await ipc.fsListDir(root).catch(() => []);
  const present = entries.filter((e) => !e.is_dir).map((e) => e.name.toLowerCase());
  const readIf = async (name: string): Promise<string | null> =>
    present.includes(name.toLowerCase())
      ? await ipc
          .fsReadText(`${root}/${name}`, 65536)
          .then((f) => f.content)
          .catch(() => null)
      : null;
  const probe: ProjectProbe = {
    cargoToml: await readIf("Cargo.toml"),
    packageJson: await readIf("package.json"),
    makefile: (await readIf("Makefile")) ?? (await readIf("makefile")),
    pyproject: await readIf("pyproject.toml"),
    goMod: present.includes("go.mod"),
    requirementsTxt: present.includes("requirements.txt"),
    mainPy: present.includes("main.py"),
    present,
  };
  return buildRunGroups(probe);
}

/** Flatten groups into at most `limit` commands, keeping each group's order. */
export function topCommands(groups: readonly RunGroup[], limit = 8): RunCommand[] {
  const out: RunCommand[] = [];
  const max = Math.max(...groups.map((g) => g.commands.length), 0);
  // Round-robin so one toolchain with many scripts does not crowd out the rest.
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const g of groups) {
      const c = g.commands[i];
      if (c && out.length < limit && !out.some((o) => o.cmd === c.cmd)) out.push(c);
    }
  }
  return out;
}
