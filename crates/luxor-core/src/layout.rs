//! Savable layout presets.
//!
//! A preset stores the dockview layout JSON (opaque to the backend) plus
//! per-panel terminal metadata: working directory and autorun commands.
//! Presets live as individual JSON files in `{config_dir}/luxor/layouts/`.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Current preset file format version. Bump only with a migration path —
/// breaking preset compatibility is forbidden by project rules.
pub const PRESET_VERSION: u32 = 1;

/// Terminal metadata attached to a layout panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PanelTerminal {
    /// Panel id matching the dockview panel id.
    pub panel_id: String,
    /// Working directory to spawn the terminal in.
    pub cwd: Option<String>,
    /// Commands executed automatically after the shell starts.
    pub autorun: Vec<String>,
}

/// A named, savable layout preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayoutPreset {
    /// Format version for forwards-compatible migrations.
    pub version: u32,
    /// Unique id (uuid v4), doubles as the file name.
    pub id: String,
    pub name: String,
    /// Serialized dockview layout (opaque JSON produced by the frontend).
    pub dock_layout: serde_json::Value,
    /// Terminal metadata per panel.
    pub terminals: Vec<PanelTerminal>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl LayoutPreset {
    pub fn new(name: impl Into<String>, dock_layout: serde_json::Value) -> Self {
        let now = Utc::now();
        Self {
            version: PRESET_VERSION,
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            dock_layout,
            terminals: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

/// Directory where presets are stored.
pub fn presets_dir() -> Result<PathBuf> {
    Ok(crate::config::config_dir()?.join("layouts"))
}

fn preset_path(dir: &Path, id: &str) -> Result<PathBuf> {
    // Defense in depth: ids are uuids we generate, but never allow path traversal.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(Error::InvalidInput(format!("invalid preset id: {id:?}")));
    }
    Ok(dir.join(format!("{id}.json")))
}

/// List all presets in `dir`, sorted by name. Unreadable files are skipped.
pub fn list(dir: &Path) -> Result<Vec<LayoutPreset>> {
    let mut presets = Vec::new();
    if !dir.exists() {
        return Ok(presets);
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&path)
            .map_err(Error::from)
            .and_then(|raw| serde_json::from_str::<LayoutPreset>(&raw).map_err(Error::from))
        {
            Ok(preset) => presets.push(preset),
            Err(e) => tracing::warn!("skipping unreadable preset {}: {e}", path.display()),
        }
    }
    presets.sort_by_key(|p| p.name.to_lowercase());
    Ok(presets)
}

pub fn get(dir: &Path, id: &str) -> Result<LayoutPreset> {
    let path = preset_path(dir, id)?;
    if !path.exists() {
        return Err(Error::NotFound(format!("layout preset {id}")));
    }
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

/// Save (create or update) a preset. Bumps `updated_at`.
pub fn save(dir: &Path, preset: &mut LayoutPreset) -> Result<()> {
    if preset.name.trim().is_empty() {
        return Err(Error::InvalidInput("preset name cannot be empty".into()));
    }
    preset.updated_at = Utc::now();
    std::fs::create_dir_all(dir)?;
    let path = preset_path(dir, &preset.id)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(preset)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn delete(dir: &Path, id: &str) -> Result<()> {
    let path = preset_path(dir, id)?;
    if !path.exists() {
        return Err(Error::NotFound(format!("layout preset {id}")));
    }
    std::fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn save_list_get_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let mut preset = LayoutPreset::new("Dev 2x2", json!({"grid": {"root": {}}}));
        preset.terminals.push(PanelTerminal {
            panel_id: "term-1".into(),
            cwd: Some("C:/dev/luxor".into()),
            autorun: vec!["cargo watch -x check".into()],
        });
        save(dir.path(), &mut preset).unwrap();

        let all = list(dir.path()).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Dev 2x2");

        let got = get(dir.path(), &preset.id).unwrap();
        assert_eq!(got.terminals[0].autorun[0], "cargo watch -x check");

        delete(dir.path(), &preset.id).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn empty_name_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut preset = LayoutPreset::new("  ", json!({}));
        let err = save(dir.path(), &mut preset).unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }

    #[test]
    fn path_traversal_ids_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let err = get(dir.path(), "../../etc/passwd").unwrap_err();
        assert_eq!(err.kind(), "invalid_input");
    }

    #[test]
    fn listing_missing_dir_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(list(&missing).unwrap().is_empty());
    }

    #[test]
    fn corrupt_preset_files_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("bad.json"), "{not json").unwrap();
        let mut good = LayoutPreset::new("ok", json!({}));
        save(dir.path(), &mut good).unwrap();
        let all = list(dir.path()).unwrap();
        assert_eq!(all.len(), 1);
    }
}
