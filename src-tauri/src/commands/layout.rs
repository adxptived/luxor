use luxor_core::layout::{self, LayoutPreset};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

#[tauri::command(async)]
pub fn layout_list(state: State<'_, AppState>) -> Result<Vec<LayoutPreset>, Error> {
    layout::list(&state.presets_dir)
}

#[tauri::command(async)]
pub fn layout_get(state: State<'_, AppState>, id: String) -> Result<LayoutPreset, Error> {
    layout::get(&state.presets_dir, &id)
}

/// Save a preset (created client-side or loaded and modified). Returns the
/// stored preset with its bumped `updated_at`.
#[tauri::command(async)]
pub fn layout_save(
    state: State<'_, AppState>,
    mut preset: LayoutPreset,
) -> Result<LayoutPreset, Error> {
    layout::save(&state.presets_dir, &mut preset)?;
    Ok(preset)
}

#[tauri::command(async)]
pub fn layout_delete(state: State<'_, AppState>, id: String) -> Result<(), Error> {
    layout::delete(&state.presets_dir, &id)
}
