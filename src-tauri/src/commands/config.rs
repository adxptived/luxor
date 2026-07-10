use luxor_core::config::AppConfig;
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

#[tauri::command(async)]
pub fn config_get(state: State<'_, AppState>) -> Result<AppConfig, Error> {
    Ok(state
        .config
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone())
}

#[tauri::command(async)]
pub fn config_set(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), Error> {
    let previous = state
        .config
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();

    if previous.ui.launch_on_startup != config.ui.launch_on_startup {
        crate::autostart::set_enabled(config.ui.launch_on_startup)?;
    }

    luxor_core::config::save(&state.config_path, &config)?;
    *state
        .config
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = config.clone();

    if previous.ui.close_to_tray != config.ui.close_to_tray
        || previous.ui.allow_second_window != config.ui.allow_second_window
    {
        crate::refresh_tray_menu(&app);
    }
    Ok(())
}
