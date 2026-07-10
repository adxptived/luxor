/**
 * Pure helpers for the database panel: export formatting, sort-state cycling
 * and pagination math. Kept side-effect free so they are unit-testable without
 * a backend or a DOM.
 */

export interface SortState {
  column: string;
  desc: boolean;
}

/**
 * Cycle a column's sort when its header is clicked:
 * none → asc → desc → none. Clicking a different column starts at asc.
 */
export function nextSort(current: SortState | null, column: string): SortState | null {
  if (!current || current.column !== column) return { column, desc: false };
  if (!current.desc) return { column, desc: true };
  return null;
}

/** Total number of pages for `total` rows at `pageSize` per page (min 1). */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Human range label like `1–200 of 1,024` (1-based, clamped to total). */
export function formatRange(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "0 of 0";
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return `${start.toLocaleString()}\u2013${end.toLocaleString()} of ${total.toLocaleString()}`;
}

/** Quote a single CSV field, escaping per RFC 4180 only when needed. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Render columns + rows as CSV text (CRLF line endings). */
export function toCsv(columns: string[], rows: string[][]): string {
  const head = columns.map(csvField).join(",");
  const body = rows.map((r) => r.map(csvField).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

/** Render columns + rows as a pretty JSON array of objects. */
export function toJson(columns: string[], rows: string[][]): string {
  const out = rows.map((r) => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => {
      obj[c] = r[i] ?? "";
    });
    return obj;
  });
  return JSON.stringify(out, null, 2);
}

/** A safe, OS-friendly file name stem from a table or db name. */
export function exportName(base: string): string {
  return base.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}
