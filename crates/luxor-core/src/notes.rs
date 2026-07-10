//! Personal data store: per-project scratch notes, the snippet library,
//! line bookmarks and session snapshots. SQLite (WAL) next to the project
//! registry — never inside the repositories themselves.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub body: String,
    pub lang: String,
    /// Comma-separated tags.
    pub tags: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub project_id: Option<String>,
    pub file: String,
    pub line: usize,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    /// Opaque JSON payload serialized by the frontend (layout, open files,
    /// terminal cwds, git branch, …).
    pub data: String,
    pub created_at: String,
}

pub struct ExtrasStore {
    conn: Connection,
}

pub fn db_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| Error::Config("no config directory".into()))?
        .join(crate::APP_ID);
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("extras.sqlite"))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl ExtrasStore {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        // WAL survives crashes much better than the default journal, and a
        // quick integrity check recovers from torn writes early.
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let ok: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .unwrap_or_else(|_| "corrupt".into());
        if ok != "ok" {
            tracing::warn!("extras db failed quick_check: {ok}");
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                project_id TEXT PRIMARY KEY,
                body TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                lang TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                file TEXT NOT NULL,
                line INTEGER NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )?;
        Ok(Self { conn })
    }

    // -- scratch notes ------------------------------------------------------

    /// The per-project scratch note ("" when none yet). `project_id` "" =
    /// global note.
    pub fn note_get(&self, project_id: &str) -> Result<String> {
        let body = self
            .conn
            .query_row(
                "SELECT body FROM notes WHERE project_id = ?1",
                [project_id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        Ok(body)
    }

    pub fn note_set(&self, project_id: &str, body: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO notes (project_id, body, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(project_id) DO UPDATE SET body = ?2, updated_at = ?3",
            rusqlite::params![project_id, body, now()],
        )?;
        Ok(())
    }

    // -- snippets -----------------------------------------------------------

    pub fn snippet_list(&self) -> Result<Vec<Snippet>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, body, lang, tags, created_at, updated_at FROM snippets ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Snippet {
                id: r.get(0)?,
                title: r.get(1)?,
                body: r.get(2)?,
                lang: r.get(3)?,
                tags: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn snippet_save(&self, mut snippet: Snippet) -> Result<Snippet> {
        if snippet.id.is_empty() {
            snippet.id = new_id();
            snippet.created_at = now();
        }
        snippet.updated_at = now();
        self.conn.execute(
            "INSERT INTO snippets (id, title, body, lang, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET title = ?2, body = ?3, lang = ?4, tags = ?5, updated_at = ?7",
            rusqlite::params![
                snippet.id,
                snippet.title,
                snippet.body,
                snippet.lang,
                snippet.tags,
                snippet.created_at,
                snippet.updated_at
            ],
        )?;
        Ok(snippet)
    }

    pub fn snippet_delete(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM snippets WHERE id = ?1", [id])?;
        Ok(())
    }

    // -- bookmarks ----------------------------------------------------------

    pub fn bookmark_list(&self, project_id: Option<&str>) -> Result<Vec<Bookmark>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, file, line, note, created_at FROM bookmarks
             WHERE (?1 IS NULL AND project_id IS NULL) OR project_id = ?1
             ORDER BY file, line",
        )?;
        let rows = stmt.query_map([project_id], |r| {
            Ok(Bookmark {
                id: r.get(0)?,
                project_id: r.get(1)?,
                file: r.get(2)?,
                line: r.get::<_, i64>(3)? as usize,
                note: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Toggle: adding a bookmark on a (file, line) that already has one
    /// removes it and returns None.
    pub fn bookmark_toggle(
        &self,
        project_id: Option<&str>,
        file: &str,
        line: usize,
        note: &str,
    ) -> Result<Option<Bookmark>> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM bookmarks WHERE file = ?1 AND line = ?2
                 AND ((?3 IS NULL AND project_id IS NULL) OR project_id = ?3)",
                rusqlite::params![file, line as i64, project_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(id) = existing {
            self.conn
                .execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
            return Ok(None);
        }
        let bookmark = Bookmark {
            id: new_id(),
            project_id: project_id.map(|s| s.to_string()),
            file: file.to_string(),
            line,
            note: note.to_string(),
            created_at: now(),
        };
        self.conn.execute(
            "INSERT INTO bookmarks (id, project_id, file, line, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                bookmark.id,
                bookmark.project_id,
                bookmark.file,
                bookmark.line as i64,
                bookmark.note,
                bookmark.created_at
            ],
        )?;
        Ok(Some(bookmark))
    }

    pub fn bookmark_delete(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
        Ok(())
    }

    // -- session snapshots ----------------------------------------------------

    pub fn session_list(&self, project_id: Option<&str>) -> Result<Vec<SessionSnapshot>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, name, data, created_at FROM sessions
             WHERE ?1 IS NULL OR project_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([project_id], |r| {
            Ok(SessionSnapshot {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                data: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn session_save(
        &self,
        project_id: Option<&str>,
        name: &str,
        data: &str,
    ) -> Result<SessionSnapshot> {
        let snapshot = SessionSnapshot {
            id: new_id(),
            project_id: project_id.map(|s| s.to_string()),
            name: name.to_string(),
            data: data.to_string(),
            created_at: now(),
        };
        self.conn.execute(
            "INSERT INTO sessions (id, project_id, name, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                snapshot.id,
                snapshot.project_id,
                snapshot.name,
                snapshot.data,
                snapshot.created_at
            ],
        )?;
        Ok(snapshot)
    }

    pub fn session_delete(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_roundtrip() {
        let store = ExtrasStore::open_in_memory().unwrap();
        assert_eq!(store.note_get("p1").unwrap(), "");
        store.note_set("p1", "remember the milk").unwrap();
        store.note_set("", "global note").unwrap();
        assert_eq!(store.note_get("p1").unwrap(), "remember the milk");
        assert_eq!(store.note_get("").unwrap(), "global note");
        store.note_set("p1", "updated").unwrap();
        assert_eq!(store.note_get("p1").unwrap(), "updated");
    }

    #[test]
    fn snippets_crud() {
        let store = ExtrasStore::open_in_memory().unwrap();
        let snippet = store
            .snippet_save(Snippet {
                id: String::new(),
                title: "deploy".into(),
                body: "kubectl apply -f .".into(),
                lang: "bash".into(),
                tags: "k8s,deploy".into(),
                created_at: String::new(),
                updated_at: String::new(),
            })
            .unwrap();
        assert!(!snippet.id.is_empty());
        let mut updated = snippet.clone();
        updated.title = "deploy v2".into();
        store.snippet_save(updated).unwrap();
        let list = store.snippet_list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "deploy v2");
        store.snippet_delete(&snippet.id).unwrap();
        assert!(store.snippet_list().unwrap().is_empty());
    }

    #[test]
    fn bookmarks_toggle_and_scope() {
        let store = ExtrasStore::open_in_memory().unwrap();
        let added = store
            .bookmark_toggle(Some("p1"), "src/main.rs", 10, "check this")
            .unwrap();
        assert!(added.is_some());
        assert_eq!(store.bookmark_list(Some("p1")).unwrap().len(), 1);
        assert!(store.bookmark_list(Some("p2")).unwrap().is_empty());
        // Toggling the same line removes it.
        let removed = store
            .bookmark_toggle(Some("p1"), "src/main.rs", 10, "")
            .unwrap();
        assert!(removed.is_none());
        assert!(store.bookmark_list(Some("p1")).unwrap().is_empty());
    }

    #[test]
    fn sessions_crud() {
        let store = ExtrasStore::open_in_memory().unwrap();
        let snap = store
            .session_save(Some("p1"), "before refactor", r#"{"panels":[]}"#)
            .unwrap();
        let list = store.session_list(Some("p1")).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "before refactor");
        store.session_delete(&snap.id).unwrap();
        assert!(store.session_list(None).unwrap().is_empty());
    }
}
