/**
 * SQLite database panel: browse data, inspect schema, edit rows in place and
 * run ad-hoc SQL. Editing is row-addressed by `rowid`, so it only lights up for
 * regular (rowid) tables; `WITHOUT ROWID` tables stay read-only.
 */

import { formatNumber } from "@/lib/format";
import type { IDockviewPanelProps } from "dockview";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Copy,
  Database,
  Download,
  KeyRound,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  exportName,
  formatRange,
  nextSort,
  pageCount,
  toCsv,
  toJson,
  type SortState,
} from "@/lib/dbHelpers";
import { t } from "@/lib/i18n";
import * as ipc from "@/lib/ipc";
import { saveTextFile } from "@/lib/ipc";
import type { DbColumn, DbRows, DbTable, DbTableInfo } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive, openContextMenu } from "@/state/uiStore";
import { ErrorState } from "@/components/ErrorState";

const PAGE_SIZES = [50, 100, 200, 500];

/** Small typed localStorage helpers for remembering the user's last choices. */
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / unavailable */
  }
}
/** Per-database key so prefs don't leak between different .db files. */
const dbKey = (path: string, suffix: string) => `luxor.db.${suffix}.${path}`;

export function DbPanel(props: IDockviewPanelProps) {
  const path = (props.params as { path: string }).path;
  const [tables, setTables] = useState<DbTable[]>([]);
  const [table, setTable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlMode, setSqlMode] = useState(false);
  const [view, setView] = useState<"data" | "structure">("data");

  const loadTables = useCallback(async () => {
    try {
      const list = await ipc.dbTables(path);
      setTables(list);
      setError(null);
      setTable((cur) => {
        if (cur && list.some((tb) => tb.name === cur)) return cur;
        // Restore the last table viewed for this database, if it still exists.
        const remembered = lsGet(dbKey(path, "table"));
        if (remembered && list.some((tb) => tb.name === remembered)) return remembered;
        return list[0]?.name ?? null;
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [path]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  if (error && tables.length === 0) {
    return <div className="flex h-full items-center justify-center p-4 text-sm text-muted">{error}</div>;
  }

  return (
    <div className="@container flex h-full bg-surface text-sm">
      {/* Tables sidebar — narrows in tight splits so the data grid keeps room (PN-04). */}
      <div className="flex w-32 shrink-0 flex-col border-r border-edge @sm:w-40 @md:w-44">
        <div className="flex items-center gap-1.5 border-b border-edge px-2 py-1.5 text-xs text-muted">
          <Database size={13} />
          <span className="min-w-0 flex-1 truncate" title={path}>
            {path.split(/[\\/]/).pop()}
          </span>
          <button
            className={`rounded p-0.5 hover:bg-raised hover:text-strong ${sqlMode ? "text-accent" : ""}`}
            onClick={() => setSqlMode((v) => !v)}
            title={t("SQL console")}
          >
            <TerminalSquare size={12} />
          </button>
          <button className="rounded p-0.5 hover:bg-raised hover:text-strong" onClick={() => void loadTables()} title={t("Refresh")}>
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {tables.map((tb) => (
            <button
              key={tb.name}
              onClick={() => {
                setTable(tb.name);
                lsSet(dbKey(path, "table"), tb.name);
                setSqlMode(false);
              }}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left ${
                table === tb.name && !sqlMode ? "bg-raised text-strong" : "text-muted hover:bg-raised hover:text-strong"
              }`}
              title={tb.name}
            >
              <Table2 size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tb.name}</span>
              <span className="shrink-0 text-3xs opacity-70">{tb.rows >= 0 ? formatNumber(tb.rows) : "?"}</span>
            </button>
          ))}
          {tables.length === 0 && <div className="px-2 py-1 text-xs text-muted">{t("No tables.")}</div>}
        </div>
      </div>

      {/* Main pane */}
      {sqlMode ? (
        <SqlConsole path={path} />
      ) : table ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Data / Structure tabs */}
          <div className="flex items-center gap-1 border-b border-edge px-2 py-1 text-xs">
            <TabButton active={view === "data"} onClick={() => setView("data")} icon={Table2}>
              {t("Data")}
            </TabButton>
            <TabButton active={view === "structure"} onClick={() => setView("structure")} icon={ListTree}>
              {t("Structure")}
            </TabButton>
          </div>
          {view === "data" ? (
            <DataView key={table} path={path} table={table} onChanged={() => void loadTables()} />
          ) : (
            <StructureView key={table} path={path} table={table} />
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted">{t("Select a table")}</div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Table2;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2 py-1 ${
        active ? "bg-raised text-strong" : "text-muted hover:bg-raised hover:text-strong"
      }`}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Data view: paginated rows + sort + filter + inline edit + add/delete/export
// ---------------------------------------------------------------------------

function DataView({ path, table, onChanged }: { path: string; table: string; onChanged: () => void }) {
  const toast = useAppStore((s) => s.toast);
  const [pageSize, setPageSizeState] = useState(() => {
    const v = Number(lsGet(dbKey(path, "pageSize")));
    return PAGE_SIZES.includes(v) ? v : 200;
  });
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    lsSet(dbKey(path, "pageSize"), String(n));
  };
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<DbRows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [detail, setDetail] = useState<{ column: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce the filter box so we don't hammer the backend on each keystroke.
  useEffect(() => {
    const id = setTimeout(() => setFilter(filterInput.trim()), 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  // Reset to the first page whenever the query shape changes.
  useEffect(() => setPage(0), [filter, sort, pageSize]);

  const load = useCallback(() => {
    // `reloadKey` is referenced so the callback identity changes when the user
    // hits "reload" — that is what re-runs the fetch effect below.
    void reloadKey;
    let cancelled = false;
    setLoading(true);
    ipc
      .dbRows(path, table, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: sort?.column ?? null,
        desc: sort?.desc ?? false,
        filter: filter || null,
      })
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, table, page, pageSize, sort, filter, reloadKey]);

  useEffect(() => load(), [load]);

  const reload = () => setReloadKey((k) => k + 1);
  const pages = pageCount(rows?.total ?? 0, pageSize);
  const editable = rows?.editable ?? false;

  const saveCell = async (rowIdx: number, colIdx: number, value: string | null) => {
    if (!rows || !editable) return;
    const rowid = rows.rowids?.[rowIdx];
    if (rowid == null) return;
    const column = rows.columns[colIdx];
    try {
      await ipc.dbUpdateCell(path, table, rowid, column, value);
      setRows((cur) => {
        if (!cur) return cur;
        const copy = cur.rows.map((r) => r.slice());
        copy[rowIdx][colIdx] = value ?? "NULL";
        return { ...cur, rows: copy };
      });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setEdit(null);
    }
  };

  const deleteRow = async (rowIdx: number) => {
    if (!rows) return;
    const rowid = rows.rowids?.[rowIdx];
    if (rowid == null) return;
    const ok = await confirmDestructive({ title: t("Delete this row?"), confirmLabel: t("Delete") });
    if (!ok) return;
    try {
      await ipc.dbDeleteRows(path, table, [rowid]);
      reload();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const exportData = async (fmt: "csv" | "json") => {
    if (!rows) return;
    const content = fmt === "csv" ? toCsv(rows.columns, rows.rows) : toJson(rows.columns, rows.rows);
    const name = `${exportName(table)}.${fmt}`;
    const saved = await saveTextFile(name, content);
    if (saved) toast(`${t("Exported")} ${name}`, "success");
  };

  const cellMenu = (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    if (!rows) return;
    const value = rows.rows[rowIdx][colIdx];
    openContextMenu(e, [
      {
        label: t("Copy value"),
        icon: Copy,
        onClick: () => void navigator.clipboard.writeText(value).then(() => toast(t("Copied"), "success")),
      },
      {
        label: t("Copy row (JSON)"),
        icon: Copy,
        onClick: () => {
          const obj: Record<string, string> = {};
          rows.columns.forEach((c, i) => (obj[c] = rows.rows[rowIdx][i]));
          void navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => toast(t("Copied"), "success"));
        },
      },
      { label: t("View full value"), icon: Search, onClick: () => setDetail({ column: rows.columns[colIdx], value }) },
      { separator: true },
      {
        label: t("Edit cell"),
        icon: Pencil,
        disabled: !editable,
        onClick: () => beginEdit(rowIdx, colIdx, value),
      },
      {
        label: t("Set NULL"),
        icon: Ban,
        disabled: !editable,
        onClick: () => void saveCell(rowIdx, colIdx, null),
      },
      { separator: true },
      { label: t("Delete row"), icon: Trash2, danger: true, disabled: !editable, onClick: () => void deleteRow(rowIdx) },
    ]);
  };

  const beginEdit = (rowIdx: number, colIdx: number, value: string) => {
    if (!editable) return;
    setEdit({ row: rowIdx, col: colIdx });
    setEditValue(value === "NULL" ? "" : value);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-2 py-1 text-xs text-muted">
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            placeholder={t("Filter rows…")}
            spellCheck={false}
            className="w-40 rounded border border-edge bg-raised py-0.5 pl-6 pr-5 text-xs text-strong outline-none focus:border-accent"
          />
          {filterInput && (
            <button onClick={() => setFilterInput("")} className="absolute right-1 top-1/2 -translate-y-1/2 hover:text-strong" title={t("Clear")}>
              <X size={11} />
            </button>
          )}
        </div>

        <span className="min-w-0 truncate">
          {formatRange(page, pageSize, rows?.total ?? 0)}
          {!editable && rows && <span className="ml-1 opacity-70">· {t("read-only")}</span>}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {editable && (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong" title={t("Add row")}>
              <Plus size={13} /> {t("Row")}
            </button>
          )}
          <button onClick={() => void exportData("csv")} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong" title={t("Export page as CSV")}>
            <Download size={13} /> CSV
          </button>
          <button onClick={() => void exportData("json")} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-raised hover:text-strong" title={t("Export page as JSON")}>
            <Download size={13} /> JSON
          </button>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded border border-edge bg-raised px-1 py-0.5 text-xs text-strong outline-none"
            title={t("Rows per page")}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <ErrorState compact title={t("Couldn't load rows")} message={error} onRetry={reload} />
        )}
        {rows && rows.rows.length === 0 && !error && (
          <div className="p-3 text-xs text-muted">{filter ? t("No rows match the filter.") : t("Table is empty.")}</div>
        )}
        {rows && rows.rows.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-bar">
              <tr>
                <th className="w-8 border-b border-edge px-2 py-1 text-left font-semibold text-muted">#</th>
                {rows.columns.map((c) => {
                  const active = sort?.column === c;
                  return (
                    <th
                      key={c}
                      onClick={() => setSort((s) => nextSort(s, c))}
                      className="cursor-pointer select-none border-b border-edge px-2 py-1 text-left font-semibold text-strong hover:bg-raised"
                      title={t("Click to sort")}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c}
                        {active && (sort?.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50" : ""}>
              {rows.rows.map((row, i) => (
                <tr key={i} className="group odd:bg-raised/30 hover:bg-raised/60">
                  <td className="border-b border-edge/40 px-2 py-1 text-right font-mono text-3xs text-muted">
                    {page * pageSize + i + 1}
                  </td>
                  {row.map((v, j) => {
                    const isEditing = edit?.row === i && edit?.col === j;
                    const isNull = v === "NULL";
                    return (
                      <td
                        key={j}
                        onDoubleClick={() => beginEdit(i, j, v)}
                        onContextMenu={(e) => cellMenu(e, i, j)}
                        className="max-w-72 border-b border-edge/40 px-2 py-1 font-mono"
                      >
                        {isEditing ? (
                          <CellEditor
                            initial={editValue}
                            onCommit={(val) => void saveCell(i, j, val)}
                            onCancel={() => setEdit(null)}
                          />
                        ) : (
                          <span
                            className={`block truncate ${isNull ? "italic text-muted/60" : "text-muted"}`}
                            title={v}
                            onClick={(e) => {
                              if (e.detail === 1 && v.length > 60) setDetail({ column: rows.columns[j], value: v });
                            }}
                          >
                            {isNull ? "NULL" : v === "" ? "" : v}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && <CellDetail column={detail.column} value={detail.value} onClose={() => setDetail(null)} />}
      {adding && (
        <AddRowModal
          path={path}
          table={table}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        className="rounded p-1 hover:bg-raised hover:text-strong disabled:opacity-30"
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
        title={t("Previous page")}
      >
        ‹
      </button>
      <span className="tabular-nums">
        {page + 1} / {pages}
      </span>
      <button
        className="rounded p-1 hover:bg-raised hover:text-strong disabled:opacity-30"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
        title={t("Next page")}
      >
        ›
      </button>
    </div>
  );
}

/** Inline single-cell text editor. Enter / blur commits, Esc cancels. */
function CellEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      spellCheck={false}
      className="w-full rounded border border-accent bg-surface px-1 py-0.5 font-mono text-xs text-strong outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Structure view: columns + indexes + DDL
// ---------------------------------------------------------------------------

function StructureView({ path, table }: { path: string; table: string }) {
  const [info, setInfo] = useState<DbTableInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this nonce re-runs the loader — the retry affordance.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setInfo(null);
    ipc
      .dbTableInfo(path, table)
      .then((i) => !cancelled && setInfo(i))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path, table, reloadNonce]);

  if (error)
    return (
      <ErrorState
        compact
        title={t("Couldn't load table structure")}
        message={error}
        onRetry={() => setReloadNonce((n) => n + 1)}
      />
    );
  if (!info) return <div className="p-3 text-xs text-muted">{t("Loading…")}</div>;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
      <div className="mb-3 text-muted">
        {formatNumber(info.row_count)} {t("rows")} · {info.columns.length} {t("columns")}
        {!info.has_rowid && <span className="ml-2 rounded bg-raised px-1.5 py-0.5">WITHOUT ROWID</span>}
      </div>

      <div className="mb-1 font-semibold text-strong">{t("Columns")}</div>
      <table className="mb-4 w-full border-collapse">
        <thead>
          <tr className="text-muted">
            {[t("Name"), t("Type"), t("Nullable"), t("Default"), ""].map((h, i) => (
              <th key={i} className="border-b border-edge px-2 py-1 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {info.columns.map((c: DbColumn) => (
            <tr key={c.name} className="odd:bg-raised/30">
              <td className="border-b border-edge/40 px-2 py-1 font-mono text-strong">
                <span className="inline-flex items-center gap-1">
                  {c.pk && <KeyRound size={11} className="text-accent" />}
                  {c.name}
                </span>
              </td>
              <td className="border-b border-edge/40 px-2 py-1 font-mono text-muted">{c.decl_type || "—"}</td>
              <td className="border-b border-edge/40 px-2 py-1 text-muted">{c.notnull ? t("NOT NULL") : t("nullable")}</td>
              <td className="border-b border-edge/40 px-2 py-1 font-mono text-muted">{c.dflt ?? "—"}</td>
              <td className="border-b border-edge/40 px-2 py-1 text-muted">{c.pk ? t("primary key") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {info.indexes.length > 0 && (
        <>
          <div className="mb-1 font-semibold text-strong">{t("Indexes")}</div>
          <ul className="mb-4 list-inside list-disc font-mono text-muted">
            {info.indexes.map((idx) => (
              <li key={idx}>{idx}</li>
            ))}
          </ul>
        </>
      )}

      <div className="mb-1 font-semibold text-strong">{t("Definition")}</div>
      <pre className="overflow-auto rounded border border-edge bg-raised p-2 font-mono text-2xs text-muted">{info.create_sql || "—"}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal helpers (portaled to <body> so nothing clips them)
// ---------------------------------------------------------------------------

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[var(--lx-z-modal)] flex items-center justify-center bg-black/40 p-6" onPointerDown={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-3 py-2 text-sm text-strong">
          <span className="truncate">{title}</span>
          <button onClick={onClose} aria-label={t("Close")} className="rounded p-0.5 text-muted hover:bg-raised hover:text-strong">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function CellDetail({ column, value, onClose }: { column: string; value: string; onClose: () => void }) {
  const toast = useAppStore((s) => s.toast);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }, [value]);
  return (
    <ModalShell title={column} onClose={onClose}>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-muted">{pretty}</pre>
      <div className="flex justify-end gap-2 border-t border-edge px-3 py-2">
        <button
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast(t("Copied"), "success"))}
          className="flex items-center gap-1 rounded bg-raised px-2 py-1 text-xs text-strong hover:bg-edge"
        >
          <Copy size={12} /> {t("Copy")}
        </button>
      </div>
    </ModalShell>
  );
}

function AddRowModal({
  path,
  table,
  onClose,
  onAdded,
}: {
  path: string;
  table: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useAppStore((s) => s.toast);
  const [info, setInfo] = useState<DbTableInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ipc
      .dbTableInfo(path, table)
      .then((i) => {
        setInfo(i);
        // Default: integer primary keys start as NULL (auto-assigned).
        const n: Record<string, boolean> = {};
        for (const c of i.columns) if (c.pk && /int/i.test(c.decl_type)) n[c.name] = true;
        setNulls(n);
      })
      .catch((e) => toast(errorMessage(e), "error"));
  }, [path, table, toast]);

  const submit = async () => {
    if (!info) return;
    const columns: string[] = [];
    const vals: (string | null)[] = [];
    for (const c of info.columns) {
      if (nulls[c.name]) {
        columns.push(c.name);
        vals.push(null);
      } else if (values[c.name] !== undefined) {
        columns.push(c.name);
        vals.push(values[c.name]);
      }
    }
    setBusy(true);
    try {
      await ipc.dbInsertRow(path, table, columns, vals);
      toast(t("Row added"), "success");
      onAdded();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`${t("Add row")} · ${table}`} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!info && <div className="text-xs text-muted">{t("Loading…")}</div>}
        {info?.columns.map((c) => (
          <div key={c.name} className="mb-2">
            <label className="mb-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="font-mono text-strong">{c.name}</span>
              <span className="opacity-70">{c.decl_type}</span>
              {c.pk && <span className="text-accent">PK</span>}
              {!c.notnull && (
                <label className="ml-auto flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!nulls[c.name]}
                    onChange={(e) => setNulls((n) => ({ ...n, [c.name]: e.target.checked }))}
                    className="accent-accent"
                  />
                  NULL
                </label>
              )}
            </label>
            <input
              value={values[c.name] ?? ""}
              disabled={!!nulls[c.name]}
              onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
              spellCheck={false}
              className="w-full rounded border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-accent disabled:opacity-40"
              placeholder={nulls[c.name] ? "NULL" : ""}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-edge px-3 py-2">
        <button onClick={onClose} className="rounded px-3 py-1 text-xs text-muted hover:text-strong">
          {t("Cancel")}
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !info}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
        >
          {t("Insert")}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// SQL console: read-only by default; writes require an explicit opt-in.
// ---------------------------------------------------------------------------

const HISTORY_KEY = "luxor.dbSqlHistory";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, 25) : [];
  } catch {
    return [];
  }
}

function SqlConsole({ path }: { path: string }) {
  const toast = useAppStore((s) => s.toast);
  const [sql, setSql] = useState(
    () => lsGet(dbKey(path, "sql")) ?? "SELECT name FROM sqlite_master WHERE type='table';",
  );
  // Remember the last query per database (debounced via effect below).
  useEffect(() => {
    const id = setTimeout(() => lsSet(dbKey(path, "sql"), sql), 400);
    return () => clearTimeout(id);
  }, [path, sql]);
  const [allowWrite, setAllowWrite] = useState(false);
  const [result, setResult] = useState<DbRows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);

  const pushHistory = (q: string) => {
    setHistory((h) => {
      const next = [q, ...h.filter((x) => x !== q)].slice(0, 25);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  };

  const run = async () => {
    const q = sql.trim();
    if (!q) return;
    setBusy(true);
    const started = performance.now();
    try {
      const r = await ipc.dbQuery(path, q, allowWrite);
      setResult(r);
      setError(null);
      setElapsed(performance.now() - started);
      pushHistory(q);
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
      setElapsed(null);
    } finally {
      setBusy(false);
    }
  };

  const exportResult = async (fmt: "csv" | "json") => {
    if (!result) return;
    const content = fmt === "csv" ? toCsv(result.columns, result.rows) : toJson(result.columns, result.rows);
    const saved = await saveTextFile(`query.${fmt}`, content);
    if (saved) toast(`${t("Exported")} query.${fmt}`, "success");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="relative border-b border-edge p-2">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run();
          }}
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded border border-edge bg-raised p-2 font-mono text-xs text-strong outline-none focus:border-accent"
        />
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button onClick={() => void run()} disabled={busy} className="rounded bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-40">
            {t("Run")} (Ctrl+Enter)
          </button>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} className="accent-accent" />
            {t("allow writes (INSERT/UPDATE/…)")}
          </label>
          {history.length > 0 && (
            <button onClick={() => setShowHistory((v) => !v)} className="text-xs text-muted hover:text-strong">
              {t("History")} ({history.length})
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted">
            {result && (
              <>
                <span>
                  {result.total} {t("row(s)")}
                  {elapsed != null && ` · ${elapsed.toFixed(0)} ms`}
                </span>
                <button onClick={() => void exportResult("csv")} className="hover:text-strong" title={t("Export as CSV")}>
                  CSV
                </button>
                <button onClick={() => void exportResult("json")} className="hover:text-strong" title={t("Export as JSON")}>
                  JSON
                </button>
              </>
            )}
          </div>
        </div>
        {showHistory && history.length > 0 && (
          <div className="mt-1 max-h-40 overflow-auto rounded border border-edge bg-surface">
            {history.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setSql(q);
                  setShowHistory(false);
                }}
                className="block w-full truncate px-2 py-1 text-left font-mono text-2xs text-muted hover:bg-raised hover:text-strong"
                title={q}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="p-3 font-mono text-xs text-danger">{error}</div>}
        {result && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-bar">
              <tr>
                {result.columns.map((c) => (
                  <th key={c} className="border-b border-edge px-2 py-1 text-left font-semibold text-strong">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="odd:bg-raised/30 hover:bg-raised/60">
                  {row.map((v, j) => (
                    <td key={j} className="max-w-72 truncate border-b border-edge/40 px-2 py-1 font-mono text-muted" title={v}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
