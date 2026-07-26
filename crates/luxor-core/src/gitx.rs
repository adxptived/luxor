//! Git explorer & actions via `git2` (vendored libgit2 — no system git required).
//!
//! Read: status, file diffs (old/new content for Monaco), commit log with parents
//! (for graph rendering), single-file history, branches.
//! Write: stage/unstage, commit, branch create/checkout/delete, stash, discard,
//! fetch/pull/push with credential-helper + ssh-agent + stored-token auth.

use std::path::{Component, Path};

use git2::{
    build::CheckoutBuilder, BranchType, Cred, CredentialType, Delta, ErrorCode, FetchOptions,
    ObjectType, PushOptions, RemoteCallbacks, Repository, Signature, Sort, StatusOptions,
};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileState {
    New,
    Modified,
    Deleted,
    Renamed,
    Typechange,
    Conflicted,
    Untracked,
    Ignored,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    pub path: String,
    /// State in the index (staged), if any.
    pub staged: Option<FileState>,
    /// State in the worktree (unstaged), if any.
    pub unstaged: Option<FileState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoStatus {
    pub branch: Option<String>,
    pub head_detached: bool,
    pub ahead: usize,
    pub behind: usize,
    pub entries: Vec<StatusEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

/// Both sides of a file for the Monaco diff editor.
#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
    /// True when either side is binary; contents are empty in that case.
    pub binary: bool,
}

/// Which diff to show for a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffTarget {
    /// Worktree vs index (unstaged changes).
    Worktree,
    /// Index vs HEAD (staged changes).
    Index,
    /// A commit vs its first parent.
    Commit,
}

#[derive(Debug, Clone, Serialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub state: FileState,
    /// Lines added in this file (commit diffs only; 0 elsewhere).
    #[serde(default)]
    pub insertions: usize,
    /// Lines removed in this file (commit diffs only; 0 elsewhere).
    #[serde(default)]
    pub deletions: usize,
}

/// Aggregate stats of one commit (vs its first parent).
#[derive(Debug, Clone, Serialize)]
pub struct CommitStats {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn open_repo(path: &str) -> Result<Repository> {
    Repository::discover(path).map_err(Error::from)
}

fn delta_to_state(delta: Delta) -> Option<FileState> {
    match delta {
        Delta::Added => Some(FileState::New),
        Delta::Deleted => Some(FileState::Deleted),
        Delta::Modified => Some(FileState::Modified),
        Delta::Renamed => Some(FileState::Renamed),
        Delta::Typechange => Some(FileState::Typechange),
        Delta::Conflicted => Some(FileState::Conflicted),
        Delta::Untracked => Some(FileState::Untracked),
        Delta::Ignored => Some(FileState::Ignored),
        _ => None,
    }
}

fn validate_repo_relative_path(file_path: &str) -> Result<&Path> {
    let path = Path::new(file_path);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(Error::InvalidInput(format!(
            "invalid repo-relative path: {file_path}"
        )));
    }
    Ok(path)
}

fn signature(repo: &Repository) -> Result<Signature<'static>> {
    repo.signature().map_err(|_| {
        Error::InvalidInput(
            "git user.name / user.email are not configured for this repository".into(),
        )
    })
}

/// Credential callbacks: stored token (keyring) → credential helper → ssh-agent → default.
fn remote_callbacks<'a>(stored_token: Option<String>) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(token) = &stored_token {
                let user = username_from_url.unwrap_or("git");
                return Cred::userpass_plaintext(user, token);
            }
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            if let Some(user) = username_from_url {
                return Cred::ssh_key_from_agent(user);
            }
        }
        if allowed.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }
        Err(git2::Error::from_str("no usable authentication method"))
    });
    callbacks
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/// Full repository status incl. branch and ahead/behind counts.
pub fn status(repo_path: &str) -> Result<RepoStatus> {
    let repo = open_repo(repo_path)?;

    let (branch, head_detached) = match repo.head() {
        Ok(head) => {
            let name = head.shorthand().map(|s| s.to_string());
            (name, repo.head_detached().unwrap_or(false))
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => (None, false),
        Err(e) => return Err(e.into()),
    };

    let (ahead, behind) = ahead_behind(&repo).unwrap_or((0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut entries = Vec::new();
    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry.path().unwrap_or_default().to_string();
        let staged = if s.is_index_new() {
            Some(FileState::New)
        } else if s.is_index_modified() {
            Some(FileState::Modified)
        } else if s.is_index_deleted() {
            Some(FileState::Deleted)
        } else if s.is_index_renamed() {
            Some(FileState::Renamed)
        } else if s.is_index_typechange() {
            Some(FileState::Typechange)
        } else {
            None
        };
        let unstaged = if s.is_conflicted() {
            Some(FileState::Conflicted)
        } else if s.is_wt_new() {
            Some(FileState::Untracked)
        } else if s.is_wt_modified() {
            Some(FileState::Modified)
        } else if s.is_wt_deleted() {
            Some(FileState::Deleted)
        } else if s.is_wt_renamed() {
            Some(FileState::Renamed)
        } else if s.is_wt_typechange() {
            Some(FileState::Typechange)
        } else {
            None
        };
        if staged.is_some() || unstaged.is_some() {
            entries.push(StatusEntry {
                path,
                staged,
                unstaged,
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(RepoStatus {
        branch,
        head_detached,
        ahead,
        behind,
        entries,
    })
}

fn ahead_behind(repo: &Repository) -> Result<(usize, usize)> {
    let head = repo.head()?;
    let local_oid = head
        .target()
        .ok_or_else(|| Error::NotFound("HEAD target".into()))?;
    let branch = git2::Branch::wrap(head);
    let upstream = branch.upstream().map_err(Error::from)?;
    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| Error::NotFound("upstream target".into()))?;
    Ok(repo.graph_ahead_behind(local_oid, upstream_oid)?)
}

/// Commit log starting at HEAD (or `from_id`), newest first.
pub fn log(repo_path: &str, limit: usize, from_id: Option<&str>) -> Result<Vec<CommitInfo>> {
    let repo = open_repo(repo_path)?;
    if from_id.is_none() && repo.is_empty()? {
        return Ok(Vec::new());
    }
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    match from_id {
        Some(id) => revwalk.push(git2::Oid::from_str(id).map_err(Error::from)?)?,
        None => match revwalk.push_head() {
            Ok(()) => {}
            Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => {
                return Ok(Vec::new())
            }
            Err(e) => return Err(e.into()),
        },
    }
    let mut commits = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        commits.push(commit_info(&commit));
    }
    Ok(commits)
}

/// One row of the commit-graph layout: which lane (column) the commit sits in,
/// the columns its parents continue into, and how many lanes are active on this
/// row (so the UI knows how wide to draw). Newest-first, matching [`log`].
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GraphRow {
    /// Commit id this row represents.
    pub id: String,
    /// Lane (0-based column) the commit dot is drawn in.
    pub column: usize,
    /// Lanes that this commit's parents continue down into (first parent first).
    /// A merge commit has 2+; a root commit has none.
    pub parent_columns: Vec<usize>,
    /// Number of lanes alive on this row (max column index + 1), for layout width.
    pub width: usize,
}

/// Assign render lanes (columns) to an ordered, newest-first list of commits
/// (as returned by [`log`]) so the UI can draw a branch/merge graph instead of a
/// flat list (#30). Pure and deterministic — no repo access — so it is fully
/// unit-testable and can run client- or server-side.
///
/// Algorithm: keep a vector of "lanes", each remembering the commit id it is
/// currently waiting to draw. For each commit we find the lane expecting it
/// (allocating one for a branch tip), collapse any duplicate lanes that a merge
/// produced, then route the first parent down the same lane and extra parents
/// into reused or freshly allocated lanes.
pub fn commit_graph(commits: &[CommitInfo]) -> Vec<GraphRow> {
    // `lanes[i]` = Some(commit_id) the lane is waiting to place, or None if free.
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());

    for c in commits {
        // All lanes currently expecting this commit (a merge target appears in
        // more than one). The leftmost becomes this commit's column.
        let expecting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.as_deref() == Some(c.id.as_str()))
            .map(|(i, _)| i)
            .collect();
        let column = match expecting.first() {
            Some(&i) => i,
            None => {
                // Unreferenced tip (e.g. the newest commit): take a free lane.
                match lanes.iter().position(Option::is_none) {
                    Some(i) => {
                        lanes[i] = Some(c.id.clone());
                        i
                    }
                    None => {
                        lanes.push(Some(c.id.clone()));
                        lanes.len() - 1
                    }
                }
            }
        };
        // Free the duplicate lanes a merge created (keep `column`).
        for &i in expecting.iter().skip(1) {
            lanes[i] = None;
        }

        // Route parents: first parent stays in this column; extras get lanes.
        let mut parent_columns = Vec::new();
        match c.parents.split_first() {
            Some((first, rest)) => {
                lanes[column] = Some(first.clone());
                parent_columns.push(column);
                for p in rest {
                    let pc = match lanes.iter().position(|l| l.as_deref() == Some(p.as_str())) {
                        Some(i) => i,
                        None => match lanes.iter().position(Option::is_none) {
                            Some(i) => {
                                lanes[i] = Some(p.clone());
                                i
                            }
                            None => {
                                lanes.push(Some(p.clone()));
                                lanes.len() - 1
                            }
                        },
                    };
                    parent_columns.push(pc);
                }
            }
            None => {
                // Root commit: the lane ends here.
                lanes[column] = None;
            }
        }

        let width = lanes
            .iter()
            .rposition(Option::is_some)
            .map(|i| i + 1)
            .unwrap_or(0)
            .max(column + 1);
        rows.push(GraphRow {
            id: c.id.clone(),
            column,
            parent_columns,
            width,
        });

        // Trim trailing free lanes so width stays tight on later rows.
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
    }

    rows
}

/// History of a single file (commits that touched `file_path`).
pub fn file_history(repo_path: &str, file_path: &str, limit: usize) -> Result<Vec<CommitInfo>> {
    let repo = open_repo(repo_path)?;
    if repo.is_empty()? {
        return Ok(Vec::new());
    }
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    match revwalk.push_head() {
        Ok(()) => {}
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => {
            return Ok(Vec::new())
        }
        Err(e) => return Err(e.into()),
    }
    let target = Path::new(file_path);
    let mut commits = Vec::new();
    for oid in revwalk {
        if commits.len() >= limit {
            break;
        }
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;
        let entry_now = tree.get_path(target).ok().map(|e| e.id());
        let touched = if commit.parent_count() == 0 {
            entry_now.is_some()
        } else {
            let parent_tree = commit.parent(0)?.tree()?;
            let entry_before = parent_tree.get_path(target).ok().map(|e| e.id());
            entry_now != entry_before
        };
        if touched {
            commits.push(commit_info(&commit));
        }
    }
    Ok(commits)
}

/// One blame annotation block: `lines` consecutive lines starting at
/// `start_line` (1-based) that were last changed by `commit_id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlameHunk {
    pub start_line: u32,
    pub lines: u32,
    pub commit_id: String,
    pub short_id: String,
    pub author: String,
    /// Unix seconds of the commit.
    pub time: i64,
    pub summary: String,
}

/// Blame result: annotation hunks plus the blamed (HEAD) file content, so the
/// UI always shows lines consistent with the annotations even when the
/// working tree has uncommitted edits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileBlame {
    pub hunks: Vec<BlameHunk>,
    pub lines: Vec<String>,
    pub truncated: bool,
}

/// Maximum number of content lines returned by [`blame_file`].
const BLAME_MAX_LINES: usize = 20_000;

/// Line-by-line authorship of `file_path` (relative to the repo root) at HEAD.
pub fn blame_file(repo_path: &str, file_path: &str) -> Result<FileBlame> {
    let repo = open_repo(repo_path)?;
    if repo.is_empty()? {
        return Err(Error::InvalidInput("repository has no commits yet".into()));
    }
    let target = Path::new(file_path);

    // Content of the blamed revision (HEAD), not the working tree.
    let tree = repo.head()?.peel_to_tree()?;
    let entry = tree
        .get_path(target)
        .map_err(|_| Error::NotFound(format!("{file_path} is not tracked at HEAD")))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|_| Error::NotFound(format!("{file_path} is not a regular file")))?;
    let content = String::from_utf8_lossy(blob.content()).to_string();
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let truncated = lines.len() > BLAME_MAX_LINES;
    lines.truncate(BLAME_MAX_LINES);

    let blame = repo.blame_file(target, None)?;
    let mut hunks = Vec::with_capacity(blame.len());
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (author, time, summary) = match repo.find_commit(oid) {
            Ok(commit) => (
                commit.author().name().unwrap_or("?").to_string(),
                commit.time().seconds(),
                commit.summary().unwrap_or("").to_string(),
            ),
            Err(_) => (
                "Uncommitted".to_string(),
                0,
                "Not committed yet".to_string(),
            ),
        };
        hunks.push(BlameHunk {
            start_line: hunk.final_start_line() as u32,
            lines: hunk.lines_in_hunk() as u32,
            commit_id: oid.to_string(),
            short_id: oid.to_string().chars().take(7).collect(),
            author,
            time,
            summary,
        });
    }
    hunks.sort_by_key(|h| h.start_line);
    Ok(FileBlame {
        hunks,
        lines,
        truncated,
    })
}

fn commit_info(commit: &git2::Commit<'_>) -> CommitInfo {
    CommitInfo {
        id: commit.id().to_string(),
        short_id: commit.id().to_string()[..7].to_string(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        author: commit.author().name().unwrap_or("?").to_string(),
        email: commit.author().email().unwrap_or("").to_string(),
        time: commit.time().seconds(),
        summary: commit.summary().unwrap_or("").to_string(),
        message: commit.message().unwrap_or("").to_string(),
    }
}

/// Files changed by a commit (vs its first parent).
pub fn commit_files(repo_path: &str, commit_id: &str) -> Result<Vec<ChangedFile>> {
    let repo = open_repo(repo_path)?;
    let commit = repo.find_commit(git2::Oid::from_str(commit_id)?)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    let mut files = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        if let Some(state) = delta_to_state(delta.status()) {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Per-file line counts (best effort; binary files report 0/0).
            let (insertions, deletions) = git2::Patch::from_diff(&diff, idx)
                .ok()
                .flatten()
                .and_then(|p| p.line_stats().ok())
                .map(|(_, add, del)| (add, del))
                .unwrap_or((0, 0));
            files.push(ChangedFile {
                path,
                state,
                insertions,
                deletions,
            });
        }
    }
    Ok(files)
}

/// Aggregate +/- line stats of a commit (vs its first parent).
pub fn commit_stats(repo_path: &str, commit_id: &str) -> Result<CommitStats> {
    let repo = open_repo(repo_path)?;
    let commit = repo.find_commit(git2::Oid::from_str(commit_id)?)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
    let stats = diff.stats()?;
    Ok(CommitStats {
        files_changed: stats.files_changed(),
        insertions: stats.insertions(),
        deletions: stats.deletions(),
    })
}

const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;

fn blob_text(repo: &Repository, oid: git2::Oid) -> Result<(String, bool)> {
    if oid.is_zero() {
        return Ok((String::new(), false));
    }
    let blob = repo.find_blob(oid)?;
    if blob.is_binary() || blob.size() > MAX_DIFF_BYTES {
        return Ok((String::new(), true));
    }
    Ok((String::from_utf8_lossy(blob.content()).into_owned(), false))
}

fn workdir_text(repo: &Repository, rel_path: &str) -> Result<(String, bool)> {
    let rel = validate_repo_relative_path(rel_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::InvalidInput("bare repository".into()))?;
    let abs = workdir.join(rel);
    if !abs.exists() {
        return Ok((String::new(), false));
    }
    let bytes = std::fs::read(&abs)?;
    if bytes.len() > MAX_DIFF_BYTES || bytes.iter().take(8000).any(|&b| b == 0) {
        return Ok((String::new(), true));
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), false))
}

/// Old/new content of one file for the Monaco diff editor.
pub fn file_diff(
    repo_path: &str,
    file_path: &str,
    target: DiffTarget,
    commit_id: Option<&str>,
) -> Result<FileDiff> {
    let repo = open_repo(repo_path)?;
    let rel = validate_repo_relative_path(file_path)?;

    let (old, new) = match target {
        DiffTarget::Worktree => {
            // index → worktree
            let index = repo.index()?;
            let old = match index.get_path(rel, 0) {
                Some(entry) => blob_text(&repo, entry.id)?,
                None => (String::new(), false),
            };
            let new = workdir_text(&repo, file_path)?;
            (old, new)
        }
        DiffTarget::Index => {
            // HEAD → index
            let old = match repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
                Some(tree) => match tree.get_path(rel) {
                    Ok(entry) => blob_text(&repo, entry.id())?,
                    Err(_) => (String::new(), false),
                },
                None => (String::new(), false),
            };
            let index = repo.index()?;
            let new = match index.get_path(rel, 0) {
                Some(entry) => blob_text(&repo, entry.id)?,
                None => (String::new(), false),
            };
            (old, new)
        }
        DiffTarget::Commit => {
            let id = commit_id
                .ok_or_else(|| Error::InvalidInput("commit_id required for commit diff".into()))?;
            let commit = repo.find_commit(git2::Oid::from_str(id)?)?;
            let new_tree = commit.tree()?;
            let new = match new_tree.get_path(rel) {
                Ok(entry) => blob_text(&repo, entry.id())?,
                Err(_) => (String::new(), false),
            };
            let old = if commit.parent_count() > 0 {
                let old_tree = commit.parent(0)?.tree()?;
                match old_tree.get_path(rel) {
                    Ok(entry) => blob_text(&repo, entry.id())?,
                    Err(_) => (String::new(), false),
                }
            } else {
                (String::new(), false)
            };
            (old, new)
        }
    };

    Ok(FileDiff {
        path: file_path.to_string(),
        binary: old.1 || new.1,
        old_content: old.0,
        new_content: new.0,
    })
}

/// Local and remote branches.
pub fn branches(repo_path: &str) -> Result<Vec<BranchInfo>> {
    let repo = open_repo(repo_path)?;
    let mut result = Vec::new();
    for item in repo.branches(None)? {
        let (branch, branch_type) = item?;
        let Some(name) = branch.name()?.map(|s| s.to_string()) else {
            continue;
        };
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));
        result.push(BranchInfo {
            is_head: branch.is_head(),
            is_remote: branch_type == BranchType::Remote,
            name,
            upstream,
        });
    }
    result.sort_by(|a, b| (a.is_remote, &a.name).cmp(&(b.is_remote, &b.name)));
    Ok(result)
}

/// Host name of a remote's URL (used to look up stored git tokens).
/// Supports `https://host/...`, `ssh://git@host/...` and `git@host:path` forms.
pub fn remote_host(repo_path: &str, remote: Option<&str>) -> Result<Option<String>> {
    let repo = open_repo(repo_path)?;
    let remote = match repo.find_remote(remote.unwrap_or("origin")) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    Ok(remote.url().and_then(parse_host))
}

fn parse_host(url: &str) -> Option<String> {
    if let Some(rest) = url.split("://").nth(1) {
        let after_auth = rest.rsplit('@').next().unwrap_or(rest);
        let host = after_auth.split(['/', ':']).next()?;
        return (!host.is_empty()).then(|| host.to_string());
    }
    // scp-like: git@github.com:user/repo.git
    if let Some(rest) = url.split('@').nth(1) {
        let host = rest.split(':').next()?;
        return (!host.is_empty()).then(|| host.to_string());
    }
    None
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/// Stage paths (empty slice = stage everything).
pub fn stage(repo_path: &str, paths: &[String]) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let mut index = repo.index()?;
    if paths.is_empty() {
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    } else {
        for path in paths {
            let rel = Path::new(path);
            let workdir = repo
                .workdir()
                .ok_or_else(|| Error::InvalidInput("bare repository".into()))?;
            if workdir.join(rel).exists() {
                index.add_path(rel)?;
            } else {
                // Deleted file: record removal.
                index.remove_path(rel)?;
            }
        }
    }
    index.write()?;
    Ok(())
}

/// Unstage paths (empty slice = unstage everything).
pub fn unstage(repo_path: &str, paths: &[String]) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let head = match repo.head() {
        Ok(head) => Some(head.peel(ObjectType::Commit)?),
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };
    match head {
        Some(target) => {
            let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
            let reset_paths: Option<&[&str]> = if paths.is_empty() {
                None
            } else {
                Some(&path_refs)
            };
            match reset_paths {
                Some(p) => repo.reset_default(Some(&target), p)?,
                None => repo.reset_default(Some(&target), ["*"])?,
            }
        }
        None => {
            // No commits yet: clearing the index entry is the unstage.
            let mut index = repo.index()?;
            if paths.is_empty() {
                index.clear()?;
            } else {
                for path in paths {
                    index.remove_path(Path::new(path))?;
                }
            }
            index.write()?;
        }
    }
    Ok(())
}

/// Discard worktree changes for `paths` (restore from index/HEAD). Destructive.
pub fn discard(repo_path: &str, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Err(Error::InvalidInput(
            "discard requires explicit paths".into(),
        ));
    }
    let repo = open_repo(repo_path)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force().remove_untracked(false);
    for path in paths {
        checkout.path(path);
    }
    repo.checkout_index(None, Some(&mut checkout))?;
    Ok(())
}

/// Create a commit from the current index.
pub fn commit(repo_path: &str, message: &str) -> Result<String> {
    if message.trim().is_empty() {
        return Err(Error::InvalidInput("commit message cannot be empty".into()));
    }
    let repo = open_repo(repo_path)?;
    let sig = signature(&repo)?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(oid.to_string())
}

/// Amend the HEAD commit: replace its message and tree with the current index.
pub fn commit_amend(repo_path: &str, message: &str) -> Result<String> {
    if message.trim().is_empty() {
        return Err(Error::InvalidInput("commit message cannot be empty".into()));
    }
    let repo = open_repo(repo_path)?;
    let head = match repo.head() {
        Ok(head) => head.peel_to_commit()?,
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            return Err(Error::InvalidInput(
                "nothing to amend: repository has no commits yet".into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let oid = head.amend(Some("HEAD"), None, None, None, Some(message), Some(&tree))?;
    Ok(oid.to_string())
}

/// Find the repository working-directory root containing `path`, if any.
pub fn discover_root(path: &str) -> Option<String> {
    let repo = Repository::discover(path).ok()?;
    repo.workdir()
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| Some(repo.path().to_string_lossy().into_owned()))
}

/// Message of the HEAD commit, if any (used to prefill an amend).
pub fn last_commit_message(repo_path: &str) -> Result<Option<String>> {
    let repo = open_repo(repo_path)?;
    let message = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit()?;
            Some(commit.message().unwrap_or("").to_string())
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };
    Ok(message)
}

/// Create a branch at HEAD (optionally checking it out).
pub fn create_branch(repo_path: &str, name: &str, checkout: bool) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let head_commit = repo.head()?.peel_to_commit()?;
    repo.branch(name, &head_commit, false)?;
    if checkout {
        checkout_branch(repo_path, name)?;
    }
    Ok(())
}

/// Checkout a local branch by name.
pub fn checkout_branch(repo_path: &str, name: &str) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let refname = format!("refs/heads/{name}");
    let obj = repo.revparse_single(&refname)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(&obj, Some(&mut checkout))?;
    repo.set_head(&refname)?;
    Ok(())
}

/// Delete a local branch.
pub fn delete_branch(repo_path: &str, name: &str) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    if branch.is_head() {
        return Err(Error::InvalidInput(
            "cannot delete the currently checked-out branch".into(),
        ));
    }
    branch.delete()?;
    Ok(())
}

/// Stash worktree changes.
pub fn stash_save(repo_path: &str, message: Option<&str>) -> Result<()> {
    let mut repo = open_repo(repo_path)?;
    let sig = signature(&repo)?;
    repo.stash_save(&sig, message.unwrap_or("luxor stash"), None)?;
    Ok(())
}

/// List stashes.
pub fn stash_list(repo_path: &str) -> Result<Vec<StashEntry>> {
    let mut repo = open_repo(repo_path)?;
    let mut entries = Vec::new();
    repo.stash_foreach(|index, message, _oid| {
        entries.push(StashEntry {
            index,
            message: message.to_string(),
        });
        true
    })?;
    Ok(entries)
}

/// Apply a stash by index, keeping it in the stash list.
pub fn stash_apply(repo_path: &str, index: usize) -> Result<()> {
    let mut repo = open_repo(repo_path)?;
    repo.stash_apply(index, None)?;
    Ok(())
}

/// Pop a stash by index (apply + remove).
pub fn stash_pop(repo_path: &str, index: usize) -> Result<()> {
    let mut repo = open_repo(repo_path)?;
    repo.stash_pop(index, None)?;
    Ok(())
}

/// Drop a stash by index without applying it.
pub fn stash_drop(repo_path: &str, index: usize) -> Result<()> {
    let mut repo = open_repo(repo_path)?;
    repo.stash_drop(index)?;
    Ok(())
}

/// Fetch a remote (default `origin`).
pub fn fetch(repo_path: &str, remote: Option<&str>, token: Option<String>) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let mut remote = repo.find_remote(remote.unwrap_or("origin"))?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(remote_callbacks(token));
    remote.fetch(&[] as &[&str], Some(&mut opts), None)?;
    Ok(())
}

/// Pull = fetch + fast-forward merge of the current branch.
/// Non-fast-forward merges are reported as errors (resolve in a real terminal).
pub fn pull(repo_path: &str, remote_name: Option<&str>, token: Option<String>) -> Result<String> {
    fetch(repo_path, remote_name, token)?;
    let repo = open_repo(repo_path)?;
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| Error::InvalidInput("detached HEAD; cannot pull".into()))?
        .to_string();
    let local_branch = repo.find_branch(&branch_name, BranchType::Local)?;
    let upstream = local_branch
        .upstream()
        .map_err(|_| Error::InvalidInput(format!("branch {branch_name} has no upstream")))?;
    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| Error::NotFound("upstream target".into()))?;
    let annotated = repo.find_annotated_commit(upstream_oid)?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;

    if analysis.is_up_to_date() {
        return Ok("up_to_date".into());
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch_name}");
        let mut reference = repo.find_reference(&refname)?;
        reference.set_target(upstream_oid, "luxor: fast-forward pull")?;
        repo.set_head(&refname)?;
        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        repo.checkout_head(Some(&mut checkout))?;
        return Ok("fast_forwarded".into());
    }
    Err(Error::InvalidInput(
        "pull requires a merge; run it from a terminal to resolve conflicts".into(),
    ))
}

/// Push the current branch to its upstream (or `origin/<branch>`).
pub fn push(repo_path: &str, remote_name: Option<&str>, token: Option<String>) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .ok_or_else(|| Error::InvalidInput("detached HEAD; cannot push".into()))?
        .to_string();
    let mut remote = repo.find_remote(remote_name.unwrap_or("origin"))?;
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    let mut opts = PushOptions::new();
    opts.remote_callbacks(remote_callbacks(token));
    remote.push(&[refspec.as_str()], Some(&mut opts))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub name: String,
    /// Commit the tag (or its target) points to.
    pub target_id: String,
    pub short_target: String,
    /// Annotation message, if the tag is annotated.
    pub message: Option<String>,
    pub annotated: bool,
}

pub fn tags(repo_path: &str) -> Result<Vec<TagInfo>> {
    let repo = open_repo(repo_path)?;
    let mut out = Vec::new();
    repo.tag_foreach(|oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes)
            .trim_start_matches("refs/tags/")
            .to_string();
        let (target, message, annotated) = match repo.find_tag(oid) {
            Ok(tag) => (
                tag.target_id().to_string(),
                tag.message().map(|m| m.trim().to_string()),
                true,
            ),
            Err(_) => (oid.to_string(), None, false),
        };
        out.push(TagInfo {
            short_target: target.chars().take(7).collect(),
            name,
            target_id: target,
            message,
            annotated,
        });
        true
    })?;
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

/// Create a tag at `target` (commit id or ref; None = HEAD). A non-empty
/// `message` creates an annotated tag, otherwise a lightweight one.
pub fn tag_create(
    repo_path: &str,
    name: &str,
    message: Option<&str>,
    target: Option<&str>,
) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let obj = match target {
        Some(spec) => repo.revparse_single(spec)?,
        None => repo.revparse_single("HEAD")?,
    };
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(msg) => {
            let sig = signature(&repo)?;
            repo.tag(name, &obj, &sig, msg, false)?;
        }
        None => {
            repo.tag_lightweight(name, &obj, false)?;
        }
    }
    Ok(())
}

pub fn tag_delete(repo_path: &str, name: &str) -> Result<()> {
    let repo = open_repo(repo_path)?;
    repo.tag_delete(name)?;
    Ok(())
}

/// Push a single tag to a remote.
pub fn push_tag(
    repo_path: &str,
    name: &str,
    remote_name: Option<&str>,
    token: Option<String>,
) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let mut remote = repo.find_remote(remote_name.unwrap_or("origin"))?;
    let refspec = format!("refs/tags/{name}:refs/tags/{name}");
    let mut opts = PushOptions::new();
    opts.remote_callbacks(remote_callbacks(token));
    remote.push(&[refspec.as_str()], Some(&mut opts))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reflog
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ReflogEntry {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub committer: String,
    pub time: i64,
}

/// HEAD movement history, newest first.
pub fn reflog(repo_path: &str, limit: usize) -> Result<Vec<ReflogEntry>> {
    let repo = open_repo(repo_path)?;
    let log = repo.reflog("HEAD")?;
    let mut out = Vec::new();
    for entry in log.iter().take(limit) {
        let id = entry.id_new().to_string();
        out.push(ReflogEntry {
            short_id: id.chars().take(7).collect(),
            id,
            message: entry.message().unwrap_or_default().to_string(),
            committer: entry.committer().name().unwrap_or_default().to_string(),
            time: entry.committer().when().seconds(),
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Cherry-pick
// ---------------------------------------------------------------------------

/// Apply `commit_id` onto the current HEAD. Returns the new commit id, or an
/// error listing conflicted files (the working tree keeps the conflict
/// markers so the user can resolve them in the conflict editor).
pub fn cherry_pick(repo_path: &str, commit_id: &str) -> Result<String> {
    let repo = open_repo(repo_path)?;
    let commit = repo.find_commit(git2::Oid::from_str(commit_id).map_err(Error::from)?)?;
    repo.cherrypick(&commit, None)?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        let files: Vec<String> = index
            .conflicts()?
            .filter_map(|c| c.ok())
            .filter_map(|c| {
                c.our
                    .as_ref()
                    .or(c.their.as_ref())
                    .map(|e| String::from_utf8_lossy(&e.path).to_string())
            })
            .collect();
        return Err(Error::InvalidInput(format!(
            "cherry-pick has conflicts in: {} — resolve them in the Git panel, then commit",
            files.join(", ")
        )));
    }
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = signature(&repo)?;
    let head = repo.head()?.peel_to_commit()?;
    let message = format!(
        "{}\n\n(cherry picked from commit {})",
        commit.message().unwrap_or_default().trim_end(),
        commit.id()
    );
    let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head])?;
    repo.cleanup_state()?;
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.checkout_head(Some(&mut co))?;
    Ok(oid.to_string())
}

// ---------------------------------------------------------------------------
// Submodules
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub head_id: Option<String>,
}

pub fn submodules(repo_path: &str) -> Result<Vec<SubmoduleInfo>> {
    let repo = open_repo(repo_path)?;
    let mut out = Vec::new();
    for s in repo.submodules()? {
        out.push(SubmoduleInfo {
            name: s.name().unwrap_or_default().to_string(),
            path: s.path().to_string_lossy().to_string(),
            url: s.url().map(|u| u.to_string()),
            head_id: s.head_id().map(|o| o.to_string()),
        });
    }
    Ok(out)
}

/// `git submodule update --init` for one submodule.
pub fn submodule_update(repo_path: &str, name: &str) -> Result<()> {
    let repo = open_repo(repo_path)?;
    let mut sm = repo.find_submodule(name)?;
    sm.update(true, None)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Merge conflicts (three-way resolver)
// ---------------------------------------------------------------------------

/// The three sides of a conflicted file for a three-way merge editor.
#[derive(Debug, Clone, Serialize)]
pub struct ConflictSides {
    pub path: String,
    pub base: String,
    pub ours: String,
    pub theirs: String,
    /// Current worktree content (with conflict markers).
    pub current: String,
}

/// Paths currently in conflict in the index.
pub fn conflict_paths(repo_path: &str) -> Result<Vec<String>> {
    let repo = open_repo(repo_path)?;
    let index = repo.index()?;
    let mut out: Vec<String> = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .filter_map(|c| {
            c.our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).to_string())
        })
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

pub fn conflict_sides(repo_path: &str, file_path: &str) -> Result<ConflictSides> {
    let rel = validate_repo_relative_path(file_path)?;
    let repo = open_repo(repo_path)?;
    let index = repo.index()?;
    let read_blob = |entry: &Option<git2::IndexEntry>| -> String {
        entry
            .as_ref()
            .and_then(|e| repo.find_blob(e.id).ok())
            .map(|b| String::from_utf8_lossy(b.content()).to_string())
            .unwrap_or_default()
    };
    let conflict = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .find(|c| {
            c.our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path) == file_path)
                .unwrap_or(false)
        })
        .ok_or_else(|| Error::NotFound(format!("no conflict for {file_path}")))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::InvalidInput("bare repository".into()))?;
    let current = std::fs::read_to_string(workdir.join(rel)).unwrap_or_default();
    Ok(ConflictSides {
        path: file_path.to_string(),
        base: read_blob(&conflict.ancestor),
        ours: read_blob(&conflict.our),
        theirs: read_blob(&conflict.their),
        current,
    })
}

/// Write the resolved content and mark the conflict as resolved (stage it).
pub fn conflict_resolve(repo_path: &str, file_path: &str, content: &str) -> Result<()> {
    let rel = validate_repo_relative_path(file_path)?;
    let repo = open_repo(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::InvalidInput("bare repository".into()))?;
    std::fs::write(workdir.join(rel), content)
        .map_err(|e| Error::InvalidInput(format!("write {file_path}: {e}")))?;
    let mut index = repo.index()?;
    index.remove_path(rel).ok();
    index.add_path(rel)?;
    index.write()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn temp_repo() -> (TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test User").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        // Hermetic line endings. Without this the repo inherits the *global*
        // `core.autocrlf`, which Git for Windows sets to `true` by default —
        // checkout then rewrites LF to CRLF and every test that compares file
        // contents against a "…\n" literal fails on a stock Windows dev box.
        config.set_bool("core.autocrlf", false).unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        (dir, path)
    }

    fn write_file(repo_path: &str, name: &str, content: &str) {
        fs::write(Path::new(repo_path).join(name), content).unwrap();
    }

    #[test]
    fn commit_stats_counts_lines() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "one\ntwo\nthree\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let first = commit(&path, "first").unwrap();
        write_file(&path, "a.txt", "one\nTWO\nthree\nfour\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let second = commit(&path, "second").unwrap();

        let stats = commit_stats(&path, &first).unwrap();
        assert_eq!(stats.files_changed, 1);
        assert_eq!(stats.insertions, 3);
        assert_eq!(stats.deletions, 0);

        let stats = commit_stats(&path, &second).unwrap();
        assert_eq!(stats.insertions, 2);
        assert_eq!(stats.deletions, 1);

        let files = commit_files(&path, &second).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].insertions, 2);
        assert_eq!(files[0].deletions, 1);
    }

    #[test]
    fn status_stage_commit_flow() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "hello\n");

        let st = status(&path).unwrap();
        assert_eq!(st.entries.len(), 1);
        assert_eq!(st.entries[0].unstaged, Some(FileState::Untracked));

        stage(&path, &["a.txt".into()]).unwrap();
        let st = status(&path).unwrap();
        assert_eq!(st.entries[0].staged, Some(FileState::New));

        let oid = commit(&path, "initial commit").unwrap();
        assert_eq!(oid.len(), 40);
        assert!(status(&path).unwrap().entries.is_empty());

        let commits = log(&path, 10, None).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].summary, "initial commit");
        assert!(commits[0].parents.is_empty());
    }

    #[test]
    fn unstage_and_discard() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "v1\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c1").unwrap();

        write_file(&path, "a.txt", "v2\n");
        stage(&path, &["a.txt".into()]).unwrap();
        assert_eq!(
            status(&path).unwrap().entries[0].staged,
            Some(FileState::Modified)
        );

        unstage(&path, &["a.txt".into()]).unwrap();
        let st = status(&path).unwrap();
        assert!(st.entries[0].staged.is_none());
        assert_eq!(st.entries[0].unstaged, Some(FileState::Modified));

        discard(&path, &["a.txt".into()]).unwrap();
        assert!(status(&path).unwrap().entries.is_empty());
        let content = fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(content, "v1\n");
    }

    #[test]
    fn empty_commit_message_rejected() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "x");
        stage(&path, &[]).unwrap();
        assert_eq!(commit(&path, "  ").unwrap_err().kind(), "invalid_input");
    }

    #[test]
    fn amend_replaces_head_commit() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "one");
        stage(&path, &["a.txt".into()]).unwrap();
        let first = commit(&path, "first").unwrap();
        write_file(&path, "b.txt", "two");
        stage(&path, &["b.txt".into()]).unwrap();
        let amended = commit_amend(&path, "first (amended)").unwrap();
        assert_ne!(first, amended);
        let commits = log(&path, 10, None).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].summary, "first (amended)");
        assert_eq!(
            last_commit_message(&path).unwrap().unwrap().trim(),
            "first (amended)"
        );
    }

    #[test]
    fn amend_on_empty_repo_is_invalid_input() {
        let (_dir, path) = temp_repo();
        assert_eq!(
            commit_amend(&path, "msg").unwrap_err().kind(),
            "invalid_input"
        );
        assert!(last_commit_message(&path).unwrap().is_none());
    }

    #[test]
    fn file_diff_worktree_and_commit() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "line1\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c1").unwrap();

        write_file(&path, "a.txt", "line1\nline2\n");
        let diff = file_diff(&path, "a.txt", DiffTarget::Worktree, None).unwrap();
        assert_eq!(diff.old_content, "line1\n");
        assert_eq!(diff.new_content, "line1\nline2\n");
        assert!(!diff.binary);

        stage(&path, &[]).unwrap();
        let staged = file_diff(&path, "a.txt", DiffTarget::Index, None).unwrap();
        assert_eq!(staged.old_content, "line1\n");
        assert_eq!(staged.new_content, "line1\nline2\n");

        let oid = commit(&path, "c2").unwrap();
        let cdiff = file_diff(&path, "a.txt", DiffTarget::Commit, Some(&oid)).unwrap();
        assert_eq!(cdiff.old_content, "line1\n");
        assert_eq!(cdiff.new_content, "line1\nline2\n");
    }

    #[test]
    fn branches_create_checkout_delete() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "x\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c1").unwrap();

        create_branch(&path, "feature/test", true).unwrap();
        let st = status(&path).unwrap();
        assert_eq!(st.branch.as_deref(), Some("feature/test"));

        let all = branches(&path).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|b| b.name == "feature/test" && b.is_head));

        // Cannot delete the checked-out branch.
        assert_eq!(
            delete_branch(&path, "feature/test").unwrap_err().kind(),
            "invalid_input"
        );

        let default_branch = all.iter().find(|b| !b.is_head).unwrap().name.clone();
        checkout_branch(&path, &default_branch).unwrap();
        delete_branch(&path, "feature/test").unwrap();
        assert_eq!(branches(&path).unwrap().len(), 1);
    }

    #[test]
    fn file_history_tracks_changes() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "1\n");
        write_file(&path, "b.txt", "1\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c1: a+b").unwrap();

        write_file(&path, "a.txt", "2\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c2: a only").unwrap();

        write_file(&path, "b.txt", "2\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c3: b only").unwrap();

        let hist_a = file_history(&path, "a.txt", 10).unwrap();
        let summaries: Vec<&str> = hist_a.iter().map(|c| c.summary.as_str()).collect();
        assert_eq!(summaries, vec!["c2: a only", "c1: a+b"]);
    }

    #[test]
    fn stash_save_list_apply_pop_drop() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "v1\n");
        stage(&path, &[]).unwrap();
        commit(&path, "c1").unwrap();

        write_file(&path, "a.txt", "dirty\n");
        stash_save(&path, Some("wip")).unwrap();
        assert!(status(&path).unwrap().entries.is_empty());

        let stashes = stash_list(&path).unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("wip"));

        stash_apply(&path, 0).unwrap();
        let content = fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(content, "dirty\n");
        assert_eq!(stash_list(&path).unwrap().len(), 1);

        write_file(&path, "a.txt", "v1\n");
        stash_pop(&path, 0).unwrap();
        let content = fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
        assert_eq!(content, "dirty\n");
        assert!(stash_list(&path).unwrap().is_empty());

        write_file(&path, "a.txt", "drop-me\n");
        stash_save(&path, Some("drop me")).unwrap();
        assert_eq!(stash_list(&path).unwrap().len(), 1);
        stash_drop(&path, 0).unwrap();
        assert!(stash_list(&path).unwrap().is_empty());
    }

    #[test]
    fn commit_files_lists_changes() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "1\n");
        stage(&path, &[]).unwrap();
        let oid = commit(&path, "c1").unwrap();
        let files = commit_files(&path, &oid).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].state, FileState::New);
    }

    #[test]
    fn log_on_empty_repo_is_empty() {
        let (_dir, path) = temp_repo();
        assert!(log(&path, 10, None).unwrap().is_empty());
        assert!(file_history(&path, "a.txt", 10).unwrap().is_empty());
    }

    #[test]
    fn parse_host_handles_common_forms() {
        assert_eq!(
            parse_host("https://github.com/u/r.git"),
            Some("github.com".into())
        );
        assert_eq!(
            parse_host("ssh://git@gitlab.com:2222/u/r.git"),
            Some("gitlab.com".into())
        );
        assert_eq!(
            parse_host("git@github.com:u/r.git"),
            Some("github.com".into())
        );
        assert_eq!(parse_host("not-a-url"), None);
    }

    #[test]
    fn discard_requires_paths() {
        let (_dir, path) = temp_repo();
        assert_eq!(discard(&path, &[]).unwrap_err().kind(), "invalid_input");
    }

    #[test]
    fn blame_attributes_lines_to_their_commits() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "one\ntwo\nthree\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let first = commit(&path, "first").unwrap();
        write_file(&path, "a.txt", "one\nTWO!\nthree\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let second = commit(&path, "second").unwrap();

        let blame = blame_file(&path, "a.txt").unwrap();
        assert_eq!(blame.lines, vec!["one", "TWO!", "three"]);
        assert!(!blame.truncated);

        // Every line is covered exactly once, in order.
        let covered: u32 = blame.hunks.iter().map(|h| h.lines).sum();
        assert_eq!(covered, 3);
        assert_eq!(blame.hunks.first().unwrap().start_line, 1);

        let hunk_for = |line: u32| {
            blame
                .hunks
                .iter()
                .find(|h| h.start_line <= line && line < h.start_line + h.lines)
                .unwrap()
        };
        assert_eq!(hunk_for(1).commit_id, first);
        assert_eq!(hunk_for(2).commit_id, second);
        assert_eq!(hunk_for(2).summary, "second");
        assert_eq!(hunk_for(2).author, "Test User");
        assert_eq!(hunk_for(3).commit_id, first);
        assert_eq!(hunk_for(2).short_id.len(), 7);
    }

    #[test]
    fn blame_rejects_untracked_and_empty_repos() {
        let (_dir, path) = temp_repo();
        assert_eq!(
            blame_file(&path, "a.txt").unwrap_err().kind(),
            "invalid_input"
        );
        write_file(&path, "a.txt", "one\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "first").unwrap();
        assert_eq!(
            blame_file(&path, "missing.txt").unwrap_err().kind(),
            "not_found"
        );
    }
    #[test]
    fn tags_create_list_delete() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "one\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let first = commit(&path, "first").unwrap();

        tag_create(&path, "v1.0.0", Some("release one"), None).unwrap();
        tag_create(&path, "light", None, Some(&first)).unwrap();
        let list = tags(&path).unwrap();
        assert_eq!(list.len(), 2);
        let v1 = list.iter().find(|t| t.name == "v1.0.0").unwrap();
        assert!(v1.annotated);
        assert_eq!(v1.message.as_deref(), Some("release one"));
        assert_eq!(v1.target_id, first);
        let light = list.iter().find(|t| t.name == "light").unwrap();
        assert!(!light.annotated);
        assert_eq!(light.short_target.len(), 7);

        tag_delete(&path, "light").unwrap();
        assert_eq!(tags(&path).unwrap().len(), 1);
    }

    #[test]
    fn reflog_records_commits() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "one\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "first").unwrap();
        write_file(&path, "a.txt", "two\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "second").unwrap();

        let entries = reflog(&path, 10).unwrap();
        assert!(entries.len() >= 2);
        assert!(entries[0].message.contains("second"));
        assert_eq!(entries[0].short_id.len(), 7);
    }

    #[test]
    fn cherry_pick_applies_commit() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "base\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "base").unwrap();

        create_branch(&path, "feature", true).unwrap();
        write_file(&path, "b.txt", "feature work\n");
        stage(&path, &["b.txt".into()]).unwrap();
        let feat = commit(&path, "feature: add b").unwrap();

        checkout_branch(&path, "master").unwrap();
        let new_id = cherry_pick(&path, &feat).unwrap();
        assert_ne!(new_id, feat);
        let log = log(&path, 10, None).unwrap();
        assert!(log[0].message.contains("cherry picked from"));
        assert!(Path::new(&path).join("b.txt").exists());
    }

    #[test]
    fn conflict_sides_and_resolve() {
        let (_dir, path) = temp_repo();
        write_file(&path, "a.txt", "base\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "base").unwrap();

        create_branch(&path, "feature", true).unwrap();
        write_file(&path, "a.txt", "theirs\n");
        stage(&path, &["a.txt".into()]).unwrap();
        let feat = commit(&path, "theirs change").unwrap();

        checkout_branch(&path, "master").unwrap();
        write_file(&path, "a.txt", "ours\n");
        stage(&path, &["a.txt".into()]).unwrap();
        commit(&path, "ours change").unwrap();

        // Cherry-pick the conflicting commit -> conflict expected.
        let err = cherry_pick(&path, &feat).unwrap_err();
        assert!(err.to_string().contains("a.txt"));

        let paths = conflict_paths(&path).unwrap();
        assert_eq!(paths, vec!["a.txt".to_string()]);
        let sides = conflict_sides(&path, "a.txt").unwrap();
        assert_eq!(sides.base, "base\n");
        assert_eq!(sides.ours, "ours\n");
        assert_eq!(sides.theirs, "theirs\n");
        assert!(sides.current.contains("<<<<<<<"));

        conflict_resolve(&path, "a.txt", "merged\n").unwrap();
        assert!(conflict_paths(&path).unwrap().is_empty());
        let st = status(&path).unwrap();
        assert!(st
            .entries
            .iter()
            .any(|e| e.path == "a.txt" && e.staged.is_some()));
    }

    #[test]
    fn submodules_empty_for_plain_repo() {
        let (_dir, path) = temp_repo();
        assert!(submodules(&path).unwrap().is_empty());
    }

    // --- commit_graph (pure lane layout) -------------------------------------

    fn ci(id: &str, parents: &[&str]) -> CommitInfo {
        CommitInfo {
            id: id.into(),
            short_id: id.into(),
            parents: parents.iter().map(|p| (*p).to_string()).collect(),
            author: "a".into(),
            email: "a@e".into(),
            time: 0,
            summary: id.into(),
            message: id.into(),
        }
    }

    #[test]
    fn graph_empty_is_empty() {
        assert!(commit_graph(&[]).is_empty());
    }

    #[test]
    fn graph_linear_history_stays_in_one_lane() {
        // C <- B <- A  (newest first: A, B, C)
        let commits = vec![ci("A", &["B"]), ci("B", &["C"]), ci("C", &[])];
        let rows = commit_graph(&commits);
        assert_eq!(rows.len(), 3);
        for r in &rows {
            assert_eq!(r.column, 0, "{} should be in lane 0", r.id);
            assert_eq!(r.width, 1, "linear history is one lane wide");
        }
        assert_eq!(rows[0].parent_columns, vec![0]); // A -> B in lane 0
        assert_eq!(rows[1].parent_columns, vec![0]); // B -> C in lane 0
        assert!(rows[2].parent_columns.is_empty()); // C is a root
    }

    #[test]
    fn graph_branch_and_merge_uses_two_lanes() {
        //   M        merge of A and B
        //  / \
        // A   B
        //  \ /
        //   C        common ancestor (root here)
        // Newest first: M, A, B, C
        let commits = vec![
            ci("M", &["A", "B"]),
            ci("A", &["C"]),
            ci("B", &["C"]),
            ci("C", &[]),
        ];
        let rows = commit_graph(&commits);
        assert_eq!(rows.len(), 4);

        // Merge sits in lane 0 and forks into two parent lanes.
        assert_eq!(rows[0].id, "M");
        assert_eq!(rows[0].column, 0);
        assert_eq!(rows[0].parent_columns.len(), 2);
        assert_eq!(rows[0].parent_columns[0], 0);
        let b_lane = rows[0].parent_columns[1];
        assert_ne!(b_lane, 0, "second parent gets its own lane");
        assert_eq!(rows[0].width, 2);

        // A continues lane 0, B continues its own lane.
        assert_eq!(rows[1].id, "A");
        assert_eq!(rows[1].column, 0);
        assert_eq!(rows[2].id, "B");
        assert_eq!(rows[2].column, b_lane);

        // C is the root where both lanes converge; lane ends, no parents.
        assert_eq!(rows[3].id, "C");
        assert!(rows[3].parent_columns.is_empty());
    }
}
