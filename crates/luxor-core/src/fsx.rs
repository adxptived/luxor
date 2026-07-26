//! Filesystem access for the in-app file explorer, text editor, image viewer
//! and the read-only SQLite database viewer.
//!
//! All paths are used as given (the UI only navigates from project roots);
//! destructive operations are deliberately conservative.

use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::{DateTime, Utc};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// One entry in a directory listing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// File size in bytes (0 for directories).
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
}

/// Result of reading a text file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextFile {
    pub content: String,
    /// True when the file was larger than the requested limit.
    pub truncated: bool,
    /// Modification time (ms since Unix epoch) at read time. The editor sends
    /// it back on save so external changes are detected (audit 8.1).
    #[serde(default)]
    pub mtime_ms: Option<i64>,
}

/// Modification time of `meta` in ms since the Unix epoch, if available.
fn meta_mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

/// Current mtime (ms) of `path`, if it exists.
pub fn file_mtime_ms(path: &Path) -> Option<i64> {
    std::fs::metadata(path).ok().and_then(|m| meta_mtime_ms(&m))
}

fn err_not_found(path: &str) -> Error {
    Error::InvalidInput(format!("path does not exist: {path}"))
}

/// List a directory, folders first, then files (case-insensitive by name).
pub fn list_dir(path: &str) -> Result<Vec<FsEntry>> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(err_not_found(path));
    }
    let mut entries: Vec<FsEntry> = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let p = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified: meta.modified().ok().map(DateTime::<Utc>::from),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Content sniff: is this buffer likely *binary* (not text we should
/// display/search)?
///
/// Looks at the first 8 KiB:
/// * a NUL byte ⇒ binary (covers most binaries and UTF-16/UTF-32, which carry
///   NULs);
/// * otherwise, a high ratio (>30%) of C0/DEL control bytes that aren't normal
///   text whitespace (tab/LF/CR/FF) ⇒ binary. This catches binaries whose
///   header happens to avoid NUL. UTF-8 multibyte text (Cyrillic, emoji, …)
///   uses bytes ≥ 0x80 which are *not* counted, so it never false-positives.
pub fn is_probably_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.is_empty() {
        return false;
    }
    if sample.contains(&0) {
        return true;
    }
    let suspicious = sample
        .iter()
        .filter(|&&b| (b < 0x09) || (b > 0x0d && b < 0x20) || b == 0x7f)
        .count();
    suspicious * 100 / sample.len() > 30
}

/// Heuristic wrapper kept for internal call sites.
fn looks_binary(bytes: &[u8]) -> bool {
    is_probably_binary(bytes)
}

/// Lexically normalize a path (resolve `.`/`..` without touching the
/// filesystem). Does not follow symlinks — purely textual.
pub fn normalize_lexical(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// True when `path` resolves to a location inside `root` (after lexical
/// normalization). Relative paths are resolved against `root`.
///
/// This powers the optional "restrict file operations to the project" safety
/// mode so a crafted path like `../../etc/passwd` can't escape the project.
pub fn is_within_root(root: &Path, path: &Path) -> bool {
    let r = normalize_lexical(root);
    let p = if path.is_absolute() {
        normalize_lexical(path)
    } else {
        normalize_lexical(&root.join(path))
    };
    p.starts_with(&r)
}

/// Resolve a path to its real (symlink-free) form even when the final
/// components do not exist yet: canonicalize the deepest existing ancestor,
/// then re-append the remaining (lexically normalized) components. This lets
/// us validate destinations of create/rename/copy operations where the target
/// file itself doesn't exist.
pub fn canonicalize_lenient(path: &Path) -> PathBuf {
    let norm = normalize_lexical(path);
    let mut existing = norm.as_path();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if existing.exists() {
            break;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name.to_os_string());
                existing = parent;
            }
            _ => break,
        }
    }
    let mut out = existing
        .canonicalize()
        .unwrap_or_else(|_| existing.to_path_buf());
    for comp in tail.iter().rev() {
        out.push(comp);
    }
    out
}

/// Like [`is_within_root`], but resistant to symlink escapes: both the root
/// and the target are resolved through the filesystem (via
/// [`canonicalize_lenient`]) before the containment check. A symlink inside
/// the project that points at `/etc` will therefore be rejected, unlike with
/// the purely lexical check.
pub fn is_within_root_canonical(root: &Path, path: &Path) -> bool {
    let r = canonicalize_lenient(root);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let p = canonicalize_lenient(&joined);
    p.starts_with(&r)
}

/// Read a UTF-8 text file, up to `max_bytes` (binary files are rejected).
///
/// Only `max_bytes` are ever read into memory — opening a multi-gigabyte log
/// no longer loads the whole file just to throw most of it away.
pub fn read_text(path: &str, max_bytes: u64) -> Result<TextFile> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    let meta = std::fs::metadata(p)?;
    let truncated = meta.len() > max_bytes;
    // Read at most `max_bytes` (plus we never need more): a windowed read keeps
    // peak memory bounded regardless of the file's real size.
    let cap = max_bytes.min(meta.len()) as usize;
    let bytes = read_head(path, cap)?;
    if looks_binary(&bytes) {
        return Err(Error::InvalidInput(format!("not a text file: {path}")));
    }
    let slice = if truncated {
        // The window may end mid-codepoint; drop any incomplete trailing
        // UTF-8 sequence by cutting at the last fully-valid byte.
        match std::str::from_utf8(&bytes) {
            Ok(_) => &bytes[..],
            Err(e) => &bytes[..e.valid_up_to()],
        }
    } else {
        &bytes[..]
    };
    Ok(TextFile {
        content: String::from_utf8_lossy(slice).into_owned(),
        truncated,
        mtime_ms: meta_mtime_ms(&meta),
    })
}

/// Atomically write `bytes` to `path` (write a unique sibling temp file, then
/// rename over the destination).
///
/// Improvements over a naive temp+rename:
/// * Preserves the destination's permissions (e.g. the `+x` bit on scripts),
///   which a fresh temp file would otherwise drop to the umask default.
/// * Writes *through* a symlink to its target, so editing a symlinked file
///   keeps the link instead of replacing it with a regular file.
/// * Uses a unique temp name (UUID) so two concurrent saves of the same file
///   can't clobber each other's temp file.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    // If `path` is a symlink, resolve it so we replace the target, not the link.
    let target: PathBuf = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }
        _ => path.to_path_buf(),
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Temp file in the same directory (same filesystem ⇒ atomic rename).
    let file_name = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let tmp_name = format!(".{file_name}.{}.luxor.tmp", uuid::Uuid::new_v4());
    let tmp = match target.parent() {
        Some(dir) => dir.join(tmp_name),
        None => PathBuf::from(tmp_name),
    };

    std::fs::write(&tmp, bytes)?;
    // Best-effort: copy the existing file's permissions onto the temp file.
    if let Ok(meta) = std::fs::metadata(&target) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    match std::fs::rename(&tmp, &target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e.into())
        }
    }
}

/// Write a text file atomically (preserving permissions and symlinks).
pub fn write_text(path: &str, content: &str) -> Result<()> {
    atomic_write(Path::new(path), content.as_bytes())
}

/// Write `content`, but fail with [`Error::Conflict`] when the file's mtime no
/// longer matches `expected_mtime_ms` — i.e. it was modified externally (git
/// checkout, formatter, another editor) since the caller read it. Returns the
/// file's NEW mtime so the caller can update its bookkeeping. Audit fix 8.1.
pub fn write_text_checked(
    path: &str,
    content: &str,
    expected_mtime_ms: Option<i64>,
) -> Result<Option<i64>> {
    let p = Path::new(path);
    if let Some(expected) = expected_mtime_ms {
        if let Some(actual) = file_mtime_ms(p) {
            if actual != expected {
                return Err(Error::Conflict(format!(
                    "file changed on disk: {path} (expected mtime {expected}, found {actual})"
                )));
            }
        }
        // If the file no longer exists, allow the write (re-create): the
        // alternative — refusing to save the user's buffer — loses data.
    }
    atomic_write(p, content.as_bytes())?;
    Ok(file_mtime_ms(p))
}

/// Read a file as base64 (for the image viewer). Errors above `max_bytes`.
pub fn read_base64(path: &str, max_bytes: u64) -> Result<String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    let meta = std::fs::metadata(p)?;
    if meta.len() > max_bytes {
        return Err(Error::InvalidInput(format!(
            "file too large to preview ({} bytes, limit {max_bytes})",
            meta.len()
        )));
    }
    let bytes = std::fs::read(p)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Create an empty file (fails if it already exists).
pub fn create_file(path: &str) -> Result<()> {
    let p = Path::new(path);
    if p.exists() {
        return Err(Error::InvalidInput(format!("already exists: {path}")));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, b"")?;
    Ok(())
}

/// Create a directory (and parents).
pub fn create_dir(path: &str) -> Result<()> {
    let p = Path::new(path);
    if p.exists() {
        return Err(Error::InvalidInput(format!("already exists: {path}")));
    }
    std::fs::create_dir_all(p)?;
    Ok(())
}

/// Rename/move a file or directory. The target must not exist.
pub fn rename_path(from: &str, to: &str) -> Result<()> {
    let src = Path::new(from);
    if !src.exists() {
        return Err(err_not_found(from));
    }
    let dst = Path::new(to);
    if dst.exists() {
        return Err(Error::InvalidInput(format!("target already exists: {to}")));
    }
    std::fs::rename(src, dst)?;
    Ok(())
}

/// Copy a file or directory (recursively). Fails if the target exists.
pub fn copy_path(from: &str, to: &str) -> Result<()> {
    let src = Path::new(from);
    if !src.exists() {
        return Err(err_not_found(from));
    }
    let dst = Path::new(to);
    if dst.exists() {
        return Err(Error::InvalidInput(format!("target already exists: {to}")));
    }
    if src.is_dir() {
        copy_dir_recursive(src, dst)?;
    } else {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Delete a file, or a directory when `recursive` is set.
pub fn delete_path(path: &str, recursive: bool) -> Result<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(err_not_found(path));
    }
    // Refuse obviously catastrophic targets (filesystem roots, drive roots).
    if p.parent().is_none() || p == Path::new("/") {
        return Err(Error::InvalidInput("refusing to delete a root path".into()));
    }
    if p.is_dir() {
        if !recursive {
            return Err(Error::InvalidInput(
                "path is a directory (recursive delete required)".into(),
            ));
        }
        std::fs::remove_dir_all(p)?;
    } else {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Read-only SQLite viewer
// ---------------------------------------------------------------------------

/// A table in a SQLite database.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DbTable {
    pub name: String,
    pub rows: i64,
}

/// One page of rows from a table; every value rendered as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DbRows {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total: i64,
    /// `rowid` of each row, parallel to `rows`. Empty when the result is not
    /// row-addressable (a free-form query, or a `WITHOUT ROWID` table).
    #[serde(default)]
    pub rowids: Vec<i64>,
    /// True when rows can be edited in place (the table has a usable `rowid`).
    #[serde(default)]
    pub editable: bool,
}

/// One column of a table's schema (from `PRAGMA table_info`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DbColumn {
    pub name: String,
    /// Declared type (may be empty for dynamically-typed columns).
    pub decl_type: String,
    pub notnull: bool,
    pub pk: bool,
    pub dflt: Option<String>,
}

/// Schema overview for a single table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DbTableInfo {
    pub name: String,
    pub columns: Vec<DbColumn>,
    pub row_count: i64,
    /// False for `WITHOUT ROWID` tables (rows are not editable in place).
    pub has_rowid: bool,
    /// The original `CREATE TABLE` statement.
    pub create_sql: String,
    pub indexes: Vec<String>,
}

fn open_db_readonly(path: &str) -> Result<Connection> {
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    Connection::open_with_flags(p, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(Error::from)
}

/// List user tables with their row counts.
pub fn db_tables(path: &str) -> Result<Vec<DbTable>> {
    let conn = open_db_readonly(path)?;
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<_, _>>()?;
    let mut tables = Vec::with_capacity(names.len());
    for name in names {
        let rows: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(&name)),
                [],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        tables.push(DbTable { name, rows });
    }
    Ok(tables)
}

/// Read a page of rows from `table` (validated against the table list).
///
/// Optional `order_by` (a real column name, validated) sorts the page;
/// `filter` does a case-insensitive substring match across every column.
/// When the table has a usable `rowid` the result carries per-row ids and is
/// marked `editable`, so the UI can update/delete individual rows.
pub fn db_rows(
    path: &str,
    table: &str,
    limit: u32,
    offset: u32,
    order_by: Option<&str>,
    desc: bool,
    filter: Option<&str>,
) -> Result<DbRows> {
    let tables = db_tables(path)?;
    if !tables.iter().any(|t| t.name == table) {
        return Err(Error::InvalidInput(format!("no such table: {table}")));
    }
    let conn = open_db_readonly(path)?;
    let cols = table_columns(&conn, table)?;

    // ORDER BY — only ever a column that actually exists.
    let order_clause = match order_by {
        Some(c) if cols.iter().any(|x| x == c) => format!(
            " ORDER BY {} {}",
            quote_ident(c),
            if desc { "DESC" } else { "ASC" }
        ),
        _ => String::new(),
    };

    // WHERE — substring match across all columns, fully parameterised.
    let filter = filter.map(str::trim).filter(|f| !f.is_empty());
    let like_param: Vec<Value> = match filter {
        Some(f) => vec![Value::Text(format!("%{}%", escape_like(f)))],
        None => Vec::new(),
    };
    let where_clause = if filter.is_some() {
        let conds: Vec<String> = cols
            .iter()
            .map(|c| format!("CAST({} AS TEXT) LIKE ?1 ESCAPE '\\'", quote_ident(c)))
            .collect();
        format!(" WHERE {}", conds.join(" OR "))
    } else {
        String::new()
    };

    let total: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM {}{}",
            quote_ident(table),
            where_clause
        ),
        params_from_iter(like_param.iter()),
        |r| r.get(0),
    )?;

    let limit = limit.clamp(1, 1000);
    // A `WITHOUT ROWID` table rejects `SELECT rowid` — fall back to read-only.
    let has_rowid = conn
        .prepare(&format!("SELECT rowid FROM {} LIMIT 0", quote_ident(table)))
        .is_ok();
    let select = if has_rowid { "rowid, *" } else { "*" };
    let sql = format!(
        "SELECT {select} FROM {}{}{} LIMIT {limit} OFFSET {offset}",
        quote_ident(table),
        where_clause,
        order_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let all_cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let n = all_cols.len();

    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut rowids: Vec<i64> = Vec::new();
    let mut query = stmt.query(params_from_iter(like_param.iter()))?;
    while let Some(row) = query.next()? {
        let start = if has_rowid {
            rowids.push(row.get::<_, i64>(0)?);
            1
        } else {
            0
        };
        let mut values = Vec::with_capacity(n - start);
        for i in start..n {
            values.push(render_value(row.get_ref(i)?));
        }
        rows.push(values);
    }
    let columns = if has_rowid {
        all_cols[1..].to_vec()
    } else {
        all_cols
    };
    Ok(DbRows {
        columns,
        rows,
        total,
        rowids,
        editable: has_rowid,
    })
}

/// Schema (columns, indexes, DDL) for a single table.
pub fn db_table_info(path: &str, table: &str) -> Result<DbTableInfo> {
    let tables = db_tables(path)?;
    let row_count = tables
        .iter()
        .find(|t| t.name == table)
        .map(|t| t.rows)
        .ok_or_else(|| Error::InvalidInput(format!("no such table: {table}")))?;
    let conn = open_db_readonly(path)?;

    let columns: Vec<DbColumn> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote_ident(table)))?;
        // Bind to a local so the `MappedRows` temporary is dropped before `stmt`
        // at the end of the block (otherwise E0597 on current stable rustc).
        let rows = stmt
            .query_map([], |r| {
                Ok(DbColumn {
                    name: r.get::<_, String>(1)?,
                    decl_type: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    notnull: r.get::<_, i64>(3)? != 0,
                    dflt: r.get::<_, Option<String>>(4)?,
                    pk: r.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        rows
    };

    let create_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_default();

    let indexes: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA index_list({})", quote_ident(table)))?;
        // See note above: bind the collected rows so the temporary borrowing
        // `stmt` is dropped before `stmt` itself.
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<std::result::Result<_, _>>()?;
        rows
    };

    let has_rowid = conn
        .prepare(&format!("SELECT rowid FROM {} LIMIT 0", quote_ident(table)))
        .is_ok();

    Ok(DbTableInfo {
        name: table.to_string(),
        columns,
        row_count,
        has_rowid,
        create_sql,
        indexes,
    })
}

/// Update a single cell, addressed by `rowid`. `value = None` writes NULL.
pub fn db_update_cell(
    path: &str,
    table: &str,
    rowid: i64,
    column: &str,
    value: Option<String>,
) -> Result<()> {
    let conn = open_db_writable(path)?;
    ensure_table(&conn, table)?;
    ensure_column(&conn, table, column)?;
    let v = value.map_or(Value::Null, Value::Text);
    let n = conn.execute(
        &format!(
            "UPDATE {} SET {} = ?1 WHERE rowid = ?2",
            quote_ident(table),
            quote_ident(column)
        ),
        params![v, rowid],
    )?;
    if n == 0 {
        return Err(Error::InvalidInput("row not found".into()));
    }
    Ok(())
}

/// Insert a row. Empty `columns` inserts a row of defaults. Returns the new rowid.
pub fn db_insert_row(
    path: &str,
    table: &str,
    columns: Vec<String>,
    values: Vec<Option<String>>,
) -> Result<i64> {
    if columns.len() != values.len() {
        return Err(Error::InvalidInput("columns/values length mismatch".into()));
    }
    let conn = open_db_writable(path)?;
    ensure_table(&conn, table)?;
    if columns.is_empty() {
        conn.execute(
            &format!("INSERT INTO {} DEFAULT VALUES", quote_ident(table)),
            [],
        )?;
        return Ok(conn.last_insert_rowid());
    }
    let valid = table_columns(&conn, table)?;
    for c in &columns {
        if !valid.iter().any(|v| v == c) {
            return Err(Error::InvalidInput(format!("no such column: {c}")));
        }
    }
    let cols_sql = columns
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (1..=columns.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let vals: Vec<Value> = values
        .into_iter()
        .map(|v| v.map_or(Value::Null, Value::Text))
        .collect();
    conn.execute(
        &format!(
            "INSERT INTO {} ({cols_sql}) VALUES ({placeholders})",
            quote_ident(table)
        ),
        params_from_iter(vals.iter()),
    )?;
    Ok(conn.last_insert_rowid())
}

/// Delete rows by `rowid`. Returns how many rows were removed.
pub fn db_delete_rows(path: &str, table: &str, rowids: Vec<i64>) -> Result<usize> {
    if rowids.is_empty() {
        return Ok(0);
    }
    let conn = open_db_writable(path)?;
    ensure_table(&conn, table)?;
    let placeholders = (1..=rowids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let n = conn.execute(
        &format!(
            "DELETE FROM {} WHERE rowid IN ({placeholders})",
            quote_ident(table)
        ),
        params_from_iter(rowids.iter()),
    )?;
    Ok(n)
}

fn open_db_writable(path: &str) -> Result<Connection> {
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    Connection::open(p).map_err(Error::from)
}

/// Column names of a table, in declaration order.
fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote_ident(table)))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(cols)
}

fn ensure_table(conn: &Connection, table: &str) -> Result<()> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Err(Error::InvalidInput(format!("no such table: {table}")));
    }
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str) -> Result<()> {
    if !table_columns(conn, table)?.iter().any(|c| c == column) {
        return Err(Error::InvalidInput(format!("no such column: {column}")));
    }
    Ok(())
}

/// Escape `%`, `_` and `\` so a user's filter text is matched literally
/// inside a `LIKE ... ESCAPE '\'` pattern.
fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn render_value(value: rusqlite::types::ValueRef<'_>) -> String {
    use rusqlite::types::ValueRef;
    match value {
        ValueRef::Null => "NULL".into(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(b) => format!("BLOB ({} bytes)", b.len()),
    }
}

// ---------------------------------------------------------------------------
// SQL console (Database panel)
// ---------------------------------------------------------------------------

/// Run an arbitrary SQL statement against a SQLite file. SELECT/PRAGMA/EXPLAIN
/// run read-only; anything else requires `allow_write = true` (the UI asks).
/// Returns rows for queries, or an "N rows affected" pseudo-result otherwise.
pub fn db_query(path: &str, sql: &str, allow_write: bool, max_rows: u32) -> Result<DbRows> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err(Error::InvalidInput("empty SQL".into()));
    }
    let first_word = sql
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    let is_read = matches!(
        first_word.as_str(),
        "SELECT" | "PRAGMA" | "EXPLAIN" | "WITH"
    );
    if !is_read && !allow_write {
        return Err(Error::InvalidInput(
            "write statements need \"allow writes\" enabled".into(),
        ));
    }
    let conn = if is_read && !allow_write {
        open_db_readonly(path)?
    } else {
        let p = PathBuf::from(path);
        if !p.is_file() {
            return Err(err_not_found(path));
        }
        Connection::open(p)?
    };
    let mut stmt = conn.prepare(sql)?;
    if stmt.column_count() == 0 {
        // Statement without a result set (INSERT/UPDATE/DDL/…).
        let affected = stmt.execute([])?;
        return Ok(DbRows {
            columns: vec!["result".into()],
            rows: vec![vec![format!("{affected} row(s) affected")]],
            total: 1,
            rowids: Vec::new(),
            editable: false,
        });
    }
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let n = columns.len();
    let max = max_rows.clamp(1, 10_000) as usize;
    let mut rows = Vec::new();
    let mut query = stmt.query([])?;
    while let Some(row) = query.next()? {
        if rows.len() >= max {
            break;
        }
        let mut values = Vec::with_capacity(n);
        for i in 0..n {
            values.push(render_value(row.get_ref(i)?));
        }
        rows.push(values);
    }
    let total = rows.len() as i64;
    Ok(DbRows {
        columns,
        rows,
        total,
        rowids: Vec::new(),
        editable: false,
    })
}

// ---------------------------------------------------------------------------
// File encodings
// ---------------------------------------------------------------------------

/// Encodings selectable in the editor's encoding picker.
pub const ENCODINGS: &[&str] = &[
    "utf-8",
    "utf-16le",
    "utf-16be",
    "windows-1251",
    "windows-1252",
    "koi8-r",
    "shift_jis",
    "euc-jp",
    "gbk",
    "big5",
    "iso-8859-1",
    "iso-8859-2",
];

fn lookup_encoding(label: &str) -> Result<&'static encoding_rs::Encoding> {
    encoding_rs::Encoding::for_label(label.as_bytes())
        .ok_or_else(|| Error::InvalidInput(format!("unknown encoding: {label}")))
}

/// Best-effort encoding sniff: BOM first, then UTF-8 validity, else a
/// single-byte fallback guess. Returns an encoding label.
pub fn detect_encoding(path: &str) -> Result<String> {
    let bytes = read_head(path, 64 * 1024)?;
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok("utf-8".into());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok("utf-16le".into());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok("utf-16be".into());
    }
    if std::str::from_utf8(&bytes).is_ok() {
        return Ok("utf-8".into());
    }
    // Heuristic: lots of NUL bytes in even/odd positions → UTF-16.
    let nuls_even = bytes.iter().step_by(2).filter(|b| **b == 0).count();
    let nuls_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    if nuls_odd > bytes.len() / 8 {
        return Ok("utf-16le".into());
    }
    if nuls_even > bytes.len() / 8 {
        return Ok("utf-16be".into());
    }
    Ok("windows-1252".into())
}

/// Read at most `max` bytes from the start of `path`.
///
/// Uses a bounded `Read::take` + `read_to_end` so it (a) never allocates more
/// than the bytes actually present and (b) loops until `max`/EOF instead of
/// trusting a single `read()` (which may return short for large files).
fn read_head(path: &str, max: usize) -> Result<Vec<u8>> {
    use std::io::Read;
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    let file = std::fs::File::open(p)?;
    let mut buf = Vec::new();
    file.take(max as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Read a file decoding it from `encoding` (label, e.g. "windows-1251").
pub fn read_text_encoded(path: &str, encoding: &str, max_bytes: u64) -> Result<TextFile> {
    let enc = lookup_encoding(encoding)?;
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(err_not_found(path));
    }
    let meta = std::fs::metadata(&p)?;
    let truncated = meta.len() > max_bytes;
    let bytes = read_head(path, max_bytes as usize)?;
    let (text, _, had_errors) = enc.decode(&bytes);
    let _ = had_errors; // lossy decode is fine for display
    Ok(TextFile {
        content: text.into_owned(),
        truncated,
        mtime_ms: meta_mtime_ms(&meta),
    })
}

/// Write `content` encoded as `encoding` (used by "save with encoding" /
/// re-encode). UTF-16 gets a BOM, like editors expect.
pub fn write_text_encoded(path: &str, content: &str, encoding: &str) -> Result<()> {
    let enc = lookup_encoding(encoding)?;
    let mut out: Vec<u8> = Vec::new();
    match enc.name() {
        "UTF-16LE" => {
            out.extend_from_slice(&[0xFF, 0xFE]);
            for unit in content.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
        }
        "UTF-16BE" => {
            out.extend_from_slice(&[0xFE, 0xFF]);
            for unit in content.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
        }
        _ => {
            let (bytes, _, _) = enc.encode(content);
            out = bytes.into_owned();
        }
    }
    // Atomic + permission/symlink preserving, consistent with `write_text`.
    atomic_write(Path::new(path), &out)
}

/// [`write_text_encoded`] with the same on-disk-conflict check as
/// [`write_text_checked`].
///
/// Saving a file in a non-UTF-8 encoding used to bypass the conflict guard
/// entirely: `write_text` refused to clobber a file that had changed underneath
/// the editor, but the encoded path wrote unconditionally, so an external edit
/// was silently overwritten whenever the buffer happened to be windows-1251,
/// UTF-16, … Returns the file's new mtime, like `write_text_checked`.
pub fn write_text_encoded_checked(
    path: &str,
    content: &str,
    encoding: &str,
    expected_mtime_ms: Option<i64>,
) -> Result<Option<i64>> {
    let p = Path::new(path);
    if let Some(expected) = expected_mtime_ms {
        if let Some(actual) = file_mtime_ms(p) {
            if actual != expected {
                return Err(Error::Conflict(format!(
                    "file changed on disk: {path} (expected mtime {expected}, found {actual})"
                )));
            }
        }
        // Missing file → allow the write (re-create) rather than lose the buffer,
        // matching `write_text_checked`.
    }
    write_text_encoded(path, content, encoding)?;
    Ok(file_mtime_ms(p))
}

#[cfg(test)]
mod tests {
    #[test]
    fn copy_path_copies_files_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let f = root.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        let sub = root.join("sub");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("b.txt"), "world").unwrap();

        super::copy_path(
            f.to_str().unwrap(),
            root.join("a copy.txt").to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("a copy.txt")).unwrap(),
            "hello"
        );

        super::copy_path(
            sub.to_str().unwrap(),
            root.join("sub copy").to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("sub copy/b.txt")).unwrap(),
            "world"
        );

        // refuses to overwrite
        assert!(super::copy_path(
            f.to_str().unwrap(),
            root.join("a copy.txt").to_str().unwrap()
        )
        .is_err());
    }

    use super::*;

    #[test]
    fn list_dir_sorts_dirs_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "hi").unwrap();
        std::fs::create_dir(dir.path().join("zfolder")).unwrap();
        let entries = list_dir(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_dir, "directories come first");
        assert_eq!(entries[0].name, "zfolder");
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[1].size, 2);
    }

    #[test]
    fn text_roundtrip_and_binary_rejection() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        let path = file.to_str().unwrap();
        write_text(path, "привет мир").unwrap();
        let read = read_text(path, 1024 * 1024).unwrap();
        assert_eq!(read.content, "привет мир");
        assert!(!read.truncated);

        let bin = dir.path().join("img.bin");
        std::fs::write(&bin, [0u8, 159, 1, 0]).unwrap();
        assert_eq!(
            read_text(bin.to_str().unwrap(), 1024).unwrap_err().kind(),
            "invalid_input"
        );
    }

    #[test]
    fn truncation_respects_utf8_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("u.txt");
        let path = file.to_str().unwrap();
        write_text(path, "ééééé").unwrap(); // 2 bytes per char
        let read = read_text(path, 3).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content, "é"); // cut back to a boundary
    }

    #[test]
    #[cfg(unix)]
    fn write_text_preserves_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("script.sh");
        let path = file.to_str().unwrap();
        write_text(path, "#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        // Re-save (the editor path): the +x bit must survive the temp+rename.
        write_text(path, "#!/bin/sh\necho bye\n").unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755, "executable bit preserved across save");
    }

    #[test]
    #[cfg(unix)]
    fn write_text_follows_symlink_to_target() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.txt");
        std::fs::write(&real, "original").unwrap();
        let link = dir.path().join("link.txt");
        symlink(&real, &link).unwrap();
        // Writing through the link must keep the link and update the target.
        write_text(link.to_str().unwrap(), "updated").unwrap();
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "symlink is preserved, not replaced by a regular file"
        );
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "updated");
    }

    #[test]
    fn write_text_encoded_is_atomic_and_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cp1251.txt");
        let path = file.to_str().unwrap();
        write_text_encoded(path, "Привет", "windows-1251").unwrap();
        // No stray temp file is left behind next to it.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("luxor.tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no temp file left after encoded write"
        );
        let read = read_text_encoded(path, "windows-1251", 1024).unwrap();
        assert_eq!(read.content, "Привет");
    }

    #[test]
    fn delete_guards() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let err = delete_path(sub.to_str().unwrap(), false).unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
        delete_path(sub.to_str().unwrap(), true).unwrap();
        assert!(!sub.exists());
    }

    #[test]
    fn sqlite_viewer_reads_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("test.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, data BLOB);
             INSERT INTO items (name, data) VALUES ('first', x'00ff'), ('second', NULL);",
        )
        .unwrap();
        drop(conn);

        let path = db.to_str().unwrap();
        let tables = db_tables(path).unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "items");
        assert_eq!(tables[0].rows, 2);

        let page = db_rows(path, "items", 10, 0, None, false, None).unwrap();
        assert_eq!(page.columns, vec!["id", "name", "data"]);
        assert_eq!(page.total, 2);
        assert_eq!(page.rows[0][1], "first");
        assert_eq!(page.rows[0][2], "BLOB (2 bytes)");
        assert_eq!(page.rows[1][2], "NULL");
        // Has a rowid → rows are addressable and editable.
        assert!(page.editable);
        assert_eq!(page.rowids.len(), 2);

        assert_eq!(
            db_rows(path, "evil\"; DROP", 10, 0, None, false, None)
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    #[test]
    fn db_rows_sort_and_filter() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("s.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
             INSERT INTO items (name) VALUES ('banana'), ('apple'), ('cherry');",
        )
        .unwrap();
        drop(conn);
        let path = db.to_str().unwrap();

        // Sort ascending by name.
        let asc = db_rows(path, "items", 10, 0, Some("name"), false, None).unwrap();
        assert_eq!(asc.rows[0][1], "apple");
        assert_eq!(asc.rows[2][1], "cherry");
        // Sort descending.
        let desc = db_rows(path, "items", 10, 0, Some("name"), true, None).unwrap();
        assert_eq!(desc.rows[0][1], "cherry");
        // An invalid sort column is ignored (no SQL injection / error).
        let safe = db_rows(
            path,
            "items",
            10,
            0,
            Some("name; DROP TABLE items"),
            false,
            None,
        )
        .unwrap();
        assert_eq!(safe.total, 3);

        // Filter substring across columns.
        let filtered = db_rows(path, "items", 10, 0, None, false, Some("err")).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.rows[0][1], "cherry");
        // Filter special chars are escaped (treated literally, no match).
        let none = db_rows(path, "items", 10, 0, None, false, Some("%")).unwrap();
        assert_eq!(none.total, 0);
    }

    #[test]
    fn db_edit_update_insert_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("e.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, note TEXT);
             INSERT INTO items (name) VALUES ('a'), ('b');",
        )
        .unwrap();
        drop(conn);
        let path = db.to_str().unwrap();

        // Schema overview.
        let info = db_table_info(path, "items").unwrap();
        assert_eq!(info.columns.len(), 3);
        assert!(info.columns[0].pk);
        assert!(info.has_rowid);
        assert!(info.create_sql.contains("CREATE TABLE"));

        // Update by rowid.
        let page = db_rows(path, "items", 10, 0, None, false, None).unwrap();
        let first = page.rowids[0];
        db_update_cell(path, "items", first, "name", Some("renamed".into())).unwrap();
        db_update_cell(path, "items", first, "note", None).unwrap(); // explicit NULL
        let page = db_rows(path, "items", 10, 0, Some("id"), false, None).unwrap();
        assert_eq!(page.rows[0][1], "renamed");
        assert_eq!(page.rows[0][2], "NULL");

        // Reject unknown column.
        assert_eq!(
            db_update_cell(path, "items", first, "nope", Some("x".into()))
                .unwrap_err()
                .kind(),
            "invalid_input"
        );

        // Insert a new row.
        let new_id = db_insert_row(
            path,
            "items",
            vec!["name".into(), "note".into()],
            vec![Some("c".into()), None],
        )
        .unwrap();
        assert!(new_id > 0);
        let page = db_rows(path, "items", 10, 0, None, false, None).unwrap();
        assert_eq!(page.total, 3);

        // Delete it again.
        let removed = db_delete_rows(path, "items", vec![new_id]).unwrap();
        assert_eq!(removed, 1);
        let page = db_rows(path, "items", 10, 0, None, false, None).unwrap();
        assert_eq!(page.total, 2);
    }
    #[test]
    fn db_query_select_and_write_guard() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.sqlite");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x'), ('y');")
            .unwrap();
        drop(conn);
        let p = path.to_str().unwrap();

        let rows = db_query(p, "SELECT * FROM t ORDER BY a", false, 100).unwrap();
        assert_eq!(rows.columns, vec!["a".to_string()]);
        assert_eq!(rows.rows.len(), 2);

        assert_eq!(
            db_query(p, "DELETE FROM t", false, 100).unwrap_err().kind(),
            "invalid_input"
        );
        let res = db_query(p, "DELETE FROM t WHERE a = 'x'", true, 100).unwrap();
        assert!(res.rows[0][0].contains("1 row"));
        let rows = db_query(p, "SELECT COUNT(*) AS n FROM t", false, 100).unwrap();
        assert_eq!(rows.rows[0][0], "1");
    }

    #[test]
    fn write_text_encoded_checked_guards_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("cp1251.txt");
        let path = p.to_str().unwrap();

        // Initial save establishes a known mtime.
        let mtime = write_text_encoded_checked(path, "v1", "windows-1251", None)
            .unwrap()
            .expect("mtime after first write");

        // Saving again with the mtime we last saw must succeed.
        let mtime2 = write_text_encoded_checked(path, "v2", "windows-1251", Some(mtime))
            .unwrap()
            .expect("mtime after second write");
        assert_eq!(
            read_text_encoded(path, "windows-1251", 1_000_000).unwrap().content,
            "v2"
        );

        // Somebody else edits the file behind the editor's back.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(&p, b"external").unwrap();

        // A save carrying the STALE mtime must be refused, not silently clobber.
        let err = write_text_encoded_checked(path, "v3", "windows-1251", Some(mtime2)).unwrap_err();
        assert_eq!(err.kind(), "conflict");
        assert_eq!(std::fs::read(&p).unwrap(), b"external");

        // A missing file is re-created rather than losing the buffer.
        std::fs::remove_file(&p).unwrap();
        write_text_encoded_checked(path, "recreated", "utf-8", Some(mtime2)).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "recreated");
    }

    #[test]
    fn encoding_detect_read_write() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("ru.txt");
        let path = p.to_str().unwrap();

        // windows-1251 bytes for "привет"
        let cp1251: &[u8] = &[0xEF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];
        std::fs::write(&p, cp1251).unwrap();
        assert_ne!(detect_encoding(path).unwrap(), "utf-8");
        let text = read_text_encoded(path, "windows-1251", 1_000_000).unwrap();
        assert_eq!(text.content, "\u{43f}\u{440}\u{438}\u{432}\u{435}\u{442}");

        // Re-encode to UTF-8 and back.
        write_text_encoded(path, &text.content, "utf-8").unwrap();
        assert_eq!(detect_encoding(path).unwrap(), "utf-8");
        write_text_encoded(path, &text.content, "utf-16le").unwrap();
        assert_eq!(detect_encoding(path).unwrap(), "utf-16le");
        let round = read_text_encoded(path, "utf-16le", 1_000_000).unwrap();
        assert!(round
            .content
            .contains("\u{43f}\u{440}\u{438}\u{432}\u{435}\u{442}"));

        assert!(read_text_encoded(path, "marsian-9", 100).is_err());
        assert!(ENCODINGS.contains(&"utf-8"));
    }

    #[test]
    fn binary_detection_by_content() {
        // NUL → binary.
        assert!(is_probably_binary(&[0u8, 1, 2, 3]));
        // Plain ASCII text → not binary.
        assert!(!is_probably_binary(
            b"hello world\nsecond line\twith tab\r\n"
        ));
        // UTF-8 Cyrillic (bytes >= 0x80) must NOT be flagged binary.
        assert!(!is_probably_binary("привет мир — em dash 🎉".as_bytes()));
        // Empty → not binary.
        assert!(!is_probably_binary(b""));
        // Mostly control bytes (no NUL) → binary.
        let ctrl: Vec<u8> = (0..100u8)
            .map(|i| if i % 2 == 0 { 0x01 } else { b'a' })
            .collect();
        assert!(is_probably_binary(&ctrl));
    }

    #[test]
    fn within_root_guard() {
        let root = Path::new("/home/user/project");
        assert!(is_within_root(
            root,
            Path::new("/home/user/project/src/main.rs")
        ));
        assert!(is_within_root(root, Path::new("src/main.rs"))); // relative → joined
        assert!(is_within_root(root, Path::new("/home/user/project")));
        // Escapes via ..
        assert!(!is_within_root(
            root,
            Path::new("/home/user/project/../secrets")
        ));
        assert!(!is_within_root(root, Path::new("../../etc/passwd")));
        assert!(!is_within_root(root, Path::new("/etc/passwd")));
        // Sibling with shared prefix must not be considered inside.
        assert!(!is_within_root(
            root,
            Path::new("/home/user/project-evil/x")
        ));
    }

    #[test]
    fn normalize_lexical_resolves_dots() {
        assert_eq!(
            normalize_lexical(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
    }
}
