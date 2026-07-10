//! Git commands. All operations run on blocking threads (libgit2 is sync).
//!
//! Authentication for fetch/pull/push: a token stored in the OS keychain for
//! the remote's host (if any) → git credential helper → ssh-agent.

use luxor_core::gitx::{
    self, BranchInfo, ChangedFile, CommitInfo, DiffTarget, FileBlame, FileDiff, RepoStatus,
    StashEntry,
};
use luxor_core::secrets::{self, SecretKind};
use luxor_core::Error;

async fn blocking<T, F>(f: F) -> Result<T, Error>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, Error> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))?
}

/// Token stored for the repo's remote host, if any. Never logged.
fn stored_token(repo: &str, remote: Option<&str>) -> Option<String> {
    let host = gitx::remote_host(repo, remote).ok().flatten()?;
    secrets::get_optional(SecretKind::GitToken, &host)
        .ok()
        .flatten()
}

/// Repository working-directory root containing `path`, if any.
#[tauri::command]
pub async fn git_discover_root(path: String) -> Result<Option<String>, Error> {
    blocking(move || Ok(gitx::discover_root(&path))).await
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<RepoStatus, Error> {
    blocking(move || gitx::status(&repo_path)).await
}

/// Line-by-line authorship of a tracked file at HEAD.
#[tauri::command]
pub async fn git_blame(repo_path: String, file_path: String) -> Result<FileBlame, Error> {
    blocking(move || gitx::blame_file(&repo_path, &file_path)).await
}

#[tauri::command]
pub async fn git_log(
    repo_path: String,
    limit: Option<usize>,
    from_id: Option<String>,
) -> Result<Vec<CommitInfo>, Error> {
    blocking(move || gitx::log(&repo_path, limit.unwrap_or(200), from_id.as_deref())).await
}

#[tauri::command]
pub async fn git_file_history(
    repo_path: String,
    file_path: String,
    limit: Option<usize>,
) -> Result<Vec<CommitInfo>, Error> {
    blocking(move || gitx::file_history(&repo_path, &file_path, limit.unwrap_or(100))).await
}

#[tauri::command]
pub async fn git_commit_files(
    repo_path: String,
    commit_id: String,
) -> Result<Vec<ChangedFile>, Error> {
    blocking(move || gitx::commit_files(&repo_path, &commit_id)).await
}

/// Aggregate +/- line stats of a commit (vs its first parent).
#[tauri::command]
pub async fn git_commit_stats(
    repo_path: String,
    commit_id: String,
) -> Result<gitx::CommitStats, Error> {
    blocking(move || gitx::commit_stats(&repo_path, &commit_id)).await
}

#[tauri::command]
pub async fn git_file_diff(
    repo_path: String,
    file_path: String,
    target: DiffTarget,
    commit_id: Option<String>,
) -> Result<FileDiff, Error> {
    blocking(move || gitx::file_diff(&repo_path, &file_path, target, commit_id.as_deref())).await
}

#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<BranchInfo>, Error> {
    blocking(move || gitx::branches(&repo_path)).await
}

#[tauri::command]
pub async fn git_stage(repo_path: String, paths: Vec<String>) -> Result<(), Error> {
    blocking(move || gitx::stage(&repo_path, &paths)).await
}

#[tauri::command]
pub async fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), Error> {
    blocking(move || gitx::unstage(&repo_path, &paths)).await
}

#[tauri::command]
pub async fn git_discard(repo_path: String, paths: Vec<String>) -> Result<(), Error> {
    blocking(move || gitx::discard(&repo_path, &paths)).await
}

#[tauri::command]
pub async fn git_commit(
    repo_path: String,
    message: String,
    amend: Option<bool>,
) -> Result<String, Error> {
    blocking(move || {
        if amend.unwrap_or(false) {
            gitx::commit_amend(&repo_path, &message)
        } else {
            gitx::commit(&repo_path, &message)
        }
    })
    .await
}

#[tauri::command]
pub async fn git_last_commit_message(repo_path: String) -> Result<Option<String>, Error> {
    blocking(move || gitx::last_commit_message(&repo_path)).await
}

#[tauri::command]
pub async fn git_branch_create(
    repo_path: String,
    name: String,
    checkout: bool,
) -> Result<(), Error> {
    blocking(move || gitx::create_branch(&repo_path, &name, checkout)).await
}

#[tauri::command]
pub async fn git_branch_checkout(repo_path: String, name: String) -> Result<(), Error> {
    blocking(move || gitx::checkout_branch(&repo_path, &name)).await
}

#[tauri::command]
pub async fn git_branch_delete(repo_path: String, name: String) -> Result<(), Error> {
    blocking(move || gitx::delete_branch(&repo_path, &name)).await
}

#[tauri::command]
pub async fn git_stash_save(repo_path: String, message: Option<String>) -> Result<(), Error> {
    blocking(move || gitx::stash_save(&repo_path, message.as_deref())).await
}

#[tauri::command]
pub async fn git_stash_list(repo_path: String) -> Result<Vec<StashEntry>, Error> {
    blocking(move || gitx::stash_list(&repo_path)).await
}

#[tauri::command]
pub async fn git_stash_apply(repo_path: String, index: usize) -> Result<(), Error> {
    blocking(move || gitx::stash_apply(&repo_path, index)).await
}

#[tauri::command]
pub async fn git_stash_pop(repo_path: String, index: usize) -> Result<(), Error> {
    blocking(move || gitx::stash_pop(&repo_path, index)).await
}

#[tauri::command]
pub async fn git_stash_drop(repo_path: String, index: usize) -> Result<(), Error> {
    blocking(move || gitx::stash_drop(&repo_path, index)).await
}

#[tauri::command]
pub async fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), Error> {
    blocking(move || {
        let token = stored_token(&repo_path, remote.as_deref());
        gitx::fetch(&repo_path, remote.as_deref(), token)
    })
    .await
}

#[tauri::command]
pub async fn git_pull(repo_path: String, remote: Option<String>) -> Result<String, Error> {
    blocking(move || {
        let token = stored_token(&repo_path, remote.as_deref());
        gitx::pull(&repo_path, remote.as_deref(), token)
    })
    .await
}

#[tauri::command]
pub async fn git_push(repo_path: String, remote: Option<String>) -> Result<(), Error> {
    blocking(move || {
        let token = stored_token(&repo_path, remote.as_deref());
        gitx::push(&repo_path, remote.as_deref(), token)
    })
    .await
}

// Keychain access can block for seconds (keychain unlock, OS prompt) — run it
// on the blocking pool like every other heavy command (audit 8.3).

/// Store a personal access token for a git host (kept in the OS keychain).
#[tauri::command]
pub async fn git_token_set(host: String, token: String) -> Result<(), Error> {
    blocking(move || secrets::set(SecretKind::GitToken, &host, &token)).await
}

#[tauri::command]
pub async fn git_token_delete(host: String) -> Result<(), Error> {
    blocking(move || secrets::delete(SecretKind::GitToken, &host)).await
}

#[tauri::command]
pub async fn git_token_exists(host: String) -> Result<bool, Error> {
    blocking(move || secrets::exists(SecretKind::GitToken, &host)).await
}

// --- v0.5.0 additions --------------------------------------------------------

#[tauri::command]
pub async fn git_tags(repo_path: String) -> Result<Vec<gitx::TagInfo>, Error> {
    blocking(move || gitx::tags(&repo_path)).await
}

#[tauri::command]
pub async fn git_tag_create(
    repo_path: String,
    name: String,
    message: Option<String>,
    target: Option<String>,
) -> Result<(), Error> {
    blocking(move || gitx::tag_create(&repo_path, &name, message.as_deref(), target.as_deref()))
        .await
}

#[tauri::command]
pub async fn git_tag_delete(repo_path: String, name: String) -> Result<(), Error> {
    blocking(move || gitx::tag_delete(&repo_path, &name)).await
}

#[tauri::command]
pub async fn git_push_tag(
    repo_path: String,
    name: String,
    remote: Option<String>,
) -> Result<(), Error> {
    blocking(move || {
        let token = stored_token(&repo_path, remote.as_deref());
        gitx::push_tag(&repo_path, &name, remote.as_deref(), token)
    })
    .await
}

#[tauri::command]
pub async fn git_reflog(
    repo_path: String,
    limit: Option<usize>,
) -> Result<Vec<gitx::ReflogEntry>, Error> {
    blocking(move || gitx::reflog(&repo_path, limit.unwrap_or(100))).await
}

#[tauri::command]
pub async fn git_cherry_pick(repo_path: String, commit_id: String) -> Result<String, Error> {
    blocking(move || gitx::cherry_pick(&repo_path, &commit_id)).await
}

#[tauri::command]
pub async fn git_submodules(repo_path: String) -> Result<Vec<gitx::SubmoduleInfo>, Error> {
    blocking(move || gitx::submodules(&repo_path)).await
}

#[tauri::command]
pub async fn git_submodule_update(repo_path: String, name: String) -> Result<(), Error> {
    blocking(move || gitx::submodule_update(&repo_path, &name)).await
}

#[tauri::command]
pub async fn git_conflict_paths(repo_path: String) -> Result<Vec<String>, Error> {
    blocking(move || gitx::conflict_paths(&repo_path)).await
}

#[tauri::command]
pub async fn git_conflict_sides(
    repo_path: String,
    file_path: String,
) -> Result<gitx::ConflictSides, Error> {
    blocking(move || gitx::conflict_sides(&repo_path, &file_path)).await
}

#[tauri::command]
pub async fn git_conflict_resolve(
    repo_path: String,
    file_path: String,
    content: String,
) -> Result<(), Error> {
    blocking(move || gitx::conflict_resolve(&repo_path, &file_path, &content)).await
}
