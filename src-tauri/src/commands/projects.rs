use luxor_core::projects::{Project, RecentProject, Task};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

#[tauri::command(async)]
pub fn project_add(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<Project, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .add(&path, name)
}

/// Add a blank workspace tab not bound to any folder.
#[tauri::command(async)]
pub fn project_add_blank(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<Project, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .add_blank(name)
}

#[tauri::command(async)]
pub fn project_list(state: State<'_, AppState>) -> Result<Vec<Project>, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .list()
}

#[tauri::command(async)]
pub fn project_get(state: State<'_, AppState>, id: String) -> Result<Project, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&id)
}

#[tauri::command(async)]
pub fn project_update(state: State<'_, AppState>, project: Project) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .update(&project)
}

/// Recently closed projects (newest first; excludes currently open tabs).
#[tauri::command(async)]
pub fn recent_list(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<RecentProject>, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .recent_list(limit.unwrap_or(0))
}

/// Forget a recent-projects entry.
#[tauri::command(async)]
pub fn recent_delete(state: State<'_, AppState>, path: String) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .recent_delete(&path)
}

#[tauri::command(async)]
pub fn project_remove(state: State<'_, AppState>, id: String) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&id)
}

#[tauri::command(async)]
pub fn project_reorder(state: State<'_, AppState>, ids: Vec<String>) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .reorder(&ids)
}

#[tauri::command(async)]
pub fn project_touch(state: State<'_, AppState>, id: String) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .touch_opened(&id)
}

// ---------------------------------------------------------------------------
// Kanban tasks (Tasks board)
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn task_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<Task>, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .task_list(project_id.as_deref())
}

#[tauri::command(async)]
pub fn task_add(
    state: State<'_, AppState>,
    project_id: Option<String>,
    title: String,
    description: Option<String>,
    status: Option<String>,
) -> Result<Task, Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .task_add(
            project_id.as_deref(),
            &title,
            description.as_deref().unwrap_or(""),
            status.as_deref(),
        )
}

#[tauri::command(async)]
pub fn task_update(state: State<'_, AppState>, task: Task) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .task_update(&task)
}

#[tauri::command(async)]
pub fn task_move(
    state: State<'_, AppState>,
    id: String,
    status: String,
    position: i64,
) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .task_move(&id, &status, position)
}

#[tauri::command(async)]
pub fn task_delete(state: State<'_, AppState>, id: String) -> Result<(), Error> {
    state
        .registry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .task_delete(&id)
}
