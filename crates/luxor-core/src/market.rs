//! Skills market — browse the skills.sh catalog and import skills.
//!
//! skills.sh has no public JSON API; the catalog is embedded in the
//! Next.js flight payload of the homepage as escaped JSON objects:
//! `{\"source\":\"owner/repo\",\"skillId\":\"...\",\"name\":\"...\",\"installs\":N,...}`.
//! We fetch the page, extract those objects, and resolve skill content from
//! the source GitHub repository (raw.githubusercontent.com). Everything is
//! best-effort: when offline the UI shows a friendly fallback with a link.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub const MARKET_URL: &str = "https://skills.sh/";

/// Full-text search endpoint. skills.sh exposes a JSON search API that covers
/// the *entire* catalog (the homepage flight payload only carries the top
/// featured skills), so live queries go through here instead of filtering the
/// cached homepage locally.
pub const SEARCH_URL: &str = "https://skills.sh/api/search";

/// Max results requested per search query.
pub const SEARCH_LIMIT: u32 = 60;

/// How long a cached catalog stays fresh before a background refetch.
pub const CATALOG_CACHE_TTL_SECS: u64 = 60 * 60; // 1 hour

/// One catalog entry on skills.sh.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketSkill {
    /// GitHub repo in `owner/repo` form.
    pub source: String,
    /// Skill folder id inside the repo.
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
    pub is_official: bool,
    /// Detail page on skills.sh.
    pub url: String,
}

#[derive(Deserialize)]
struct RawEntry {
    source: String,
    #[serde(rename = "skillId")]
    skill_id: String,
    name: String,
    #[serde(default)]
    installs: u64,
    #[serde(rename = "isOfficial", default)]
    is_official: bool,
}

/// Extract catalog entries from the skills.sh homepage HTML.
/// Tolerant by design: returns every parseable entry, deduped, sorted by
/// installs (descending).
pub fn parse_market_html(html: &str) -> Vec<MarketSkill> {
    // The flight payload escapes quotes (`\"`); normalize so the JSON
    // objects become directly parseable.
    let unescaped = html.replace("\\\"", "\"");
    let mut out: Vec<MarketSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (idx, _) in unescaped.match_indices(r#"{"source":""#) {
        let Some(rest) = unescaped.get(idx..) else {
            continue;
        };
        // Entries are flat objects — the first `}` closes them.
        let Some(end) = rest.find('}') else { continue };
        let Ok(raw) = serde_json::from_str::<RawEntry>(&rest[..=end]) else {
            continue;
        };
        if raw.source.is_empty() || raw.skill_id.is_empty() {
            continue;
        }
        if !seen.insert((raw.source.clone(), raw.skill_id.clone())) {
            continue;
        }
        out.push(MarketSkill {
            url: format!("https://skills.sh/{}/{}", raw.source, raw.skill_id),
            name: if raw.name.is_empty() {
                raw.skill_id.clone()
            } else {
                raw.name
            },
            source: raw.source,
            skill_id: raw.skill_id,
            installs: raw.installs,
            is_official: raw.is_official,
        });
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.installs));
    out
}

/// One entry from the `/api/search` JSON response.
#[derive(Deserialize)]
struct SearchEntry {
    source: String,
    #[serde(rename = "skillId")]
    skill_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    installs: u64,
    #[serde(rename = "isOfficial", default)]
    is_official: bool,
    /// Full `source/skillId` path id used to build the detail URL.
    #[serde(default)]
    id: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    skills: Vec<SearchEntry>,
}

/// Parse the `/api/search` JSON body into market entries, preserving the
/// server's relevance order and deduping by (source, skill_id).
pub fn parse_search_json(body: &str) -> Vec<MarketSkill> {
    let Ok(resp) = serde_json::from_str::<SearchResponse>(body) else {
        return Vec::new();
    };
    let mut out: Vec<MarketSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for e in resp.skills {
        if e.source.is_empty() || e.skill_id.is_empty() {
            continue;
        }
        if !seen.insert((e.source.clone(), e.skill_id.clone())) {
            continue;
        }
        let url = if e.id.is_empty() {
            format!("https://skills.sh/{}/{}", e.source, e.skill_id)
        } else {
            format!("https://skills.sh/{}", e.id)
        };
        out.push(MarketSkill {
            name: if e.name.is_empty() {
                e.skill_id.clone()
            } else {
                e.name
            },
            url,
            source: e.source,
            skill_id: e.skill_id,
            installs: e.installs,
            is_official: e.is_official,
        });
    }
    out
}

/// Live full-text search of the skills.sh catalog. An empty query returns an
/// empty result (the caller should fall back to the cached catalog).
pub async fn search_catalog(query: &str) -> Result<Vec<MarketSkill>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let body = http()?
        .get(SEARCH_URL)
        .query(&[("q", q), ("limit", &SEARCH_LIMIT.to_string())])
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_search_json(&body))
}

/// Case-insensitive local filter over an in-memory catalog. Every
/// whitespace-separated term must appear somewhere in the skill's name, id or
/// source. Results keep their incoming order (install-count, descending). This
/// is the offline fallback that lets search keep working against the locally
/// cached catalog when skills.sh is unreachable.
pub fn filter_catalog(skills: &[MarketSkill], query: &str) -> Vec<MarketSkill> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let terms: Vec<&str> = q.split_whitespace().collect();
    skills
        .iter()
        .filter(|s| {
            let hay = format!("{} {} {}", s.name, s.skill_id, s.source).to_lowercase();
            terms.iter().all(|term| hay.contains(term))
        })
        .cloned()
        .collect()
}

/// Combined live + local search.
///
/// Live `/api/search` results come first (they cover the *entire* catalog),
/// then any cached-catalog matches not already present are appended. When the
/// network is down we still return the local matches instead of failing, so
/// the Skills market keeps working offline. Only errors when the live request
/// fails *and* there are no local matches to fall back to.
pub async fn search_combined(cache_path: &Path, query: &str) -> Result<Vec<MarketSkill>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // Any-age cache: offline relevance beats a hard error.
    let cached = load_catalog_cache(cache_path, u64::MAX).unwrap_or_default();
    let local = filter_catalog(&cached, q);
    match search_catalog(q).await {
        Ok(mut live) => {
            let mut seen: std::collections::HashSet<(String, String)> = live
                .iter()
                .map(|s| (s.source.clone(), s.skill_id.clone()))
                .collect();
            for s in local {
                if seen.insert((s.source.clone(), s.skill_id.clone())) {
                    live.push(s);
                }
            }
            Ok(live)
        }
        Err(e) => {
            if local.is_empty() {
                Err(e)
            } else {
                Ok(local)
            }
        }
    }
}

/// Shared HTTP client, built once and reused.
///
/// Reusing one client keeps the connection pool warm across catalog / search /
/// SKILL.md fetches and avoids rebuilding TLS state on every call. The short
/// `connect_timeout` makes offline detection fast (a few seconds, not the full
/// 15s read budget) so the UI can fall back to local/cached results without a
/// long hang -- this is what fixes the "Couldn't reach skills.sh" stall.
fn http() -> Result<reqwest::Client> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .user_agent("luxor")
        .build()?;
    let _ = CLIENT.set(client.clone());
    Ok(client)
}

/// Fetch the skills.sh catalog. Errors are surfaced so the UI can show an
/// offline fallback.
pub async fn fetch_catalog() -> Result<Vec<MarketSkill>> {
    let html = http()?
        .get(MARKET_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let skills = parse_market_html(&html);
    if skills.is_empty() {
        return Err(Error::Ai(
            "could not parse the skills.sh catalog (site layout may have changed)".into(),
        ));
    }
    Ok(skills)
}

// ---------------------------------------------------------------------------
// Catalog disk cache
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct CatalogCache {
    /// Unix seconds of the fetch.
    fetched_at: u64,
    skills: Vec<MarketSkill>,
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Read a cached catalog from `path` if it is younger than `ttl_secs`.
pub fn load_catalog_cache(path: &Path, ttl_secs: u64) -> Option<Vec<MarketSkill>> {
    let raw = std::fs::read_to_string(path).ok()?;
    let cache: CatalogCache = serde_json::from_str(&raw).ok()?;
    if cache.skills.is_empty() || now_unix().saturating_sub(cache.fetched_at) > ttl_secs {
        return None;
    }
    Some(cache.skills)
}

/// Persist a fetched catalog to `path` (best effort, atomic rename).
pub fn store_catalog_cache(path: &Path, skills: &[MarketSkill]) {
    let cache = CatalogCache {
        fetched_at: now_unix(),
        skills: skills.to_vec(),
    };
    let Ok(raw) = serde_json::to_string(&cache) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, raw).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

/// Fetch the catalog through the disk cache: fresh cache hits answer
/// instantly, otherwise the network result replaces the cache. With `force`
/// the cache is bypassed (manual reload button). On network failure a stale
/// cache (any age) is still better than an error.
pub async fn fetch_catalog_cached(cache_path: &Path, force: bool) -> Result<Vec<MarketSkill>> {
    if !force {
        if let Some(skills) = load_catalog_cache(cache_path, CATALOG_CACHE_TTL_SECS) {
            return Ok(skills);
        }
    }
    match fetch_catalog().await {
        Ok(skills) => {
            store_catalog_cache(cache_path, &skills);
            Ok(skills)
        }
        // Offline fallback: serve a stale cache rather than failing outright.
        Err(e) => load_catalog_cache(cache_path, u64::MAX).ok_or(e),
    }
}

/// All raw.githubusercontent.com candidates for a skill's SKILL.md, in
/// priority order (most common layouts first).
pub fn skill_md_candidate_urls(source: &str, skill_id: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for branch in ["main", "master"] {
        for prefix in ["skills/", "", ".claude/skills/", ".agents/skills/"] {
            urls.push(format!(
                "https://raw.githubusercontent.com/{source}/{branch}/{prefix}{skill_id}/SKILL.md"
            ));
        }
    }
    urls
}

/// Fetch a skill's SKILL.md from its source GitHub repository.
///
/// All branch/layout candidates are requested concurrently and the first
/// (highest-priority) success wins — much faster than the old sequential
/// probing, which could take 8 round-trips for master-branch repos.
pub async fn fetch_skill_md(source: &str, skill_id: &str) -> Result<String> {
    if !source.contains('/') || source.contains("..") || skill_id.contains(['/', '\\']) {
        return Err(Error::InvalidInput(format!(
            "invalid skill source {source:?}/{skill_id:?}"
        )));
    }
    let client = http()?;
    let handles: Vec<_> = skill_md_candidate_urls(source, skill_id)
        .into_iter()
        .map(|url| {
            let client = client.clone();
            tokio::spawn(async move {
                let resp = client.get(&url).send().await.ok()?;
                if !resp.status().is_success() {
                    return None;
                }
                resp.text().await.ok()
            })
        })
        .collect();
    let mut result: Option<String> = None;
    for handle in handles {
        if result.is_some() {
            // A higher-priority candidate already succeeded.
            handle.abort();
            continue;
        }
        if let Ok(Some(text)) = handle.await {
            result = Some(text);
        }
    }
    result.ok_or_else(|| Error::NotFound(format!("SKILL.md for {source}/{skill_id}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real snippet shape from the skills.sh flight payload (escaped quotes).
    const FIXTURE: &str = r#"<script>self.__next_f.push([1,"a:[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":1967841,\"weeklyInstalls\":[115950],\"isOfficial\":true},{\"source\":\"anthropics/skills\",\"skillId\":\"frontend-design\",\"name\":\"frontend-design\",\"installs\":530372,\"weeklyInstalls\":[30494],\"isOfficial\":true},{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"dupe\",\"installs\":1,\"isOfficial\":false}]"])</script>"#;

    #[test]
    fn parses_and_dedupes_catalog_entries() {
        let skills = parse_market_html(FIXTURE);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].skill_id, "find-skills");
        assert_eq!(skills[0].installs, 1_967_841);
        assert!(skills[0].is_official);
        assert_eq!(
            skills[0].url,
            "https://skills.sh/vercel-labs/skills/find-skills"
        );
        assert_eq!(skills[1].source, "anthropics/skills");
    }

    #[test]
    fn empty_or_garbage_html_yields_no_entries() {
        assert!(parse_market_html("").is_empty());
        assert!(parse_market_html("<html>nothing here</html>").is_empty());
        assert!(parse_market_html(r#"{"source":"","skillId":"x"}"#).is_empty());
    }

    /// Real shape of the `/api/search` JSON response (unescaped, like the API
    /// returns it). `id` carries the full `source/skillId` path.
    const SEARCH_FIXTURE: &str = r#"{"query":"pdf","searchType":"fuzzy","skills":[
        {"id":"openai/skills/pdf","skillId":"pdf","name":"pdf","installs":7145,"source":"openai/skills","isOfficial":true},
        {"id":"vercel-labs/json-render/react-pdf","skillId":"react-pdf","name":"react-pdf","installs":1287,"source":"vercel-labs/json-render"},
        {"id":"smithery.ai/pdf","skillId":"pdf","name":"pdf","installs":1007,"source":"smithery.ai"},
        {"id":"openai/skills/pdf","skillId":"pdf","name":"dupe","installs":1,"source":"openai/skills"}
    ],"count":3,"duration_ms":12}"#;

    #[test]
    fn parses_search_results_preserving_order_and_dedupes() {
        let skills = parse_search_json(SEARCH_FIXTURE);
        assert_eq!(skills.len(), 3);
        // Server relevance order is preserved (NOT re-sorted by installs).
        assert_eq!(skills[0].skill_id, "pdf");
        assert_eq!(skills[0].source, "openai/skills");
        assert!(skills[0].is_official);
        assert_eq!(skills[0].url, "https://skills.sh/openai/skills/pdf");
        // Nested-path source resolves a correct detail URL from `id`.
        assert_eq!(
            skills[1].url,
            "https://skills.sh/vercel-labs/json-render/react-pdf"
        );
        // Non-GitHub registry source is still surfaced.
        assert_eq!(skills[2].source, "smithery.ai");
    }

    #[test]
    fn search_json_garbage_yields_no_entries() {
        assert!(parse_search_json("").is_empty());
        assert!(parse_search_json("not json").is_empty());
        assert!(parse_search_json(r#"{"skills":[]}"#).is_empty());
        assert!(
            parse_search_json(r#"{"skills":[{"source":"","skillId":"x","id":""}]}"#).is_empty()
        );
    }

    #[test]
    fn candidate_urls_cover_branches_and_layouts() {
        let urls = skill_md_candidate_urls("owner/repo", "my-skill");
        assert_eq!(urls.len(), 8);
        assert_eq!(
            urls[0],
            "https://raw.githubusercontent.com/owner/repo/main/skills/my-skill/SKILL.md"
        );
        assert!(urls.iter().any(|u| u.contains("/master/.claude/skills/")));
    }

    #[test]
    fn catalog_cache_roundtrip_and_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("market_cache.json");
        let skills = vec![MarketSkill {
            source: "a/b".into(),
            skill_id: "s".into(),
            name: "s".into(),
            installs: 5,
            is_official: false,
            url: "https://skills.sh/a/b/s".into(),
        }];
        // Nothing cached yet.
        assert!(load_catalog_cache(&path, 60).is_none());
        store_catalog_cache(&path, &skills);
        assert_eq!(load_catalog_cache(&path, 60).unwrap(), skills);
        // TTL 0 = always stale (just-written cache is ~0s old, so use a
        // doctored timestamp to make staleness deterministic).
        let stale = serde_json::json!({ "fetched_at": 1, "skills": skills });
        std::fs::write(&path, stale.to_string()).unwrap();
        assert!(load_catalog_cache(&path, 60).is_none());
        // u64::MAX TTL accepts any age (offline fallback).
        assert!(load_catalog_cache(&path, u64::MAX).is_some());
    }

    #[test]
    fn corrupt_or_empty_cache_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("market_cache.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_catalog_cache(&path, u64::MAX).is_none());
        std::fs::write(&path, r#"{"fetched_at": 99999999999, "skills": []}"#).unwrap();
        assert!(load_catalog_cache(&path, u64::MAX).is_none());
    }

    #[test]
    fn filter_catalog_matches_name_id_source_with_all_terms() {
        let skills = parse_search_json(SEARCH_FIXTURE);
        // Single term hits the skill id.
        assert_eq!(filter_catalog(&skills, "pdf").len(), 3);
        // Term that only appears in the source.
        let openai = filter_catalog(&skills, "openai");
        assert_eq!(openai.len(), 1);
        assert_eq!(openai[0].source, "openai/skills");
        // All terms must match (AND semantics).
        assert_eq!(filter_catalog(&skills, "react pdf").len(), 1);
        assert!(filter_catalog(&skills, "pdf nonexistent").is_empty());
        // Empty / whitespace query yields nothing.
        assert!(filter_catalog(&skills, "   ").is_empty());
    }

    #[test]
    fn search_combined_includes_cached_matches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("market_cache.json");
        let skills = parse_search_json(SEARCH_FIXTURE);
        store_catalog_cache(&path, &skills);
        // Deterministic regardless of network: cached matches are always merged
        // in, so the cached "react-pdf" appears whether the live call failed
        // (offline -> local only) or succeeded (live + local merge).
        let got = futures_block(search_combined(&path, "react")).unwrap();
        assert!(got.iter().any(|s| s.skill_id == "react-pdf"));
        // Empty query short-circuits to an empty list (browse mode), no network.
        assert!(futures_block(search_combined(&path, "  ")).unwrap().is_empty());
    }

    #[test]
    fn fetch_skill_md_rejects_bad_input() {
        let err = futures_block(fetch_skill_md("no-slash", "x")).unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
        let err = futures_block(fetch_skill_md("a/b", "../etc")).unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }

    fn futures_block<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(fut)
    }
}
