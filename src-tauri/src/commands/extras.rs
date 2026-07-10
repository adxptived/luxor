//! Commands for the v0.5.0 panels: project search/replace, dev tools
//! (.env / logs / disk / deps), snippets & notes & bookmarks & sessions,
//! the REST scratch pad, registries & vulnerability checks, Docker,
//! the process viewer and crash reports.

use luxor_core::devtools::{self, DepManifest, DiskUsageReport, EnvFile, LogFileInfo};
use luxor_core::dockerx::{self, DockerContainer, DockerImage};
use luxor_core::httpx::{self, HttpRequest, HttpResponse, RegistryPackage, VulnAdvisory};
use luxor_core::notes::{Bookmark, ExtrasStore, SessionSnapshot, Snippet};
use luxor_core::procs::{self, ProcessNode};
use luxor_core::search::{self, ReplaceReport, SearchReport};
use luxor_core::{crashlog, diag, Error};
use std::collections::HashMap;
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

fn store() -> Result<ExtrasStore, Error> {
    ExtrasStore::open(&luxor_core::notes::db_path()?)
}

// -- search -----------------------------------------------------------------

#[tauri::command]
pub async fn search_in_project(
    root: String,
    query: String,
    use_regex: bool,
    case_sensitive: bool,
    max_results: Option<usize>,
) -> Result<SearchReport, Error> {
    blocking(move || {
        search::search_files(
            &root,
            &query,
            use_regex,
            case_sensitive,
            max_results.unwrap_or(1000),
        )
    })
    .await
}

#[tauri::command]
pub async fn replace_in_project(
    state: State<'_, AppState>,
    root: String,
    query: String,
    replacement: String,
    use_regex: bool,
    case_sensitive: bool,
    only_paths: Option<Vec<String>>,
) -> Result<ReplaceReport, Error> {
    ensure_within_projects(&state, &root)?;
    blocking(move || {
        search::replace_in_files(
            &root,
            &query,
            &replacement,
            use_regex,
            case_sensitive,
            &only_paths.unwrap_or_default(),
        )
    })
    .await
}

// -- dev tools ----------------------------------------------------------------

#[tauri::command]
pub async fn env_files(root: String) -> Result<Vec<EnvFile>, Error> {
    blocking(move || devtools::env_files(&root)).await
}

#[tauri::command]
pub async fn log_files(root: String) -> Result<Vec<LogFileInfo>, Error> {
    blocking(move || devtools::log_files(&root)).await
}

#[tauri::command]
pub async fn log_tail(path: String, max_bytes: Option<u64>) -> Result<String, Error> {
    blocking(move || devtools::log_tail(&path, max_bytes.unwrap_or(256 * 1024))).await
}

#[tauri::command]
pub async fn disk_usage(root: String) -> Result<DiskUsageReport, Error> {
    blocking(move || devtools::disk_usage(&root)).await
}

#[tauri::command]
pub async fn dep_manifests(root: String) -> Result<Vec<DepManifest>, Error> {
    blocking(move || devtools::dep_manifests(&root)).await
}

// -- notes / snippets / bookmarks / sessions ---------------------------------

#[tauri::command]
pub async fn note_get(project_id: String) -> Result<String, Error> {
    blocking(move || store()?.note_get(&project_id)).await
}

#[tauri::command]
pub async fn note_set(project_id: String, body: String) -> Result<(), Error> {
    blocking(move || store()?.note_set(&project_id, &body)).await
}

#[tauri::command]
pub async fn snippet_list() -> Result<Vec<Snippet>, Error> {
    blocking(move || store()?.snippet_list()).await
}

#[tauri::command]
pub async fn snippet_save(snippet: Snippet) -> Result<Snippet, Error> {
    blocking(move || store()?.snippet_save(snippet)).await
}

#[tauri::command]
pub async fn snippet_delete(id: String) -> Result<(), Error> {
    blocking(move || store()?.snippet_delete(&id)).await
}

#[tauri::command]
pub async fn bookmark_list(project_id: Option<String>) -> Result<Vec<Bookmark>, Error> {
    blocking(move || store()?.bookmark_list(project_id.as_deref())).await
}

#[tauri::command]
pub async fn bookmark_toggle(
    project_id: Option<String>,
    file: String,
    line: usize,
    note: Option<String>,
) -> Result<Option<Bookmark>, Error> {
    blocking(move || {
        store()?.bookmark_toggle(
            project_id.as_deref(),
            &file,
            line,
            note.as_deref().unwrap_or(""),
        )
    })
    .await
}

#[tauri::command]
pub async fn bookmark_delete(id: String) -> Result<(), Error> {
    blocking(move || store()?.bookmark_delete(&id)).await
}

#[tauri::command]
pub async fn session_list(project_id: Option<String>) -> Result<Vec<SessionSnapshot>, Error> {
    blocking(move || store()?.session_list(project_id.as_deref())).await
}

#[tauri::command]
pub async fn session_save(
    project_id: Option<String>,
    name: String,
    data: String,
) -> Result<SessionSnapshot, Error> {
    blocking(move || store()?.session_save(project_id.as_deref(), &name, &data)).await
}

#[tauri::command]
pub async fn session_delete(id: String) -> Result<(), Error> {
    blocking(move || store()?.session_delete(&id)).await
}

// -- HTTP scratch pad / registries / vulnerabilities --------------------------

#[tauri::command]
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, Error> {
    httpx::http_request(request).await
}

#[tauri::command]
pub async fn registry_search(
    kind: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<RegistryPackage>, Error> {
    httpx::registry_search(&kind, &query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn latest_versions(
    kind: String,
    names: Vec<String>,
) -> Result<HashMap<String, String>, Error> {
    httpx::latest_versions(&kind, &names).await
}

#[tauri::command]
pub async fn osv_check(
    kind: String,
    packages: Vec<(String, String)>,
) -> Result<Vec<VulnAdvisory>, Error> {
    httpx::osv_check(&kind, &packages).await
}

// -- docker -------------------------------------------------------------------

#[tauri::command]
pub async fn docker_version() -> Result<Option<String>, Error> {
    blocking(move || Ok(dockerx::version())).await
}

#[tauri::command]
pub async fn docker_containers(all: bool) -> Result<Vec<DockerContainer>, Error> {
    blocking(move || dockerx::containers(all)).await
}

#[tauri::command]
pub async fn docker_images() -> Result<Vec<DockerImage>, Error> {
    blocking(move || dockerx::images()).await
}

#[tauri::command]
pub async fn docker_logs(container_id: String, tail: Option<usize>) -> Result<String, Error> {
    blocking(move || dockerx::logs(&container_id, tail.unwrap_or(500))).await
}

#[tauri::command]
pub async fn docker_action(container_id: String, action: String) -> Result<(), Error> {
    blocking(move || dockerx::container_action(&container_id, &action)).await
}

/// Audit fix 9.1: the frontend (`ipc.dockerExec`, DockerPanel exec dialog)
/// invoked `docker_exec`, but the command never existed in Rust — every exec
/// failed at runtime with "command not found".
#[tauri::command]
pub async fn docker_exec(container_id: String, command: String) -> Result<String, Error> {
    blocking(move || dockerx::exec(&container_id, &command)).await
}

// -- processes ------------------------------------------------------------------

#[tauri::command]
pub async fn process_tree(root_pid: u32) -> Result<Vec<ProcessNode>, Error> {
    blocking(move || procs::process_tree(root_pid)).await
}

#[tauri::command]
pub async fn process_kill(pid: u32, with_children: bool) -> Result<usize, Error> {
    blocking(move || procs::kill_process(pid, with_children)).await
}

// -- crash reports ----------------------------------------------------------------

#[tauri::command]
pub async fn crash_list() -> Result<Vec<crashlog::CrashReport>, Error> {
    blocking(crashlog::list_crashes).await
}

#[tauri::command]
pub async fn crash_read(name: String) -> Result<String, Error> {
    blocking(move || crashlog::read_crash(&name)).await
}

// -- diagnostics -------------------------------------------------------------------

/// Append a line to the persistent frontend log (JS errors, UI freezes, …).
#[tauri::command]
pub async fn frontend_log(entry: String) -> Result<(), Error> {
    blocking(move || diag::frontend_log(&entry)).await
}

/// Read the tail of the persisted frontend log for the Developer log panel.
#[tauri::command]
pub async fn frontend_log_read() -> Result<String, Error> {
    blocking(move || Ok(diag::frontend_log_tail())).await
}

/// Clear the persisted frontend log (Developer "Clear logs").
#[tauri::command]
pub async fn frontend_log_clear() -> Result<(), Error> {
    blocking(move || diag::frontend_log_clear()).await
}

/// Reveal the folder that holds frontend.log / config in the OS file manager.
#[tauri::command]
pub async fn open_log_folder(app: tauri::AppHandle) -> Result<(), Error> {
    use tauri_plugin_opener::OpenerExt;
    let dir = diag::log_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| Error::Config(format!("failed to open log folder: {e}")))
}

/// Full plain-text diagnostics report for bug reports.
#[tauri::command]
pub async fn diag_collect(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, Error> {
    let version = app.package_info().version.to_string();
    let config_toml = {
        let cfg = state
            .config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        luxor_core::config::to_toml(&cfg)?
    };
    blocking(move || Ok(diag::collect(&version, &config_toml))).await
}
