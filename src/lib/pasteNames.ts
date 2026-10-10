/**
 * Name for a pasted copy inside a folder that already holds `taken` names:
 * the original name when free, otherwise "stem copy", "stem copy 2", …
 */
export function pasteName(name: string, isDir: boolean, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = isDir ? -1 : name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i <= 999; i++) {
    const candidate = `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} copy ${Date.now()}${ext}`;
}
