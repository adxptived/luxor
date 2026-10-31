/** Editor breadcrumbs (see `breadcrumbs`). */

/**
 * Breadcrumb segments for `path`: relative to the project folder when the file
 * lives inside it (first crumb = project name), else the absolute path. Each
 * crumb carries the absolute path it stands for so a click can reveal it in
 * the Explorer. Pure (unit-tested).
 */
export function breadcrumbs(
  path: string,
  root: string | null,
  rootName: string | null,
): Array<{ label: string; path: string }> {
  const sepChar = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  const r = root ? norm(root) : null;
  const inside = r !== null && r !== "" && (path === r || path.startsWith(`${r}/`) || path.startsWith(`${r}\\`));
  const out: Array<{ label: string; path: string }> = [];
  let acc: string;
  let rest: string;
  if (inside && r) {
    out.push({ label: rootName || r.split(/[\\/]/).filter(Boolean).pop() || r, path: r });
    acc = r;
    rest = path.slice(r.length);
  } else {
    acc = "";
    rest = path;
  }
  const parts = rest.split(/[\\/]/).filter(Boolean);
  const leading = !inside && /^[\\/]/.test(path) ? sepChar : "";
  for (const part of parts) {
    acc = acc ? `${acc}${sepChar}${part}` : `${leading}${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}
