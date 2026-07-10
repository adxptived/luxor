//! Agent-skill manager.
//!
//! Different AI coding agents look for "skills" (markdown instruction
//! folders) under different conventions inside a project:
//! `.agents/skills`, `.claude/skills`, `.codex/skills`, `.cursor/skills`,
//! `.opencode/skills`, `.github/skills`, … This module scans a project for
//! all of them, and can copy/import skills between conventions so one skill
//! can serve every agent.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Known skill-folder conventions: `(id, relative dir)`.
pub const CONVENTIONS: &[(&str, &str)] = &[
    ("agents", ".agents/skills"),
    ("claude", ".claude/skills"),
    ("codex", ".codex/skills"),
    ("cursor", ".cursor/skills"),
    ("opencode", ".opencode/skills"),
    ("github", ".github/skills"),
];

/// One skill found in a project (a folder containing `SKILL.md`, or a bare
/// `*.md` file directly inside a convention dir).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillEntry {
    /// Convention id (e.g. "claude") — see [`CONVENTIONS`].
    pub convention: String,
    /// Skill name (folder name, or file stem for bare markdown files).
    pub name: String,
    /// Absolute path of the skill folder (or bare file).
    pub path: String,
    /// Absolute path of the main markdown file (SKILL.md or the bare file).
    pub skill_md: String,
    /// Whether this entry is a folder-style skill (vs. a single .md file).
    pub is_dir: bool,
    /// Size of the main markdown file in bytes.
    pub size: u64,
    /// Disabled skills are renamed with a `.disabled` suffix so agents skip
    /// them; the manager still lists them for re-enabling.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// FNV-1a 64 hash of the main markdown content (duplicate detection).
    #[serde(default)]
    pub content_hash: String,
}

fn default_true() -> bool {
    true
}

/// Suffix appended to a skill folder/file name to disable it.
pub const DISABLED_SUFFIX: &str = ".disabled";

/// FNV-1a 64-bit content hash (hex). Stable, dependency-free; used only to
/// spot identical copies of a skill — not for security.
fn fnv1a64(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// Root directory for *global* (user-level) skills: the home directory.
/// Agents also read skills from `~/.claude/skills`, `~/.codex/skills`, … so
/// [`scan`]/[`import`]/[`copy_to`] work unchanged against this root.
pub fn global_root() -> Result<PathBuf> {
    dirs::home_dir().ok_or_else(|| Error::Config("cannot resolve the home directory".into()))
}

fn convention_dir(root: &Path, convention: &str) -> Result<PathBuf> {
    CONVENTIONS
        .iter()
        .find(|(id, _)| *id == convention)
        .map(|(_, rel)| root.join(rel))
        .ok_or_else(|| Error::InvalidInput(format!("unknown skill convention {convention:?}")))
}

fn push_entry(
    out: &mut Vec<SkillEntry>,
    convention: &str,
    name: &str,
    path: &Path,
    md: &Path,
    is_dir: bool,
    enabled: bool,
) {
    let bytes = std::fs::read(md).unwrap_or_default();
    out.push(SkillEntry {
        convention: convention.to_string(),
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        skill_md: md.to_string_lossy().into_owned(),
        is_dir,
        size: bytes.len() as u64,
        enabled,
        content_hash: fnv1a64(&bytes),
    });
}

/// Scan a project root for skills across all known conventions.
pub fn scan(root: &str) -> Result<Vec<SkillEntry>> {
    let root = Path::new(root);
    if !root.is_dir() {
        return Err(Error::NotFound(format!("project root {}", root.display())));
    }
    let mut out = Vec::new();
    for (id, rel) in CONVENTIONS {
        let dir = root.join(rel);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(raw_name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
                continue;
            };
            if raw_name.starts_with('.') {
                continue;
            }
            let enabled = !raw_name.ends_with(DISABLED_SUFFIX);
            let name = raw_name.trim_end_matches(DISABLED_SUFFIX).to_string();
            if path.is_dir() {
                let md = path.join("SKILL.md");
                if md.is_file() {
                    push_entry(&mut out, id, &name, &path, &md, true, enabled);
                }
            } else if name.to_lowercase().ends_with(".md") {
                let stem = name.trim_end_matches(".md").trim_end_matches(".MD");
                push_entry(&mut out, id, stem, &path, &path, false, enabled);
            }
        }
    }
    out.sort_by(|a, b| {
        (a.convention.as_str(), a.name.as_str()).cmp(&(b.convention.as_str(), b.name.as_str()))
    });
    Ok(out)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)?.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// Copy a skill into another convention folder of the same project.
/// Folder skills are copied recursively; bare `.md` files become
/// `{name}/SKILL.md` so the result works everywhere. Refuses to overwrite.
pub fn copy_to(root: &str, skill_path: &str, to_convention: &str) -> Result<SkillEntry> {
    let src = Path::new(skill_path);
    if !src.exists() {
        return Err(Error::NotFound(format!("skill {}", src.display())));
    }
    let name = src
        .file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| Error::InvalidInput("skill path has no name".into()))?;
    let dest_dir = convention_dir(Path::new(root), to_convention)?.join(&name);
    if dest_dir.exists() {
        return Err(Error::InvalidInput(format!(
            "{} already exists in .{to_convention}",
            name
        )));
    }
    if src.is_dir() {
        copy_dir_recursive(src, &dest_dir)?;
    } else {
        std::fs::create_dir_all(&dest_dir)?;
        std::fs::copy(src, dest_dir.join("SKILL.md"))?;
    }
    let md = dest_dir.join("SKILL.md");
    let bytes = std::fs::read(&md).unwrap_or_default();
    Ok(SkillEntry {
        convention: to_convention.to_string(),
        name,
        path: dest_dir.to_string_lossy().into_owned(),
        skill_md: md.to_string_lossy().into_owned(),
        is_dir: true,
        size: bytes.len() as u64,
        enabled: true,
        content_hash: fnv1a64(&bytes),
    })
}

/// Create/import a skill from markdown content as
/// `{convention dir}/{name}/SKILL.md`. Refuses to overwrite.
pub fn import(root: &str, convention: &str, name: &str, content: &str) -> Result<SkillEntry> {
    let name = name.trim().trim_end_matches(".md");
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(Error::InvalidInput(format!("invalid skill name {name:?}")));
    }
    let dir = convention_dir(Path::new(root), convention)?.join(name);
    let md = dir.join("SKILL.md");
    if md.exists() {
        return Err(Error::InvalidInput(format!(
            "skill {name:?} already exists in .{convention}"
        )));
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&md, content)?;
    Ok(SkillEntry {
        convention: convention.to_string(),
        name: name.to_string(),
        path: dir.to_string_lossy().into_owned(),
        skill_md: md.to_string_lossy().into_owned(),
        is_dir: true,
        size: content.len() as u64,
        enabled: true,
        content_hash: fnv1a64(content.as_bytes()),
    })
}

/// True when `path` sits directly inside a known skills convention dir
/// (`…/.claude/skills/<entry>` etc.) — guards destructive operations.
fn is_managed_skill_path(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let tail: Vec<String> = parent
        .components()
        .rev()
        .take(2)
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if tail.len() != 2 || tail[0] != "skills" {
        return false;
    }
    CONVENTIONS
        .iter()
        .any(|(_, rel)| rel.starts_with(&format!("{}/", tail[1])))
}

/// Enable or disable a skill by renaming it with [`DISABLED_SUFFIX`].
/// Returns the new path. Idempotent: re-applying the same state is a no-op.
pub fn set_enabled(skill_path: &str, enabled: bool) -> Result<String> {
    let path = Path::new(skill_path);
    if !path.exists() {
        return Err(Error::NotFound(format!("skill {}", path.display())));
    }
    if !is_managed_skill_path(path) {
        return Err(Error::InvalidInput(format!(
            "{} is not inside a managed skills folder",
            path.display()
        )));
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let currently_enabled = !name.ends_with(DISABLED_SUFFIX);
    if currently_enabled == enabled {
        return Ok(skill_path.to_string());
    }
    let new_name = if enabled {
        name.trim_end_matches(DISABLED_SUFFIX).to_string()
    } else {
        format!("{name}{DISABLED_SUFFIX}")
    };
    let new_path = path.with_file_name(&new_name);
    if new_path.exists() {
        return Err(Error::InvalidInput(format!(
            "{} already exists",
            new_path.display()
        )));
    }
    std::fs::rename(path, &new_path)?;
    Ok(new_path.to_string_lossy().into_owned())
}

/// Delete a skill (folder or bare file). Only paths directly inside a known
/// convention dir are accepted — refuses everything else.
pub fn remove(skill_path: &str) -> Result<()> {
    let path = Path::new(skill_path);
    if !path.exists() {
        return Err(Error::NotFound(format!("skill {}", path.display())));
    }
    if !is_managed_skill_path(path) {
        return Err(Error::InvalidInput(format!(
            "{} is not inside a managed skills folder",
            path.display()
        )));
    }
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Folder-style skill for Claude.
        let claude = root.join(".claude/skills/pdf-tools");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(claude.join("SKILL.md"), "# pdf tools").unwrap();
        std::fs::write(claude.join("helper.py"), "print()").unwrap();
        // Bare markdown skill for Codex.
        let codex = root.join(".codex/skills");
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(codex.join("review.md"), "# review").unwrap();
        // A folder without SKILL.md must be ignored.
        std::fs::create_dir_all(root.join(".claude/skills/not-a-skill")).unwrap();
        dir
    }

    #[test]
    fn global_root_is_absolute() {
        let root = global_root().unwrap();
        assert!(root.is_absolute());
    }

    #[test]
    fn scan_finds_folder_and_bare_skills() {
        let dir = setup();
        let found = scan(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].convention, "claude");
        assert_eq!(found[0].name, "pdf-tools");
        assert!(found[0].is_dir);
        assert_eq!(found[1].convention, "codex");
        assert_eq!(found[1].name, "review");
        assert!(!found[1].is_dir);
    }

    #[test]
    fn scan_missing_root_is_not_found() {
        assert_eq!(
            scan("/definitely/not/here").unwrap_err().kind(),
            "not_found"
        );
    }

    #[test]
    fn copy_folder_skill_between_conventions() {
        let dir = setup();
        let root = dir.path().to_str().unwrap().to_string();
        let src = dir.path().join(".claude/skills/pdf-tools");
        let copied = copy_to(&root, src.to_str().unwrap(), "agents").unwrap();
        assert_eq!(copied.convention, "agents");
        assert!(dir
            .path()
            .join(".agents/skills/pdf-tools/SKILL.md")
            .is_file());
        assert!(dir
            .path()
            .join(".agents/skills/pdf-tools/helper.py")
            .is_file());
        // Refuses to overwrite.
        assert_eq!(
            copy_to(&root, src.to_str().unwrap(), "agents")
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    #[test]
    fn copy_bare_md_becomes_folder_skill() {
        let dir = setup();
        let root = dir.path().to_str().unwrap().to_string();
        let src = dir.path().join(".codex/skills/review.md");
        copy_to(&root, src.to_str().unwrap(), "claude").unwrap();
        let md = dir.path().join(".claude/skills/review/SKILL.md");
        assert_eq!(std::fs::read_to_string(md).unwrap(), "# review");
    }

    #[test]
    fn disable_enable_roundtrip() {
        let dir = setup();
        let skill = dir.path().join(".claude/skills/pdf-tools");
        let disabled = set_enabled(skill.to_str().unwrap(), false).unwrap();
        assert!(disabled.ends_with("pdf-tools.disabled"));
        let found = scan(dir.path().to_str().unwrap()).unwrap();
        let entry = found.iter().find(|s| s.name == "pdf-tools").unwrap();
        assert!(!entry.enabled);
        // Idempotent disable.
        assert_eq!(set_enabled(&disabled, false).unwrap(), disabled);
        let enabled = set_enabled(&disabled, true).unwrap();
        assert!(enabled.ends_with("pdf-tools"));
        let found = scan(dir.path().to_str().unwrap()).unwrap();
        assert!(
            found
                .iter()
                .find(|s| s.name == "pdf-tools")
                .unwrap()
                .enabled
        );
    }

    #[test]
    fn remove_deletes_only_managed_paths() {
        let dir = setup();
        let skill = dir.path().join(".claude/skills/pdf-tools");
        remove(skill.to_str().unwrap()).unwrap();
        assert!(!skill.exists());
        // Refuses paths outside convention dirs.
        let outside = dir.path().join("random");
        std::fs::create_dir_all(&outside).unwrap();
        assert_eq!(
            remove(outside.to_str().unwrap()).unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            set_enabled(outside.to_str().unwrap(), false)
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    #[test]
    fn scan_reports_content_hash() {
        let dir = setup();
        let found = scan(dir.path().to_str().unwrap()).unwrap();
        assert!(found.iter().all(|s| s.content_hash.len() == 16));
        // Same content => same hash.
        let h1 = &found[0].content_hash;
        assert_eq!(*h1, super::fnv1a64(b"# pdf tools"));
    }

    #[test]
    fn import_writes_skill_md() {
        let dir = setup();
        let root = dir.path().to_str().unwrap().to_string();
        let entry = import(&root, "cursor", "my-skill", "# hi").unwrap();
        assert_eq!(entry.name, "my-skill");
        assert!(dir
            .path()
            .join(".cursor/skills/my-skill/SKILL.md")
            .is_file());
        assert_eq!(
            import(&root, "cursor", "my-skill", "# hi")
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
        assert_eq!(
            import(&root, "cursor", "../evil", "#").unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            import(&root, "bogus", "ok", "#").unwrap_err().kind(),
            "invalid_input"
        );
    }
}
