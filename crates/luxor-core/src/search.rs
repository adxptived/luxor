//! Project-wide find & replace.
//!
//! Walks the project tree (skipping VCS/build/dependency directories and
//! binary files), matching literally or by regex, and can apply replacements
//! with a dry-run preview first.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{fsx, Error, Result};

/// Directories never searched (heavy, generated, or VCS internals).
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    ".idea",
    ".vs",
    "out",
];

/// Per-file size cap — bigger files are skipped (logs, bundles, …).
const MAX_FILE_BYTES: u64 = 1_500_000;

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    /// Path relative to the search root (forward slashes).
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    /// The full line text (trimmed to a sane length).
    pub text: String,
    /// Byte offset of the match start within `text`.
    pub start: usize,
    /// Byte offset of the match end within `text`.
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchReport {
    pub hits: Vec<SearchHit>,
    pub files_scanned: usize,
    /// True when the result list was cut off at `max_results`.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplaceReport {
    pub files_changed: usize,
    pub replacements: usize,
}

enum Matcher {
    /// Case-sensitive exact byte match.
    Literal { needle: String },
    /// Regex matcher. `expand` is true for a real user regex (replacement
    /// honors `$1`/`${name}` groups); false when this regex was synthesized
    /// from a case-insensitive *literal* (replacement is inserted verbatim).
    Regex { re: regex::Regex, expand: bool },
}

impl Matcher {
    fn build(query: &str, use_regex: bool, case_sensitive: bool) -> Result<Self> {
        if query.is_empty() {
            return Err(Error::InvalidInput("empty search query".into()));
        }
        if use_regex {
            let re = regex::RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|e| Error::InvalidInput(format!("invalid regex: {e}")))?;
            Ok(Matcher::Regex { re, expand: true })
        } else if case_sensitive {
            Ok(Matcher::Literal {
                needle: query.to_string(),
            })
        } else {
            // Case-insensitive literal: compile an *escaped*, case-insensitive
            // regex. Doing the matching through `regex` gives correct Unicode
            // case folding and always-valid byte offsets. The old approach
            // searched in `content.to_lowercase()` and reused those offsets on
            // the original string — but `to_lowercase()` can change byte length
            // (e.g. `İ`, `ß`), so offsets drifted into the middle of a UTF-8
            // codepoint and panicked when slicing.
            let re = regex::RegexBuilder::new(&regex::escape(query))
                .case_insensitive(true)
                .build()
                .map_err(|e| Error::InvalidInput(format!("invalid search: {e}")))?;
            Ok(Matcher::Regex { re, expand: false })
        }
    }

    /// All (start, end) byte ranges of matches in `hay`. Offsets are always on
    /// valid UTF-8 boundaries of `hay`.
    fn ranges(&self, hay: &str) -> Vec<(usize, usize)> {
        match self {
            Matcher::Regex { re, .. } => re.find_iter(hay).map(|m| (m.start(), m.end())).collect(),
            Matcher::Literal { needle } => {
                let mut out = Vec::new();
                let mut from = 0;
                while let Some(pos) = hay[from..].find(needle.as_str()) {
                    let start = from + pos;
                    let end = start + needle.len();
                    out.push((start, end));
                    // Advance past this match (guard against a zero-width needle).
                    from = end.max(start + 1);
                    if from > hay.len() {
                        break;
                    }
                }
                out
            }
        }
    }

    /// Replace every match in `content`, returning the new text and the number
    /// of replacements. Operates on the whole file (same as `ranges`), so the
    /// search preview and the applied result never disagree.
    fn replace_all(&self, content: &str, replacement: &str) -> (String, usize) {
        match self {
            Matcher::Regex { re, expand } => {
                let count = re.find_iter(content).count();
                let next = if *expand {
                    re.replace_all(content, replacement).into_owned()
                } else {
                    // Verbatim replacement (don't interpret `$1` for literals).
                    re.replace_all(content, regex::NoExpand(replacement))
                        .into_owned()
                };
                (next, count)
            }
            Matcher::Literal { .. } => {
                let mut out = String::with_capacity(content.len());
                let mut last = 0;
                let mut count = 0;
                for (s, e) in self.ranges(content) {
                    if s < last {
                        continue;
                    }
                    out.push_str(&content[last..s]);
                    out.push_str(replacement);
                    last = e;
                    count += 1;
                }
                out.push_str(&content[last..]);
                (out, count)
            }
        }
    }
}

/// Optional filters narrowing which files a search/replace touches.
#[derive(Debug, Clone, Default)]
pub struct Filters {
    /// Glob patterns (gitignore syntax, e.g. `*.rs`, `src/**`) to *include*.
    /// When empty, every non-ignored file is eligible.
    pub includes: Vec<String>,
    /// Glob patterns to *exclude* (e.g. `*.lock`, `**/snapshots/**`).
    pub excludes: Vec<String>,
    /// Restrict the walk to this root-relative subdirectory (or single file).
    pub subdir: Option<String>,
}

/// Collect candidate files under `root`, honoring `filters`.
///
/// Uses the `ignore` walker so we get, for free:
/// - `.gitignore` / `.git/info/exclude` respected inside git repos (build
///   artifacts, `node_modules`, etc. are skipped without hard-coding them);
/// - no symlink following, so a symlink cycle can't cause infinite recursion
///   or a stack overflow (the old `path.is_dir()` walk followed dir symlinks);
/// - parallel directory traversal (`build_parallel`) for speed on big trees.
///
/// The heavy/VCS dirs in `SKIP_DIRS` are still hard-skipped even when a project
/// has no `.gitignore`. Include/exclude globs are applied on top.
fn collect_files_filtered(root: &Path, filters: &Filters) -> Result<Vec<PathBuf>> {
    use ignore::overrides::OverrideBuilder;
    use ignore::{WalkBuilder, WalkState};
    use std::sync::{Arc, Mutex};

    // Resolve the optional subdirectory scope; it must stay inside the root.
    let start = match filters.subdir.as_deref() {
        Some(s) if !s.is_empty() => {
            let joined = root.join(s);
            if !fsx::is_within_root(root, &joined) {
                return Err(Error::InvalidInput(
                    "search scope escapes the project root".into(),
                ));
            }
            joined
        }
        _ => root.to_path_buf(),
    };
    if !start.exists() {
        return Ok(Vec::new());
    }

    // Build include/exclude globs. In `ignore`'s override syntax a bare glob is
    // an allow-list entry (if any exist, non-matching files are dropped) and a
    // `!`-prefixed glob is an ignore entry. Globs are matched relative to the
    // walk root (`start`).
    let overrides = {
        let mut ob = OverrideBuilder::new(&start);
        for inc in &filters.includes {
            let g = inc.trim();
            if !g.is_empty() {
                ob.add(g)
                    .map_err(|e| Error::InvalidInput(format!("bad include glob '{g}': {e}")))?;
            }
        }
        for exc in &filters.excludes {
            let g = exc.trim();
            if !g.is_empty() {
                let pat = if g.starts_with('!') {
                    g.to_string()
                } else {
                    format!("!{g}")
                };
                ob.add(&pat)
                    .map_err(|e| Error::InvalidInput(format!("bad exclude glob '{g}': {e}")))?;
            }
        }
        ob.build()
            .map_err(|e| Error::InvalidInput(format!("invalid glob filters: {e}")))?
    };

    let found = Arc::new(Mutex::new(Vec::new()));
    WalkBuilder::new(&start)
        .hidden(false) // keep searching dotfiles (e.g. `.env`), as before
        .follow_links(false) // cycle guard
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .parents(true)
        .overrides(overrides)
        .filter_entry(|e| {
            // Always skip the heavy/generated/VCS dirs, even with no .gitignore.
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !(SKIP_DIRS.contains(&name.as_ref()) || name.starts_with(".git"))
        })
        .build_parallel()
        .run(|| {
            let found = Arc::clone(&found);
            Box::new(move |result| {
                if let Ok(entry) = result {
                    if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                        if let Ok(mut guard) = found.lock() {
                            guard.push(entry.into_path());
                        }
                    }
                }
                WalkState::Continue
            })
        });

    let mut out = Arc::try_unwrap(found)
        .map(|m| m.into_inner().unwrap_or_default())
        .unwrap_or_default();
    out.sort();
    Ok(out)
}

/// Byte offset where each line starts (`[0, after-first-\n, ...]`).
fn line_start_offsets(content: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, b) in content.bytes().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

/// 0-based line index containing byte offset `pos`.
fn line_for_offset(starts: &[usize], pos: usize) -> usize {
    match starts.binary_search(&pos) {
        Ok(i) => i,
        // starts[0] == 0 <= pos, so the insertion point is always >= 1.
        Err(i) => i - 1,
    }
}

fn readable_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None; // binary
    }
    Some(String::from_utf8_lossy(&bytes).to_string())
}

/// Like [`readable_text`] but only returns *valid* UTF-8. Used by replace so we
/// never write back a lossily-decoded (`U+FFFD`-mangled) version of a file that
/// wasn't UTF-8 to begin with — that would silently corrupt the user's data.
fn readable_text_strict(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None; // binary
    }
    String::from_utf8(bytes).ok()
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Search all text files under `root` (no extra filters).
pub fn search_files(
    root: &str,
    query: &str,
    use_regex: bool,
    case_sensitive: bool,
    max_results: usize,
) -> Result<SearchReport> {
    search_files_filtered(
        root,
        query,
        use_regex,
        case_sensitive,
        max_results,
        &Filters::default(),
    )
}

/// Search text files under `root`, restricted by `filters` (include/exclude
/// globs and/or a subdirectory scope).
pub fn search_files_filtered(
    root: &str,
    query: &str,
    use_regex: bool,
    case_sensitive: bool,
    max_results: usize,
    filters: &Filters,
) -> Result<SearchReport> {
    let matcher = Matcher::build(query, use_regex, case_sensitive)?;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let files = collect_files_filtered(root_path, filters)?;

    let max = max_results.clamp(1, 5000);
    let mut hits = Vec::new();
    let mut truncated = false;
    let mut files_scanned = 0;
    'outer: for file in &files {
        let Some(content) = readable_text(file) else {
            continue;
        };
        files_scanned += 1;
        // Match over the whole file (consistent with replace), then map each
        // byte offset back to its 1-based line and column.
        let line_starts = line_start_offsets(&content);
        for (start, end) in matcher.ranges(&content) {
            if hits.len() >= max {
                truncated = true;
                break 'outer;
            }
            let li = line_for_offset(&line_starts, start);
            let line_start = line_starts[li];
            let line_end = line_starts
                .get(li + 1)
                .map(|n| n - 1)
                .unwrap_or(content.len());
            // Line text without the trailing newline (and a trailing \r on CRLF).
            let mut line_text = &content[line_start..line_end.min(content.len())];
            if line_text.ends_with('\r') {
                line_text = &line_text[..line_text.len() - 1];
            }
            let col_start = start - line_start;
            // Clamp the end to this line so a multi-line regex match highlights
            // sanely on its first line.
            let col_end = end.min(line_end).saturating_sub(line_start);
            let display: String = line_text.chars().take(400).collect();
            let disp_len = display.len();
            hits.push(SearchHit {
                path: rel(root_path, file),
                line: li + 1,
                start: col_start.min(disp_len),
                end: col_end.min(disp_len),
                text: display,
            });
        }
    }
    Ok(SearchReport {
        hits,
        files_scanned,
        truncated,
    })
}

/// Replace all matches under `root`. When `only_paths` is non-empty, only
/// those (root-relative) files are touched — this powers the per-file
/// checkboxes in the preview UI.
pub fn replace_in_files(
    root: &str,
    query: &str,
    replacement: &str,
    use_regex: bool,
    case_sensitive: bool,
    only_paths: &[String],
) -> Result<ReplaceReport> {
    replace_in_files_filtered(
        root,
        query,
        replacement,
        use_regex,
        case_sensitive,
        only_paths,
        &Filters::default(),
    )
}

/// Like [`replace_in_files`] but also honoring include/exclude globs and a
/// subdirectory scope via `filters`.
#[allow(clippy::too_many_arguments)]
pub fn replace_in_files_filtered(
    root: &str,
    query: &str,
    replacement: &str,
    use_regex: bool,
    case_sensitive: bool,
    only_paths: &[String],
    filters: &Filters,
) -> Result<ReplaceReport> {
    let matcher = Matcher::build(query, use_regex, case_sensitive)?;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(Error::NotFound(format!("directory {root}")));
    }
    let files = collect_files_filtered(root_path, filters)?;

    let mut files_changed = 0;
    let mut replacements = 0;
    for file in &files {
        let rel_path = rel(root_path, file);
        if !only_paths.is_empty() && !only_paths.contains(&rel_path) {
            continue;
        }
        // Strict UTF-8 only: skip (don't corrupt) non-UTF-8 files on replace.
        let Some(content) = readable_text_strict(file) else {
            continue;
        };
        let (next, count) = matcher.replace_all(&content, replacement);
        if count == 0 {
            continue;
        }
        fsx::write_text(&file.to_string_lossy(), &next)?;
        files_changed += 1;
        replacements += count;
    }
    Ok(ReplaceReport {
        files_changed,
        replacements,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "Hello world\nhello again\n").unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub/b.rs"), "fn hello() {}\n").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        fs::write(dir.path().join("node_modules/x/c.js"), "hello hidden\n").unwrap();
        fs::write(
            dir.path().join("bin.dat"),
            [0u8, 1, 2, 104, 101, 108, 108, 111],
        )
        .unwrap();
        let path = dir.path().to_string_lossy().to_string();
        (dir, path)
    }

    #[test]
    fn literal_search_skips_ignored_and_binary() {
        let (_d, root) = setup();
        let report = search_files(&root, "hello", false, false, 100).unwrap();
        let paths: Vec<&str> = report.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(report.hits.len(), 3);
        assert!(paths.contains(&"a.txt"));
        assert!(paths.contains(&"sub/b.rs"));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains("bin.dat")));
    }

    #[test]
    fn case_sensitive_search() {
        let (_d, root) = setup();
        let report = search_files(&root, "Hello", false, true, 100).unwrap();
        assert_eq!(report.hits.len(), 1);
        assert_eq!(report.hits[0].line, 1);
        assert_eq!(report.hits[0].start, 0);
        assert_eq!(report.hits[0].end, 5);
    }

    #[test]
    fn regex_search_and_invalid_regex() {
        let (_d, root) = setup();
        let report = search_files(&root, r"fn \w+\(\)", true, true, 100).unwrap();
        assert_eq!(report.hits.len(), 1);
        assert_eq!(report.hits[0].path, "sub/b.rs");
        assert!(search_files(&root, "(", true, true, 100).is_err());
    }

    #[test]
    fn truncation_flag() {
        let (_d, root) = setup();
        let report = search_files(&root, "hello", false, false, 2).unwrap();
        assert_eq!(report.hits.len(), 2);
        assert!(report.truncated);
    }

    #[test]
    fn replace_literal_all_and_filtered() {
        let (_d, root) = setup();
        let report = replace_in_files(&root, "hello", "hi", false, false, &[]).unwrap();
        assert_eq!(report.files_changed, 2);
        assert_eq!(report.replacements, 3);
        let a = fs::read_to_string(Path::new(&root).join("a.txt")).unwrap();
        assert_eq!(a, "hi world\nhi again\n");

        let (_d2, root2) = setup();
        let report =
            replace_in_files(&root2, "hello", "hi", false, false, &["a.txt".into()]).unwrap();
        assert_eq!(report.files_changed, 1);
        let b = fs::read_to_string(Path::new(&root2).join("sub/b.rs")).unwrap();
        assert!(b.contains("hello"));
    }

    #[test]
    fn replace_regex_with_groups() {
        let (_d, root) = setup();
        replace_in_files(&root, r"fn (\w+)\(\)", "fn ${1}_v2()", true, true, &[]).unwrap();
        let b = fs::read_to_string(Path::new(&root).join("sub/b.rs")).unwrap();
        assert!(b.contains("fn hello_v2()"));
    }

    #[test]
    fn ci_literal_replace_handles_non_ascii_without_panicking() {
        // `İ`.to_lowercase() expands to two codepoints. With the old code that
        // lowercased the whole haystack, the byte offsets of a *later* ASCII
        // match ("is") drifted relative to the original string and sliced
        // mid-codepoint → panic. The İ prefix reproduces that drift.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("t.txt"), "İ this is it\n").unwrap();
        let root = dir.path().to_string_lossy().to_string();

        // Neither of these may panic.
        let _ = search_files(&root, "is", false, false, 100).unwrap();
        let rep = replace_in_files(&root, "is", "X", false, false, &[]).unwrap();
        assert!(rep.replacements >= 1, "the ASCII matches after İ are found");
        // Output is still valid UTF-8 (read_to_string would error otherwise).
        let out = fs::read_to_string(dir.path().join("t.txt")).unwrap();
        assert_eq!(out, "İ thX X it\n");
    }

    #[test]
    fn literal_replacement_text_is_verbatim_even_with_dollar() {
        // A case-insensitive literal replacement containing `$1` must be
        // inserted literally, not treated as a regex group reference.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("p.txt"), "price FOO bar\n").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        replace_in_files(&root, "foo", "$1 USD", false, false, &[]).unwrap();
        let out = fs::read_to_string(dir.path().join("p.txt")).unwrap();
        assert_eq!(out, "price $1 USD bar\n");
    }

    #[test]
    fn search_reports_correct_line_numbers_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("m.txt"), "alpha\nbeta target\ngamma\n").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let report = search_files(&root, "target", false, true, 100).unwrap();
        assert_eq!(report.hits.len(), 1);
        assert_eq!(report.hits[0].line, 2);
        assert_eq!(report.hits[0].text, "beta target");
        assert_eq!(report.hits[0].start, 5);
        assert_eq!(report.hits[0].end, 11);
    }

    #[test]
    fn multiline_regex_preview_and_replace_agree() {
        // A pattern spanning a newline now both previews (as a hit) and applies.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("ml.txt"), "open\nclose\n").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let report = search_files(&root, r"open\nclose", true, true, 100).unwrap();
        assert_eq!(report.hits.len(), 1, "multiline match is previewed");
        let rep = replace_in_files(&root, r"open\nclose", "merged", true, true, &[]).unwrap();
        assert_eq!(rep.replacements, 1);
        assert_eq!(
            fs::read_to_string(dir.path().join("ml.txt")).unwrap(),
            "merged\n"
        );
    }

    #[test]
    fn respects_gitignore_inside_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        // Make it look like a git repo so .gitignore is honored.
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "secret.txt\nbuilddir/\n").unwrap();
        fs::write(dir.path().join("keep.txt"), "needle here\n").unwrap();
        fs::write(dir.path().join("secret.txt"), "needle here\n").unwrap();
        fs::create_dir_all(dir.path().join("builddir")).unwrap();
        fs::write(dir.path().join("builddir/x.txt"), "needle here\n").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let report = search_files(&root, "needle", false, false, 100).unwrap();
        let paths: Vec<&str> = report.hits.iter().map(|h| h.path.as_str()).collect();
        assert!(paths.contains(&"keep.txt"));
        assert!(
            !paths.iter().any(|p| p.contains("secret.txt")),
            "gitignored file skipped"
        );
        assert!(
            !paths.iter().any(|p| p.contains("builddir")),
            "gitignored dir skipped"
        );
    }

    #[test]
    fn include_glob_limits_to_matching_files() {
        let (_d, root) = setup();
        let filters = Filters {
            includes: vec!["*.rs".into()],
            ..Default::default()
        };
        let report = search_files_filtered(&root, "hello", false, false, 100, &filters).unwrap();
        let paths: Vec<&str> = report.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec!["sub/b.rs"], "only .rs files searched");
    }

    #[test]
    fn exclude_glob_drops_matching_files() {
        let (_d, root) = setup();
        let filters = Filters {
            excludes: vec!["*.rs".into()],
            ..Default::default()
        };
        let report = search_files_filtered(&root, "hello", false, false, 100, &filters).unwrap();
        let paths: Vec<&str> = report.hits.iter().map(|h| h.path.as_str()).collect();
        assert!(paths.contains(&"a.txt"));
        assert!(!paths.iter().any(|p| p.ends_with(".rs")), "rs excluded");
    }

    #[test]
    fn subdir_scope_restricts_walk() {
        let (_d, root) = setup();
        let filters = Filters {
            subdir: Some("sub".into()),
            ..Default::default()
        };
        let report = search_files_filtered(&root, "hello", false, false, 100, &filters).unwrap();
        let paths: Vec<&str> = report.hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths, vec!["sub/b.rs"], "only the sub/ tree searched");
    }

    #[test]
    fn subdir_scope_rejects_escape() {
        let (_d, root) = setup();
        let filters = Filters {
            subdir: Some("../..".into()),
            ..Default::default()
        };
        let err = search_files_filtered(&root, "hello", false, false, 100, &filters);
        assert!(err.is_err(), "escaping the root is rejected");
    }

    #[test]
    fn invalid_glob_is_reported() {
        let (_d, root) = setup();
        let filters = Filters {
            includes: vec!["[".into()],
            ..Default::default()
        };
        assert!(search_files_filtered(&root, "hello", false, false, 100, &filters).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn symlink_cycle_does_not_recurse_forever() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "needle\n").unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        // sub/loop -> .. (parent): a cycle the old walker would follow forever.
        symlink(dir.path(), sub.join("loop")).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        // Must terminate (and not stack-overflow).
        let report = search_files(&root, "needle", false, false, 100).unwrap();
        assert!(report.hits.iter().any(|h| h.path == "a.txt"));
    }
}
