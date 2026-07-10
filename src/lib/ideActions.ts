import type { DetectedIde, IdeEntry } from "@/lib/types";

export const SYSTEM_DEFAULT_IDE = "__default__";
export const FILE_MANAGER_IDE = "__explorer__";

export const SENTINEL_IDES: DetectedIde[] = [
  { command: SYSTEM_DEFAULT_IDE, label: "System default" },
  { command: FILE_MANAGER_IDE, label: "File explorer" },
];

export function isSystemDefaultIde(command: string | null | undefined): boolean {
  return command === SYSTEM_DEFAULT_IDE;
}

export function isFileManagerIde(command: string | null | undefined): boolean {
  return command === FILE_MANAGER_IDE;
}

export function mergeIdeActions(
  custom: IdeEntry[] | null | undefined,
  detected: DetectedIde[] | null | undefined,
  includeSentinels = false,
): DetectedIde[] {
  const list: DetectedIde[] = [];
  const seen = new Set<string>();
  for (const c of custom ?? []) {
    const command = c.command.trim();
    if (!command || seen.has(command)) continue;
    seen.add(command);
    list.push({ command, label: c.label.trim() || command });
  }
  for (const d of detected ?? []) {
    const command = d.command.trim();
    if (!command || seen.has(command)) continue;
    seen.add(command);
    list.push({ command, label: d.label.trim() || command });
  }
  if (includeSentinels) {
    for (const sentinel of SENTINEL_IDES) {
      if (!seen.has(sentinel.command)) {
        seen.add(sentinel.command);
        list.push(sentinel);
      }
    }
  }
  return list;
}

export function ideFallbackLabel(command: string): string {
  if (command === SYSTEM_DEFAULT_IDE) return "System default";
  if (command === FILE_MANAGER_IDE) return "File explorer";
  const base = command.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, "") || command;
  return base
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || command;
}

export function resolveIdeLabel(command: string | null | undefined, candidates: DetectedIde[]): string {
  if (!command) return candidates[0]?.label ?? "IDE";
  return candidates.find((ide) => ide.command === command)?.label ?? ideFallbackLabel(command);
}

export function resolveDefaultIde(candidates: DetectedIde[], preferred: string | null | undefined): DetectedIde | null {
  const command = preferred?.trim();
  if (command) {
    return candidates.find((ide) => ide.command === command) ?? { command, label: ideFallbackLabel(command) };
  }
  return candidates[0] ?? null;
}
