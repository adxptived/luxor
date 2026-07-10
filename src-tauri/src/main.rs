// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `luxor [path]` doubles as the CLI: when an instance is already running,
    // hand the path to it and exit instead of starting a second app.
    if luxor_app::cli_handoff() {
        return;
    }
    luxor_app::run()
}
