//! Guard test: every `#[tauri::command]` must be wired into the
//! `tauri::generate_handler![]` list in `lib.rs`.
//!
//! Background: a command can compile fine yet be unreachable from the frontend
//! if it is missing from the handler list (this exact bug shipped once — see
//! `docs/CODE_REVIEW-0.4.1.md`, "project_add_blank not found"). This test makes
//! that failure mode impossible to miss.

use std::fs;
use std::path::{Path, PathBuf};

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

/// Extract the function name following a `#[tauri::command]` attribute.
fn command_fn_names(source: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let mut names = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if !line.trim_start().starts_with("#[tauri::command") {
            continue;
        }
        // The fn signature is on one of the next few lines (after any further
        // attributes such as `#[cfg(...)]`).
        for next in lines.iter().skip(i + 1).take(5) {
            let t = next.trim_start();
            if t.starts_with("#[") {
                continue;
            }
            // `pub fn name(` or `fn name(` or `pub(crate) fn name(`
            if let Some(pos) = t.find("fn ") {
                let rest = &t[pos + 3..];
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() {
                    names.push(name);
                }
            }
            break;
        }
    }
    names
}

#[test]
fn every_command_is_registered() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src = manifest.join("src");

    let mut files = Vec::new();
    collect_rs_files(&src, &mut files);

    let lib_rs = fs::read_to_string(src.join("lib.rs")).expect("read lib.rs");
    let handler = lib_rs
        .split_once("generate_handler![")
        .and_then(|(_, rest)| rest.split_once("])"))
        .map(|(block, _)| block.to_string())
        .expect("generate_handler![...] block present in lib.rs");

    let mut missing = Vec::new();
    for file in &files {
        let source = fs::read_to_string(file).unwrap_or_default();
        for name in command_fn_names(&source) {
            // Look for the bare identifier as a token in the handler list.
            let registered = handler.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                .any(|tok| tok == name);
            if !registered {
                missing.push(format!("{name}  ({})", file.display()));
            }
        }
    }

    assert!(
        missing.is_empty(),
        "these #[tauri::command]s are not in generate_handler![] in lib.rs:\n  {}",
        missing.join("\n  ")
    );
}
