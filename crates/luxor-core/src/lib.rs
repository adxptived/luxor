//! # luxor-core
//!
//! All of Luxor's domain logic lives here, deliberately independent from Tauri:
//!
//! - [`pty`] — real terminal sessions via `portable-pty` (ConPTY on Windows)
//! - [`gitx`] — repository inspection & actions via `git2` (vendored libgit2)
//! - [`projects`] — SQLite-backed project registry & tabs
//! - [`layout`] — savable terminal layout presets (JSON)
//! - [`launcher`] — opening external terminals / file managers / IDEs / executables
//! - [`secrets`] — OS keychain storage via `keyring`
//! - [`config`] — global app settings (TOML)
//!
//! Keeping this crate free of GUI dependencies makes it compilable and unit-testable
//! on any machine (including headless CI) without webkit/GTK system libraries.

pub mod active_window;
pub mod activity_os;
pub mod agents;
pub mod audit;
pub mod cards;
pub mod cli;
pub mod colors;
pub mod config;
pub mod crashlog;
pub mod devtools;
pub mod diag;
pub mod discord;
pub mod dockerx;
pub mod error;
pub mod fsx;
pub mod github;
pub mod gitx;
pub mod httpx;
pub mod insights;
pub mod launcher;
pub mod layout;
pub mod market;
pub mod metricprovider;
pub mod notes;
pub mod procs;
pub mod projects;
pub mod pty;
pub mod redact;
pub mod search;
pub mod secrets;
pub mod skills;
pub mod stats;
pub mod telemetry;
pub mod updatex;
pub mod webhook;

pub use error::{Error, Result};

/// Application identifier used for config dirs and the OS keychain service name.
pub const APP_ID: &str = "com.luxor.app";

/// Human-readable application name.
pub const APP_NAME: &str = "Luxor";
