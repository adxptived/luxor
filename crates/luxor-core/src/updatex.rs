//! Update checks against GitHub Releases: compare the running version with
//! the latest published release of a configured `owner/repo` and surface the
//! release notes + download links. Installation stays a user action (open the
//! release page / download the asset); no silent binary swaps.

use crate::error::{Error, Result};
use serde::Serialize;
use std::cmp::Ordering;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    pub name: String,
    pub notes: String,
    pub published_at: String,
    pub html_url: String,
    /// (file name, browser download URL) of release assets.
    pub assets: Vec<(String, String)>,
}

/// Compare dotted versions numerically (`1.10.0` > `1.9.9`). Non-numeric
/// segments compare as 0; missing segments are 0; a leading `v` is ignored.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |v: &str| -> Vec<u64> {
        v.trim()
            .trim_start_matches(['v', 'V'])
            .split(['.', '-', '+'])
            .take(3)
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (
            pa.get(i).copied().unwrap_or(0),
            pb.get(i).copied().unwrap_or(0),
        );
        match x.cmp(&y) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

/// Verify the SHA-256 of downloaded bytes against an `expected` hex digest.
///
/// Accepts an optional `sha256:` prefix and is case-insensitive. Returns false
/// for a malformed expected digest. Update installation should refuse to
/// proceed unless this returns true — protecting against a tampered or
/// truncated download.
pub fn verify_sha256(bytes: &[u8], expected: &str) -> bool {
    use sha2::{Digest, Sha256};
    let want = expected
        .trim()
        .trim_start_matches("sha256:")
        .trim_start_matches("SHA256:")
        .trim()
        .to_ascii_lowercase();
    if want.len() != 64 || !want.bytes().all(|b| b.is_ascii_hexdigit()) {
        return false;
    }
    let digest = Sha256::digest(bytes);
    let got: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    got == want
}

/// Parse a GitHub `releases/latest` response into an [`UpdateInfo`].
pub fn parse_release(json: &str, current: &str) -> Result<UpdateInfo> {
    let v: serde_json::Value = serde_json::from_str(json)?;
    let s = |key: &str| {
        v.get(key)
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let latest = s("tag_name");
    if latest.is_empty() {
        return Err(Error::InvalidInput("no releases found".into()));
    }
    let assets = v
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    let name = x.get("name")?.as_str()?.to_string();
                    let url = x.get("browser_download_url")?.as_str()?.to_string();
                    Some((name, url))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(UpdateInfo {
        current: current.to_string(),
        update_available: compare_versions(&latest, current) == Ordering::Greater,
        latest,
        name: s("name"),
        notes: s("body").chars().take(20_000).collect(),
        published_at: s("published_at"),
        html_url: s("html_url"),
        assets,
    })
}

fn is_safe_repo_component(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

fn validate_slug(repo_slug: &str) -> Result<String> {
    let mut parts = repo_slug.trim().trim_matches('/').split('/');
    let owner = parts.next().unwrap_or_default();
    let repo = parts.next().unwrap_or_default();
    if parts.next().is_some() || !is_safe_repo_component(owner) || !is_safe_repo_component(repo) {
        return Err(Error::InvalidInput(
            "set an update repo first (owner/repo)".into(),
        ));
    }
    Ok(format!("{owner}/{repo}"))
}

/// Fetch the latest release of `owner/repo` and compare with `current`.
pub async fn check(repo_slug: &str, current: &str) -> Result<UpdateInfo> {
    let slug = validate_slug(repo_slug)?;
    let url = format!("https://api.github.com/repos/{slug}/releases/latest");
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("luxor/", env!("CARGO_PKG_VERSION")))
        .build()?
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if status.as_u16() == 404 {
        return Err(Error::InvalidInput(format!("no releases found for {slug}")));
    }
    if !status.is_success() {
        return Err(Error::InvalidInput(format!("GitHub API {status}")));
    }
    parse_release(&body, current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comparison() {
        assert_eq!(compare_versions("0.6.0", "0.5.0"), Ordering::Greater);
        assert_eq!(compare_versions("v0.6.0", "0.6.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.10.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("0.6", "0.6.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.6.0-beta", "0.6.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.5.9", "0.6.0"), Ordering::Less);
    }

    #[test]
    fn parses_release_json() {
        let json = r##"{
            "tag_name": "v0.7.0", "name": "Luxor 0.7.0",
            "body": "Notes: stuff", "published_at": "2026-07-01T00:00:00Z",
            "html_url": "https://github.com/foo/bar/releases/tag/v0.7.0",
            "assets": [
                {"name": "luxor_0.7.0_amd64.AppImage",
                 "browser_download_url": "https://github.com/foo/bar/releases/download/v0.7.0/luxor.AppImage"}
            ]
        }"##;
        let info = parse_release(json, "0.6.0").unwrap();
        assert!(info.update_available);
        assert_eq!(info.latest, "v0.7.0");
        assert_eq!(info.assets.len(), 1);
        let same = parse_release(json, "0.7.0").unwrap();
        assert!(!same.update_available);
    }

    #[test]
    fn rejects_bad_slug_shapes() {
        let e = parse_release("{}", "0.6.0");
        assert!(e.is_err());
    }

    #[test]
    fn sha256_verification() {
        // Known vector: sha256("abc").
        let want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(verify_sha256(b"abc", want));
        assert!(verify_sha256(b"abc", &format!("sha256:{want}")));
        assert!(verify_sha256(b"abc", &want.to_uppercase()));
        // Wrong content fails.
        assert!(!verify_sha256(b"abcd", want));
        // Malformed expected digests fail closed.
        assert!(!verify_sha256(b"abc", "deadbeef"));
        assert!(!verify_sha256(
            b"abc",
            "not-a-hex-digest-of-the-right-length-xxxxxxxxxxxxxxxxxxxxxxxxxxx"
        ));
    }
}
