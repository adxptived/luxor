//! Filesystem & SQLite-viewer commands for the in-app explorer, editor,
//! image viewer and database viewer. All operations run on blocking threads.
//!
//! Security: every MUTATING command (write/create/rename/copy/delete and DB
//! writes) is confined to registered project roots via
//! [`crate::pathguard::ensure_within_projects`]. Read-only commands stay
//! unrestricted so the explorer can browse the disk to open new projects.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use luxor_core::fsx::{self, DbRows, DbTable, DbTableInfo, FsEntry, TextFile};
use luxor_core::Error;
use tauri::State;

use crate::pathguard::ensure_within_projects;
use crate::state::AppState;

async fn blocking<T, F>(f: F) -> Result<T, Error>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, Error> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, Error> {
    blocking(move || fsx::list_dir(&path)).await
}

fn should_skip_search_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo" | ".cache"
    )
}

fn normalize_query(value: &str) -> String {
    value.trim().to_lowercase().replace(['\\', '/'], "/")
}

fn search_files_sync(root: String, query: String, limit: usize) -> Result<Vec<FsEntry>, Error> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(Error::InvalidInput(format!("path does not exist: {root}")));
    }
    let terms: Vec<String> = normalize_query(&query)
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let max_results = limit.clamp(1, 300);
    let mut out = Vec::new();
    let mut queue = VecDeque::from([(root_path.clone(), 0usize)]);
    while let Some((dir, depth)) = queue.pop_front() {
        if depth > 12 || should_skip_search_dir(&dir) {
            continue;
        }
        let Ok(read_dir) = std::fs::read_dir(&dir) else { continue };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            let rel = path.strip_prefix(&root_path).unwrap_or(&path).to_string_lossy();
            let hay = normalize_query(&rel);
            let name = entry.file_name().to_string_lossy().into_owned();
            let name_hay = normalize_query(&name);
            let matched = terms.iter().all(|term| hay.contains(term) || name_hay.contains(term));
            if matched {
                out.push(FsEntry {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: meta.is_dir(),
                    size: if meta.is_dir() { 0 } else { meta.len() },
                    modified: meta.modified().ok().map(chrono::DateTime::<chrono::Utc>::from),
                });
                if out.len() >= max_results {
                    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
                    return Ok(out);
                }
            }
            if meta.is_dir() && !should_skip_search_dir(&path) {
                queue.push_back((path, depth + 1));
            }
        }
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn fs_search(root: String, query: String, limit: Option<usize>) -> Result<Vec<FsEntry>, Error> {
    blocking(move || search_files_sync(root, query, limit.unwrap_or(120))).await
}

#[tauri::command]
pub async fn fs_read_text(path: String, max_bytes: Option<u64>) -> Result<TextFile, Error> {
    blocking(move || fsx::read_text(&path, max_bytes.unwrap_or(2 * 1024 * 1024))).await
}

/// Returns the file's new mtime (ms since epoch). When `expected_mtime_ms` is
/// provided and the on-disk mtime differs, fails with a `conflict` error so
/// the editor can show a "file changed on disk" dialog (audit 8.1).
#[tauri::command]
pub async fn fs_write_text(
    state: State<'_, AppState>,
    path: String,
    content: String,
    expected_mtime_ms: Option<i64>,
) -> Result<Option<i64>, Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::write_text_checked(&path, &content, expected_mtime_ms)).await
}

#[tauri::command]
pub async fn fs_read_base64(path: String, max_bytes: Option<u64>) -> Result<String, Error> {
    blocking(move || fsx::read_base64(&path, max_bytes.unwrap_or(20 * 1024 * 1024))).await
}

#[tauri::command]
pub async fn fs_create_file(state: State<'_, AppState>, path: String) -> Result<(), Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::create_file(&path)).await
}

#[tauri::command]
pub async fn fs_create_dir(state: State<'_, AppState>, path: String) -> Result<(), Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::create_dir(&path)).await
}

#[tauri::command]
pub async fn fs_rename(state: State<'_, AppState>, from: String, to: String) -> Result<(), Error> {
    ensure_within_projects(&state, &from)?;
    ensure_within_projects(&state, &to)?;
    blocking(move || fsx::rename_path(&from, &to)).await
}

#[tauri::command]
pub async fn fs_copy(state: State<'_, AppState>, from: String, to: String) -> Result<(), Error> {
    // Copy READS from `from` (allowed anywhere, like fs_read_text) but must
    // only WRITE inside a project root.
    ensure_within_projects(&state, &to)?;
    blocking(move || fsx::copy_path(&from, &to)).await
}

#[tauri::command]
pub async fn fs_delete(
    state: State<'_, AppState>,
    path: String,
    recursive: Option<bool>,
) -> Result<(), Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::delete_path(&path, recursive.unwrap_or(false))).await
}

#[tauri::command]
pub async fn db_tables(path: String) -> Result<Vec<DbTable>, Error> {
    blocking(move || fsx::db_tables(&path)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn db_rows(
    path: String,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
    order_by: Option<String>,
    desc: Option<bool>,
    filter: Option<String>,
) -> Result<DbRows, Error> {
    blocking(move || {
        fsx::db_rows(
            &path,
            &table,
            limit.unwrap_or(200),
            offset.unwrap_or(0),
            order_by.as_deref(),
            desc.unwrap_or(false),
            filter.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn db_table_info(path: String, table: String) -> Result<DbTableInfo, Error> {
    blocking(move || fsx::db_table_info(&path, &table)).await
}

#[tauri::command]
pub async fn db_update_cell(
    state: State<'_, AppState>,
    path: String,
    table: String,
    rowid: i64,
    column: String,
    value: Option<String>,
) -> Result<(), Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::db_update_cell(&path, &table, rowid, &column, value)).await
}

#[tauri::command]
pub async fn db_insert_row(
    state: State<'_, AppState>,
    path: String,
    table: String,
    columns: Vec<String>,
    values: Vec<Option<String>>,
) -> Result<i64, Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::db_insert_row(&path, &table, columns, values)).await
}

#[tauri::command]
pub async fn db_delete_rows(
    state: State<'_, AppState>,
    path: String,
    table: String,
    rowids: Vec<i64>,
) -> Result<usize, Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::db_delete_rows(&path, &table, rowids)).await
}

// --- v0.5.0 additions --------------------------------------------------------

#[tauri::command]
pub async fn db_query(
    state: State<'_, AppState>,
    path: String,
    sql: String,
    allow_write: bool,
    max_rows: Option<u32>,
) -> Result<DbRows, Error> {
    if allow_write {
        ensure_within_projects(&state, &path)?;
    }
    blocking(move || fsx::db_query(&path, &sql, allow_write, max_rows.unwrap_or(500))).await
}

#[tauri::command]
pub async fn fs_encodings() -> Result<Vec<String>, Error> {
    Ok(fsx::ENCODINGS.iter().map(|s| s.to_string()).collect())
}

#[tauri::command]
pub async fn fs_detect_encoding(path: String) -> Result<String, Error> {
    blocking(move || fsx::detect_encoding(&path)).await
}

#[tauri::command]
pub async fn fs_read_text_encoded(
    path: String,
    encoding: String,
    max_bytes: Option<u64>,
) -> Result<TextFile, Error> {
    blocking(move || fsx::read_text_encoded(&path, &encoding, max_bytes.unwrap_or(2 * 1024 * 1024)))
        .await
}

#[tauri::command]
pub async fn fs_write_text_encoded(
    state: State<'_, AppState>,
    path: String,
    content: String,
    encoding: String,
) -> Result<(), Error> {
    ensure_within_projects(&state, &path)?;
    blocking(move || fsx::write_text_encoded(&path, &content, &encoding)).await
}
