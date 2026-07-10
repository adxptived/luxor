//! Agent-skill manager commands (.agents / .claude / .codex / … folders).
//! All filesystem work runs on blocking threads.

use luxor_core::skills::{self, SkillEntry};
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

/// Scan a project root for agent skills across all known conventions.
#[tauri::command]
pub async fn skills_scan(root: String) -> Result<Vec<SkillEntry>, Error> {
    blocking(move || skills::scan(&root)).await
}

/// Copy an existing skill into another convention folder of the project.
#[tauri::command]
pub async fn skills_copy(
    root: String,
    skill_path: String,
    to_convention: String,
) -> Result<SkillEntry, Error> {
    blocking(move || skills::copy_to(&root, &skill_path, &to_convention)).await
}

/// Create/import a skill from markdown content.
#[tauri::command]
pub async fn skills_import(
    root: String,
    convention: String,
    name: String,
    content: String,
) -> Result<SkillEntry, Error> {
    blocking(move || skills::import(&root, &convention, &name, &content)).await
}

/// Root directory for global (user-level) skills: the home directory.
#[tauri::command(async)]
pub fn skills_global_root() -> Result<String, Error> {
    Ok(skills::global_root()?.to_string_lossy().into_owned())
}

/// Enable/disable a skill (renames with a `.disabled` suffix so agents skip
/// it). Returns the new skill path.
#[tauri::command]
pub async fn skills_set_enabled(skill_path: String, enabled: bool) -> Result<String, Error> {
    blocking(move || skills::set_enabled(&skill_path, enabled)).await
}

/// Delete a skill folder/file (only inside managed convention dirs).
#[tauri::command]
pub async fn skills_remove(skill_path: String) -> Result<(), Error> {
    blocking(move || skills::remove(&skill_path)).await
}
