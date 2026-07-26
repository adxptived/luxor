//! GitHub Issues / PRs / CI commands and the update checker. The stored
//! git token for `github.com` (Settings → Git) is reused automatically.

use luxor_core::github::{self, GhComment, GhIssue, GhPull, GhRun, RepoRef};
use luxor_core::secrets::{self, SecretKind};
use luxor_core::updatex::{self, UpdateInfo};
use luxor_core::Error;

fn token() -> Option<String> {
    secrets::get_optional(SecretKind::GitToken, "github.com")
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn github_repo(path: String) -> Result<Option<RepoRef>, Error> {
    tauri::async_runtime::spawn_blocking(move || github::repo_from_path(&path))
        .await
        .map_err(|e| Error::InvalidInput(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn github_issues(slug: String, state: String) -> Result<Vec<GhIssue>, Error> {
    github::issues(&slug, &state, token().as_deref()).await
}

#[tauri::command]
pub async fn github_issue_comments(slug: String, number: u64) -> Result<Vec<GhComment>, Error> {
    github::issue_comments(&slug, number, token().as_deref()).await
}

#[tauri::command]
pub async fn github_issue_create(
    slug: String,
    title: String,
    body: String,
) -> Result<GhIssue, Error> {
    github::issue_create(&slug, &title, &body, token().as_deref()).await
}

#[tauri::command]
pub async fn github_comment_add(slug: String, number: u64, text: String) -> Result<(), Error> {
    github::issue_comment_add(&slug, number, &text, token().as_deref()).await
}

#[tauri::command]
pub async fn github_pulls(slug: String, state: String) -> Result<Vec<GhPull>, Error> {
    github::pulls(&slug, &state, token().as_deref()).await
}

#[tauri::command]
pub async fn github_pull_create(
    slug: String,
    title: String,
    body: String,
    head: String,
    base: String,
    draft: bool,
) -> Result<GhPull, Error> {
    github::pull_create(
        &slug,
        &title,
        &body,
        &head,
        &base,
        draft,
        token().as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn github_runs(slug: String) -> Result<Vec<GhRun>, Error> {
    github::runs(&slug, token().as_deref()).await
}

#[tauri::command]
pub async fn update_check(repo_slug: String) -> Result<UpdateInfo, Error> {
    updatex::check(&repo_slug, env!("CARGO_PKG_VERSION")).await
}
