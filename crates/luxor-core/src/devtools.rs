//! Project developer tools: .env inspection, log file aggregation, disk
//! usage of build artifacts, and dependency manifest parsing.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{Error, Result};

// ---------------------------------------------------------------------------
// .env manager
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    /// 1-based line in the file.
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvFile {
    /// Root-relative path, e.g. `.env.local`.
    pub path: String,
    pub vars: Vec<EnvVar>,
    /// Keys present in `.env.example` but missing here (filled by compare).
    pub missing_keys: Vec<String>,
}

fn parse_env(content: &str) -> Vec<EnvVar> {
    let mut vars = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some(eq) = line.find('=') {
            let key = line[..eq].trim().to_string();
            if key.is_empty() || key.contains(char::is_whitespace) {
                continue;
            }
            let mut value = line[eq + 1..].trim().to_string();
            if (value.starts_with('"') && value.ends_with('"') && value.len() >= 2)
                || (value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2)
            {
                value = value[1..value.len() - 1].to_string();
            }
            vars.push(EnvVar {
                key,
                value,
                line: i + 1,
            });
        }
    }
    vars
}

/// All `.env*` files directly in `root`, with `.env.example` comparison.
pub fn env_files(root: &str) -> Result<Vec<EnvFile>> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(root_path)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if (name == ".env" || name.starts_with(".env.")) && entry.path().is_file() {
            let content = fs::read_to_string(entry.path()).unwrap_or_default();
            files.push(EnvFile {
                path: name,
                vars: parse_env(&content),
                missing_keys: Vec::new(),
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    // Compare each real env file against the example template, if present.
    let example_keys: Vec<String> = files
        .iter()
        .find(|f| f.path == ".env.example" || f.path == ".env.sample")
        .map(|f| f.vars.iter().map(|v| v.key.clone()).collect())
        .unwrap_or_default();
    if !example_keys.is_empty() {
        for file in &mut files {
            if file.path == ".env.example" || file.path == ".env.sample" {
                continue;
            }
            file.missing_keys = example_keys
                .iter()
                .filter(|k| !file.vars.iter().any(|v| &v.key == *k))
                .cloned()
                .collect();
        }
    }
    Ok(files)
}

// ---------------------------------------------------------------------------
// Log viewer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct LogFileInfo {
    pub path: String,
    pub size: u64,
    /// Unix mtime seconds.
    pub modified: i64,
}

const LOG_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
];

fn walk_logs(root: &Path, base: &Path, out: &mut Vec<LogFileInfo>, depth: usize) {
    if depth > 4 || out.len() > 200 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !LOG_SKIP_DIRS.contains(&name.as_str()) {
                walk_logs(&path, base, out, depth + 1);
            }
        } else if name.ends_with(".log") || name.ends_with(".log.txt") {
            let Ok(meta) = entry.metadata() else { continue };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            out.push(LogFileInfo {
                path: path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                size: meta.len(),
                modified,
            });
        }
    }
}

/// `*.log` files under `root` (max depth 4), newest first.
pub fn log_files(root: &str) -> Result<Vec<LogFileInfo>> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let mut out = Vec::new();
    walk_logs(root_path, root_path, &mut out, 0);
    out.sort_by_key(|e| std::cmp::Reverse(e.modified));
    Ok(out)
}

/// Last `max_bytes` of a log file, decoded lossily (for tailing big logs).
pub fn log_tail(path: &str, max_bytes: u64) -> Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let cap = max_bytes.clamp(1024, 5_000_000);
    if len > cap {
        file.seek(SeekFrom::End(-(cap as i64)))?;
    }
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    let mut text = String::from_utf8_lossy(&buf).to_string();
    if len > cap {
        // Drop the first (probably partial) line.
        if let Some(nl) = text.find('\n') {
            text = text[nl + 1..].to_string();
        }
    }
    Ok(text)
}

// ---------------------------------------------------------------------------
// Disk usage
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct DirUsage {
    /// Root-relative directory name, e.g. `node_modules`.
    pub path: String,
    pub bytes: u64,
    /// True for known build/dependency artifacts that are safe to delete.
    pub cleanable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskUsageReport {
    pub total_bytes: u64,
    pub dirs: Vec<DirUsage>,
}

const CLEANABLE: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "__pycache__",
    ".cache",
    "out",
    ".turbo",
];

fn dir_size(path: &Path, budget: &mut u64) -> u64 {
    if *budget == 0 {
        return 0;
    }
    *budget -= 1;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut size = 0;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            size += dir_size(&p, budget);
        } else if let Ok(meta) = entry.metadata() {
            size += meta.len();
        }
    }
    size
}

/// Sizes of the project root's top-level directories (+ total), flagging
/// cleanable build artifacts. Directory traversal is budgeted so huge trees
/// cannot hang the call.
pub fn disk_usage(root: &str) -> Result<DiskUsageReport> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let mut dirs = Vec::new();
    let mut total = 0u64;
    let mut budget: u64 = 200_000; // max directories visited overall
    for entry in fs::read_dir(root_path)?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            let bytes = dir_size(&path, &mut budget);
            total += bytes;
            dirs.push(DirUsage {
                path: name.clone(),
                bytes,
                cleanable: CLEANABLE.contains(&name.as_str()),
            });
        } else if let Ok(meta) = entry.metadata() {
            total += meta.len();
        }
    }
    dirs.sort_by_key(|d| std::cmp::Reverse(d.bytes));
    Ok(DiskUsageReport {
        total_bytes: total,
        dirs,
    })
}

// ---------------------------------------------------------------------------
// Dependency manifests
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct DepEntry {
    pub name: String,
    /// Requirement string as written in the manifest.
    pub req: String,
    pub dev: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DepManifest {
    /// `npm` | `cargo` | `pip`
    pub kind: String,
    /// Root-relative manifest path.
    pub path: String,
    pub deps: Vec<DepEntry>,
}

fn parse_package_json(content: &str) -> Vec<DepEntry> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(content) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (section, dev) in [("dependencies", false), ("devDependencies", true)] {
        if let Some(map) = json.get(section).and_then(|v| v.as_object()) {
            for (name, req) in map {
                out.push(DepEntry {
                    name: name.clone(),
                    req: req.as_str().unwrap_or_default().to_string(),
                    dev,
                });
            }
        }
    }
    out
}

fn parse_cargo_toml(content: &str) -> Vec<DepEntry> {
    let Ok(toml) = content.parse::<toml::Table>() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (section, dev) in [("dependencies", false), ("dev-dependencies", true)] {
        if let Some(map) = toml.get(section).and_then(|v| v.as_table()) {
            for (name, val) in map {
                let req = match val {
                    toml::Value::String(s) => s.clone(),
                    toml::Value::Table(t) => t
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or(if t.contains_key("workspace") {
                            "workspace"
                        } else {
                            "*"
                        })
                        .to_string(),
                    _ => "*".to_string(),
                };
                out.push(DepEntry {
                    name: name.clone(),
                    req,
                    dev,
                });
            }
        }
    }
    out
}

fn parse_requirements(content: &str) -> Vec<DepEntry> {
    let mut out = Vec::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('-') {
            continue;
        }
        let line = line.split('#').next().unwrap_or("").trim();
        let split_at = line
            .find(|c: char| ['=', '<', '>', '~', '!', ';', '['].contains(&c))
            .unwrap_or(line.len());
        let name = line[..split_at].trim().to_string();
        if name.is_empty() {
            continue;
        }
        out.push(DepEntry {
            name,
            req: line[split_at..].trim().to_string(),
            dev: false,
        });
    }
    out
}

/// Parse all known dependency manifests at the project root.
pub fn dep_manifests(root: &str) -> Result<Vec<DepManifest>> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let mut out = Vec::new();
    type DepParser = fn(&str) -> Vec<DepEntry>;
    let candidates: [(&str, &str, DepParser); 4] = [
        ("npm", "package.json", parse_package_json),
        ("cargo", "Cargo.toml", parse_cargo_toml),
        ("pip", "requirements.txt", parse_requirements),
        ("pip", "requirements-dev.txt", parse_requirements),
    ];
    for (kind, file, parser) in candidates {
        let path = root_path.join(file);
        if let Ok(content) = fs::read_to_string(&path) {
            let deps = parser(&content);
            if !deps.is_empty() {
                out.push(DepManifest {
                    kind: kind.into(),
                    path: file.into(),
                    deps,
                });
            }
        }
    }
    // Cargo workspaces: also check crates/*/Cargo.toml (one level).
    let crates_dir = root_path.join("crates");
    if crates_dir.is_dir() {
        for entry in fs::read_dir(&crates_dir)?.flatten() {
            let manifest: PathBuf = entry.path().join("Cargo.toml");
            if let Ok(content) = fs::read_to_string(&manifest) {
                let deps = parse_cargo_toml(&content);
                if !deps.is_empty() {
                    out.push(DepManifest {
                        kind: "cargo".into(),
                        path: manifest
                            .strip_prefix(root_path)
                            .unwrap_or(&manifest)
                            .to_string_lossy()
                            .replace('\\', "/"),
                        deps,
                    });
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_parsing_and_compare() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".env.example"),
            "API_KEY=\nDB_URL=postgres://x\n# comment\nPORT=3000\n",
        )
        .unwrap();
        fs::write(
            dir.path().join(".env"),
            "API_KEY=\"secret\"\nexport PORT=8080\n",
        )
        .unwrap();
        let files = env_files(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(files.len(), 2);
        let env = files.iter().find(|f| f.path == ".env").unwrap();
        assert_eq!(env.vars.len(), 2);
        assert_eq!(env.vars[0].key, "API_KEY");
        assert_eq!(env.vars[0].value, "secret");
        assert_eq!(env.vars[1].key, "PORT");
        assert_eq!(env.missing_keys, vec!["DB_URL".to_string()]);
    }

    #[test]
    fn log_files_and_tail() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("app.log"), "line1\nline2\nline3\n").unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules/skip.log"), "x\n").unwrap();
        let logs = log_files(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].path, "app.log");
        let tail = log_tail(&dir.path().join("app.log").to_string_lossy(), 4096).unwrap();
        assert!(tail.contains("line3"));
    }

    #[test]
    fn disk_usage_flags_cleanable() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules/big.js"), vec![b'x'; 1000]).unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let report = disk_usage(&dir.path().to_string_lossy()).unwrap();
        let nm = report
            .dirs
            .iter()
            .find(|d| d.path == "node_modules")
            .unwrap();
        assert!(nm.cleanable);
        assert!(nm.bytes >= 1000);
        let src = report.dirs.iter().find(|d| d.path == "src").unwrap();
        assert!(!src.cleanable);
        assert!(report.total_bytes >= nm.bytes);
    }

    #[test]
    fn manifests_parse_npm_cargo_pip() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"dependencies":{"react":"^19.0.0"},"devDependencies":{"vite":"^6.0.0"}}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("Cargo.toml"),
            "[dependencies]\nserde = { version = \"1\", features = [\"derive\"] }\ntokio = \"1\"\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("requirements.txt"),
            "requests>=2.28\nflask==3.0.0\n# c\n",
        )
        .unwrap();
        let manifests = dep_manifests(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(manifests.len(), 3);
        let npm = manifests.iter().find(|m| m.kind == "npm").unwrap();
        assert_eq!(npm.deps.len(), 2);
        assert!(npm.deps.iter().any(|d| d.name == "vite" && d.dev));
        let cargo = manifests.iter().find(|m| m.kind == "cargo").unwrap();
        assert!(cargo.deps.iter().any(|d| d.name == "serde" && d.req == "1"));
        let pip = manifests.iter().find(|m| m.kind == "pip").unwrap();
        assert!(pip
            .deps
            .iter()
            .any(|d| d.name == "flask" && d.req == "==3.0.0"));
    }
}
