//! GitHub integration: Issues, Pull Requests and Actions (CI) over the REST
//! API. Read paths work without a token on public repos (60 req/h); a stored
//! git token for `github.com` raises limits and unlocks private repos and
//! writes (comments, new issues).

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const API: &str = "https://api.github.com";
const UA: &str = concat!("luxor/", env!("CARGO_PKG_VERSION"));

// ---------------------------------------------------------------------------
// Repo discovery
// ---------------------------------------------------------------------------

/// `owner/repo` parsed from a git remote URL.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
}

impl RepoRef {
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
}

/// Parse `owner/repo` out of a GitHub remote URL. Supports
/// `https://github.com/o/r(.git)`, `git@github.com:o/r.git` and
/// `ssh://git@github.com/o/r`. Returns `None` for non-GitHub remotes.
pub fn parse_remote_url(url: &str) -> Option<RepoRef> {
    let rest = if let Some(r) = url.strip_prefix("git@github.com:") {
        r
    } else if let Some(i) = url.find("github.com/") {
        &url[i + "github.com/".len()..]
    } else {
        return None;
    };
    let mut parts = rest.trim_end_matches('/').splitn(3, '/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim().trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(RepoRef {
        owner: owner.into(),
        repo: repo.into(),
    })
}

/// Read the `origin` remote of a local repo and parse it as a GitHub repo.
pub fn repo_from_path(repo_path: &str) -> Result<Option<RepoRef>> {
    let repo = git2::Repository::open(repo_path)?;
    let Ok(remote) = repo.find_remote("origin") else {
        return Ok(None);
    };
    Ok(remote.url().and_then(parse_remote_url))
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub user: String,
    pub labels: Vec<String>,
    pub comments: u64,
    pub created_at: String,
    pub updated_at: String,
    pub body: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhComment {
    pub user: String,
    pub created_at: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhPull {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub user: String,
    pub draft: bool,
    pub head: String,
    pub base: String,
    pub created_at: String,
    pub updated_at: String,
    pub body: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: String,
    pub branch: String,
    pub event: String,
    pub run_number: u64,
    pub created_at: String,
    pub html_url: String,
}

// ---------------------------------------------------------------------------
// JSON parsing (testable without network)
// ---------------------------------------------------------------------------

fn s(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string()
}
fn n(v: &serde_json::Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0)
}
fn user_login(v: &serde_json::Value) -> String {
    v.get("user")
        .and_then(|u| u.get("login"))
        .and_then(|x| x.as_str())
        .unwrap_or("?")
        .to_string()
}

pub fn parse_issues(json: &str) -> Result<Vec<GhIssue>> {
    let items: Vec<serde_json::Value> = serde_json::from_str(json)?;
    Ok(items
        .iter()
        // The issues endpoint also returns PRs; those carry a `pull_request` key.
        .filter(|v| v.get("pull_request").is_none())
        .map(|v| GhIssue {
            number: n(v, "number"),
            title: s(v, "title"),
            state: s(v, "state"),
            user: user_login(v),
            labels: v
                .get("labels")
                .and_then(|l| l.as_array())
                .map(|a| {
                    a.iter()
                        .map(|l| s(l, "name"))
                        .filter(|x| !x.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            comments: n(v, "comments"),
            created_at: s(v, "created_at"),
            updated_at: s(v, "updated_at"),
            body: s(v, "body"),
            html_url: s(v, "html_url"),
        })
        .collect())
}

pub fn parse_comments(json: &str) -> Result<Vec<GhComment>> {
    let items: Vec<serde_json::Value> = serde_json::from_str(json)?;
    Ok(items
        .iter()
        .map(|v| GhComment {
            user: user_login(v),
            created_at: s(v, "created_at"),
            body: s(v, "body"),
        })
        .collect())
}

pub fn parse_pulls(json: &str) -> Result<Vec<GhPull>> {
    let items: Vec<serde_json::Value> = serde_json::from_str(json)?;
    Ok(items
        .iter()
        .map(|v| GhPull {
            number: n(v, "number"),
            title: s(v, "title"),
            state: s(v, "state"),
            user: user_login(v),
            draft: v.get("draft").and_then(|x| x.as_bool()).unwrap_or(false),
            head: v.get("head").map(|h| s(h, "ref")).unwrap_or_default(),
            base: v.get("base").map(|b| s(b, "ref")).unwrap_or_default(),
            created_at: s(v, "created_at"),
            updated_at: s(v, "updated_at"),
            body: s(v, "body"),
            html_url: s(v, "html_url"),
        })
        .collect())
}

pub fn parse_runs(json: &str) -> Result<Vec<GhRun>> {
    let root: serde_json::Value = serde_json::from_str(json)?;
    let items = root
        .get("workflow_runs")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(items
        .iter()
        .map(|v| GhRun {
            id: n(v, "id"),
            name: s(v, "name"),
            status: s(v, "status"),
            conclusion: s(v, "conclusion"),
            branch: s(v, "head_branch"),
            event: s(v, "event"),
            run_number: n(v, "run_number"),
            created_at: s(v, "created_at"),
            html_url: s(v, "html_url"),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(UA)
        .build()
        .map_err(Error::from)
}

async fn get(url: &str, token: Option<&str>) -> Result<String> {
    let mut req = client()?
        .get(url)
        .header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::InvalidInput(format!(
            "GitHub API {status}: {}",
            api_message(&body)
        )));
    }
    Ok(body)
}

async fn post(url: &str, token: Option<&str>, payload: serde_json::Value) -> Result<String> {
    let Some(t) = token else {
        return Err(Error::InvalidInput(
            "a GitHub token is required for this action".into(),
        ));
    };
    let resp = client()?
        .post(url)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(t)
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::InvalidInput(format!(
            "GitHub API {status}: {}",
            api_message(&body)
        )));
    }
    Ok(body)
}

fn is_safe_repo_component(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

fn validate_slug(slug: &str) -> Result<String> {
    let mut parts = slug.trim().trim_matches('/').split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    if parts.next().is_some() || !is_safe_repo_component(owner) || !is_safe_repo_component(repo) {
        return Err(Error::InvalidInput("GitHub repo must be owner/repo".into()));
    }
    Ok(format!("{owner}/{repo}"))
}

fn validate_state(state: &str) -> Result<&str> {
    match state {
        "open" | "closed" | "all" => Ok(state),
        _ => Err(Error::InvalidInput("state must be open, closed, or all".into())),
    }
}

fn api_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(200).collect())
}

/// `state`: `open` | `closed` | `all`.
pub async fn issues(slug: &str, state: &str, token: Option<&str>) -> Result<Vec<GhIssue>> {
    let slug = validate_slug(slug)?;
    let state = validate_state(state)?;
    let body = get(
        &format!("{API}/repos/{slug}/issues?state={state}&per_page=50"),
        token,
    )
    .await?;
    parse_issues(&body)
}

pub async fn issue_comments(
    slug: &str,
    number: u64,
    token: Option<&str>,
) -> Result<Vec<GhComment>> {
    let slug = validate_slug(slug)?;
    let body = get(
        &format!("{API}/repos/{slug}/issues/{number}/comments?per_page=50"),
        token,
    )
    .await?;
    parse_comments(&body)
}

pub async fn issue_create(
    slug: &str,
    title: &str,
    body_text: &str,
    token: Option<&str>,
) -> Result<GhIssue> {
    let slug = validate_slug(slug)?;
    let body = post(
        &format!("{API}/repos/{slug}/issues"),
        token,
        serde_json::json!({ "title": title, "body": body_text }),
    )
    .await?;
    let one: serde_json::Value = serde_json::from_str(&body)?;
    parse_issues(&format!("[{one}]"))?
        .pop()
        .ok_or_else(|| Error::InvalidInput("empty response".into()))
}

pub async fn issue_comment_add(
    slug: &str,
    number: u64,
    text: &str,
    token: Option<&str>,
) -> Result<()> {
    let slug = validate_slug(slug)?;
    post(
        &format!("{API}/repos/{slug}/issues/{number}/comments"),
        token,
        serde_json::json!({ "body": text }),
    )
    .await
    .map(|_| ())
}

/// Create a pull request `head` -> `base`. Requires a token (like all writes).
pub async fn pull_create(
    slug: &str,
    title: &str,
    body_text: &str,
    head: &str,
    base: &str,
    draft: bool,
    token: Option<&str>,
) -> Result<GhPull> {
    let slug = validate_slug(slug)?;
    let body = post(
        &format!("{API}/repos/{slug}/pulls"),
        token,
        serde_json::json!({
            "title": title,
            "body": body_text,
            "head": head,
            "base": base,
            "draft": draft,
        }),
    )
    .await?;
    let one: serde_json::Value = serde_json::from_str(&body)?;
    parse_pulls(&format!("[{one}]"))?
        .pop()
        .ok_or_else(|| Error::InvalidInput("empty response".into()))
}

pub async fn pulls(slug: &str, state: &str, token: Option<&str>) -> Result<Vec<GhPull>> {
    let slug = validate_slug(slug)?;
    let state = validate_state(state)?;
    let body = get(
        &format!("{API}/repos/{slug}/pulls?state={state}&per_page=50"),
        token,
    )
    .await?;
    parse_pulls(&body)
}

pub async fn runs(slug: &str, token: Option<&str>) -> Result<Vec<GhRun>> {
    let slug = validate_slug(slug)?;
    let body = get(
        &format!("{API}/repos/{slug}/actions/runs?per_page=50"),
        token,
    )
    .await?;
    parse_runs(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_urls() {
        for url in [
            "https://github.com/foo/bar.git",
            "https://github.com/foo/bar",
            "https://github.com/foo/bar/",
            "git@github.com:foo/bar.git",
            "ssh://git@github.com/foo/bar.git",
        ] {
            let r = parse_remote_url(url).unwrap_or_else(|| panic!("failed: {url}"));
            assert_eq!(r.slug(), "foo/bar", "{url}");
        }
        assert!(parse_remote_url("https://gitlab.com/foo/bar.git").is_none());
        assert!(parse_remote_url("git@github.com:onlyowner").is_none());
    }

    #[test]
    fn parses_issues_and_skips_prs() {
        let json = r#"[
            {"number": 7, "title": "Bug", "state": "open",
             "user": {"login": "alice"}, "labels": [{"name": "bug"}, {"name": "p1"}],
             "comments": 3, "created_at": "2026-01-01T00:00:00Z",
             "updated_at": "2026-01-02T00:00:00Z", "body": "It crashes",
             "html_url": "https://github.com/foo/bar/issues/7"},
            {"number": 8, "title": "A PR", "state": "open", "user": {"login": "bob"},
             "pull_request": {"url": "x"}, "comments": 0,
             "created_at": "", "updated_at": "", "body": null, "html_url": ""}
        ]"#;
        let issues = parse_issues(json).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].number, 7);
        assert_eq!(issues[0].labels, vec!["bug", "p1"]);
        assert_eq!(issues[0].user, "alice");
    }

    #[test]
    fn parses_pulls() {
        let json = r#"[
            {"number": 12, "title": "Add thing", "state": "open", "draft": true,
             "user": {"login": "carol"},
             "head": {"ref": "feature/x"}, "base": {"ref": "main"},
             "created_at": "2026-02-01T00:00:00Z", "updated_at": "2026-02-02T00:00:00Z",
             "body": "...", "html_url": "https://github.com/foo/bar/pull/12"}
        ]"#;
        let pulls = parse_pulls(json).unwrap();
        assert_eq!(pulls.len(), 1);
        assert!(pulls[0].draft);
        assert_eq!(pulls[0].head, "feature/x");
        assert_eq!(pulls[0].base, "main");
    }

    #[test]
    fn parses_runs() {
        let json = r#"{"total_count": 1, "workflow_runs": [
            {"id": 99, "name": "CI", "status": "completed", "conclusion": "success",
             "head_branch": "main", "event": "push", "run_number": 41,
             "created_at": "2026-03-01T00:00:00Z",
             "html_url": "https://github.com/foo/bar/actions/runs/99"}
        ]}"#;
        let runs = parse_runs(json).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].conclusion, "success");
        assert_eq!(runs[0].run_number, 41);
    }

    #[test]
    fn parses_comments_and_api_errors() {
        let json =
            r#"[{"user": {"login": "dave"}, "created_at": "2026-01-05T00:00:00Z", "body": "+1"}]"#;
        let c = parse_comments(json).unwrap();
        assert_eq!(c[0].user, "dave");
        assert_eq!(api_message(r#"{"message": "Not Found"}"#), "Not Found");
        assert_eq!(api_message("plain"), "plain");
    }
}
