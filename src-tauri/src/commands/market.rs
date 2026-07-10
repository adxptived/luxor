//! Skills-market commands (skills.sh catalog + GitHub skill content).

use luxor_core::market::{self, MarketSkill};
use luxor_core::Error;

/// Fetch the skills.sh catalog through a 1-hour disk cache; `force` bypasses
/// the cache (manual reload). On network failure a stale cache still answers.
#[tauri::command]
pub async fn market_catalog(force: Option<bool>) -> Result<Vec<MarketSkill>, Error> {
    let cache_path = luxor_core::config::config_dir()?.join("market_cache.json");
    market::fetch_catalog_cached(&cache_path, force.unwrap_or(false)).await
}

/// Full-text search of the skills.sh catalog, combined with a local fallback.
///
/// Live `/api/search` covers the whole site; cached-catalog matches are merged
/// in (and serve as the answer when offline) so search keeps working without a
/// network connection. An empty query returns an empty list (browse mode).
#[tauri::command]
pub async fn market_search(query: String) -> Result<Vec<MarketSkill>, Error> {
    let cache_path = luxor_core::config::config_dir()?.join("market_cache.json");
    market::search_combined(&cache_path, &query).await
}

/// Fetch a market skill's SKILL.md content from its source repository.
#[tauri::command]
pub async fn market_skill_md(source: String, skill_id: String) -> Result<String, Error> {
    market::fetch_skill_md(&source, &skill_id).await
}
