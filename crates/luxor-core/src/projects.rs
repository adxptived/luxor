//! SQLite-backed project registry.
//!
//! Stores every project the user has opened: path, display name, layout binding,
//! favorite commands, linked executables/IDEs and tab ordering.
//! Database: `{config_dir}/luxor/projects.db`. Schema is migrated in-place via
//! `PRAGMA user_version` — never break existing user data (project rule).

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// A registered project (one tab in the UI).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Absolute path to the project directory.
    pub path: String,
    /// Layout preset id bound to this project (restored when the tab opens).
    pub layout_preset_id: Option<String>,
    /// Favorite commands shown in the launcher (JSON array of strings).
    pub favorite_commands: Vec<String>,
    /// Pinned executables (relative or absolute paths) for quick run.
    pub linked_executables: Vec<String>,
    /// Preferred IDE command for this project (e.g. "code", "zed").
    pub preferred_ide: Option<String>,
    /// Tab sort order (ascending).
    pub tab_order: i64,
    pub created_at: DateTime<Utc>,
    pub last_opened_at: Option<DateTime<Utc>>,
    /// Tab icon id (lucide icon name or emoji), if customized.
    #[serde(default)]
    pub icon: Option<String>,
    /// Tab accent color (hex like "#e0a82e"), if customized.
    #[serde(default)]
    pub color: Option<String>,
    /// Pinned tabs sort first and cannot be closed by accident.
    #[serde(default)]
    pub pinned: bool,
    /// Whether the project directory currently exists on disk.
    /// Computed on read; ignored on writes.
    #[serde(default)]
    pub path_exists: bool,
}

/// A recently closed project (candidate for the "Recent projects" menu).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_removed_at: DateTime<Utc>,
    /// Whether the folder still exists on disk (computed on read).
    pub path_exists: bool,
}

/// Project registry handle. Cheap to create; wraps a SQLite connection.
pub struct Registry {
    conn: Connection,
}

/// Default database path.
pub fn db_path() -> Result<PathBuf> {
    Ok(crate::config::config_dir()?.join("projects.db"))
}

/// Current schema version; bump together with a new `migrate()` step.
#[allow(dead_code)]
/// Upper bound for stored recent-projects entries (newest kept).
const RECENTS_CAP: i64 = 50;

const SCHEMA_VERSION: i64 = 5;

/// Valid kanban columns, in board order.
pub const TASK_STATUSES: &[&str] = &["backlog", "todo", "in_progress", "done"];

/// A kanban task (Tasks board, v0.4). Designed to be easy to hand off to an
/// AI agent: `title` + `description` together form the agent prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    /// Owning project, or `None` for workspace-global tasks.
    pub project_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    /// Kanban column: one of [`TASK_STATUSES`].
    pub status: String,
    /// Sort position within its column (ascending).
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn validate_status(status: &str) -> Result<()> {
    if TASK_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(Error::InvalidInput(format!(
            "invalid task status {status:?}; expected one of {TASK_STATUSES:?}"
        )))
    }
}

impl Registry {
    /// Open (and migrate) the registry at `path`. Parent dirs are created.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // Cheap, O(1) usability probe instead of a full-file `PRAGMA quick_check`
        // on *every* launch. quick_check scans the whole database file, so as
        // the registry grew (projects, tasks, notes, snippets, sessions…) it
        // added seconds to cold start. Reading the header via `schema_version`
        // still catches a garbage / non-database / truncated file — the common
        // corruption case — and triggers the same recover-and-recreate path
        // below; deep page-level corruption now surfaces lazily on the query
        // that hits it rather than penalising every healthy startup.
        let usable = conn
            .query_row("PRAGMA schema_version", [], |r| r.get::<_, i64>(0))
            .is_ok();
        if !usable {
            tracing::warn!("project registry is unreadable/corrupt; recreating");
            drop(conn);
            let backup = path.with_extension("sqlite.corrupt");
            let _ = std::fs::rename(path, &backup);
            let conn = Connection::open(path)?;
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            let mut registry = Self { conn };
            registry.migrate()?;
            return Ok(registry);
        }
        let mut registry = Self { conn };
        registry.migrate()?;
        Ok(registry)
    }

    /// In-memory registry (tests).
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let mut registry = Self { conn };
        registry.migrate()?;
        Ok(registry)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            self.conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    layout_preset_id TEXT,
                    favorite_commands TEXT NOT NULL DEFAULT '[]',
                    linked_executables TEXT NOT NULL DEFAULT '[]',
                    preferred_ide TEXT,
                    tab_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    last_opened_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_projects_tab_order ON projects(tab_order);
                PRAGMA user_version = 1;
                "#,
            )?;
        }
        if version < 2 {
            // v2: `path` becomes nullable so blank workspace tabs (no folder)
            // can coexist — SQLite treats NULLs as distinct under UNIQUE.
            // Existing data is preserved verbatim (project rule).
            self.conn.execute_batch(
                r#"
                CREATE TABLE projects_v2 (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT UNIQUE,
                    layout_preset_id TEXT,
                    favorite_commands TEXT NOT NULL DEFAULT '[]',
                    linked_executables TEXT NOT NULL DEFAULT '[]',
                    preferred_ide TEXT,
                    tab_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    last_opened_at TEXT
                );
                INSERT INTO projects_v2
                    SELECT id, name, path, layout_preset_id, favorite_commands,
                           linked_executables, preferred_ide, tab_order, created_at, last_opened_at
                    FROM projects;
                DROP TABLE projects;
                ALTER TABLE projects_v2 RENAME TO projects;
                CREATE INDEX IF NOT EXISTS idx_projects_tab_order ON projects(tab_order);
                PRAGMA user_version = 2;
                "#,
            )?;
        }
        if version < 3 {
            // v3: kanban tasks (Tasks board). Additive only — existing data
            // is never touched (project rule).
            self.conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'backlog',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(project_id, status, position);
                PRAGMA user_version = 3;
                "#,
            )?;
        }
        if version < 4 {
            // v4: recently closed projects ("Recent projects" menu). Additive
            // only — existing data is never touched (project rule).
            self.conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS recent_projects (
                    path TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    last_removed_at TEXT NOT NULL
                );
                PRAGMA user_version = 4;
                "#,
            )?;
        }
        if version < 5 {
            // v5: per-tab customization (icon, color, pinned). Additive only —
            // existing data is never touched (project rule).
            self.conn.execute_batch(
                r#"
                ALTER TABLE projects ADD COLUMN icon TEXT;
                ALTER TABLE projects ADD COLUMN color TEXT;
                ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
                PRAGMA user_version = 5;
                "#,
            )?;
        }
        // Sanity: migrations above must land exactly on the declared version.
        let now: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        debug_assert_eq!(
            now, SCHEMA_VERSION,
            "migrate() out of sync with SCHEMA_VERSION"
        );
        let _ = now;
        Ok(())
    }

    /// Register a new project. `name` defaults to the directory name.
    pub fn add(&self, path: &str, name: Option<String>) -> Result<Project> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(Error::InvalidInput("project path cannot be empty".into()));
        }
        let name = name.unwrap_or_else(|| {
            Path::new(trimmed)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| trimmed.to_string())
        });
        self.insert(trimmed, name)
    }

    /// Add a blank workspace tab that is not bound to any folder
    /// (`path` is empty; terminals there start in the user's home directory).
    pub fn add_blank(&self, name: Option<String>) -> Result<Project> {
        let name = match name.map(|n| n.trim().to_string()) {
            Some(n) if !n.is_empty() => n,
            _ => "Workspace".to_string(),
        };
        self.insert("", name)
    }

    fn insert(&self, trimmed: &str, name: String) -> Result<Project> {
        let next_order: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(tab_order), -1) + 1 FROM projects",
            [],
            |r| r.get(0),
        )?;
        let project = Project {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            path: trimmed.to_string(),
            layout_preset_id: None,
            favorite_commands: Vec::new(),
            linked_executables: Vec::new(),
            preferred_ide: None,
            tab_order: next_order,
            created_at: Utc::now(),
            last_opened_at: None,
            icon: None,
            color: None,
            pinned: false,
            path_exists: trimmed.is_empty() || Path::new(trimmed).is_dir(),
        };
        self.conn.execute(
            r#"INSERT INTO projects
               (id, name, path, layout_preset_id, favorite_commands, linked_executables,
                preferred_ide, tab_order, created_at, last_opened_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
            params![
                project.id,
                project.name,
                if project.path.is_empty() {
                    None
                } else {
                    Some(project.path.as_str())
                },
                project.layout_preset_id,
                serde_json::to_string(&project.favorite_commands)?,
                serde_json::to_string(&project.linked_executables)?,
                project.preferred_ide,
                project.tab_order,
                project.created_at.to_rfc3339(),
                Option::<String>::None,
            ],
        )?;
        Ok(project)
    }

    /// All projects ordered by tab position.
    pub fn list(&self) -> Result<Vec<Project>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, path, layout_preset_id, favorite_commands, linked_executables,
                    preferred_ide, tab_order, created_at, last_opened_at, icon, color, pinned
             FROM projects ORDER BY pinned DESC, tab_order ASC",
        )?;
        let rows = stmt.query_map([], row_to_project)?;
        let mut projects = Vec::new();
        for row in rows {
            projects.push(row?);
        }
        Ok(projects)
    }

    pub fn get(&self, id: &str) -> Result<Project> {
        self.conn
            .query_row(
                "SELECT id, name, path, layout_preset_id, favorite_commands, linked_executables,
                        preferred_ide, tab_order, created_at, last_opened_at, icon, color, pinned
                 FROM projects WHERE id = ?1",
                params![id],
                row_to_project,
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("project {id}")))
    }

    /// Update mutable fields of a project.
    pub fn update(&self, project: &Project) -> Result<()> {
        let changed = self.conn.execute(
            r#"UPDATE projects SET
                 name = ?2, path = ?3, layout_preset_id = ?4, favorite_commands = ?5,
                 linked_executables = ?6, preferred_ide = ?7, tab_order = ?8,
                 icon = ?9, color = ?10, pinned = ?11
               WHERE id = ?1"#,
            params![
                project.id,
                project.name,
                if project.path.is_empty() {
                    None
                } else {
                    Some(project.path.as_str())
                },
                project.layout_preset_id,
                serde_json::to_string(&project.favorite_commands)?,
                serde_json::to_string(&project.linked_executables)?,
                project.preferred_ide,
                project.tab_order,
                project.icon,
                project.color,
                project.pinned,
            ],
        )?;
        if changed == 0 {
            return Err(Error::NotFound(format!("project {}", project.id)));
        }
        Ok(())
    }

    /// Mark a project as opened now.
    pub fn touch_opened(&self, id: &str) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE projects SET last_opened_at = ?2 WHERE id = ?1",
            params![id, Utc::now().to_rfc3339()],
        )?;
        if changed == 0 {
            return Err(Error::NotFound(format!("project {id}")));
        }
        Ok(())
    }

    /// Persist a new tab ordering (list of project ids, first = leftmost).
    pub fn reorder(&mut self, ids: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE projects SET tab_order = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        // Remember folder-backed projects so the tab can be reopened from the
        // "Recent projects" menu (blank workspaces have nothing to restore).
        let recent: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT path, name FROM projects WHERE id = ?1 AND path IS NOT NULL",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let changed = self
            .conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(Error::NotFound(format!("project {id}")));
        }
        if let Some((path, name)) = recent {
            self.conn.execute(
                "INSERT INTO recent_projects (path, name, last_removed_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET name = ?2, last_removed_at = ?3",
                params![path, name, Utc::now().to_rfc3339()],
            )?;
            // Keep the table bounded: only the newest entries matter.
            self.conn.execute(
                "DELETE FROM recent_projects WHERE path NOT IN (
                    SELECT path FROM recent_projects ORDER BY last_removed_at DESC LIMIT ?1
                 )",
                params![RECENTS_CAP],
            )?;
        }
        Ok(())
    }

    /// Recently closed projects, newest first, excluding ones that are
    /// currently open as tabs. `limit = 0` returns everything.
    pub fn recent_list(&self, limit: usize) -> Result<Vec<RecentProject>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.path, r.name, r.last_removed_at FROM recent_projects r
             WHERE r.path NOT IN (SELECT path FROM projects WHERE path IS NOT NULL)
             ORDER BY r.last_removed_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (path, name, ts) = row?;
            out.push(RecentProject {
                path_exists: Path::new(&path).is_dir(),
                last_removed_at: DateTime::parse_from_rfc3339(&ts)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                path,
                name,
            });
            if limit > 0 && out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    /// Forget a recent-projects entry.
    pub fn recent_delete(&self, path: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM recent_projects WHERE path = ?1", params![path])?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Kanban tasks (Tasks board)
    // -----------------------------------------------------------------------

    /// All tasks on a board (one board per project; `None` = global board),
    /// ordered by column position.
    pub fn task_list(&self, project_id: Option<&str>) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, title, description, status, position, created_at, updated_at
             FROM tasks
             WHERE (?1 IS NULL AND project_id IS NULL) OR project_id = ?1
             ORDER BY status ASC, position ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_task)?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }
        Ok(tasks)
    }

    /// Create a task at the bottom of `status` (defaults to "backlog").
    pub fn task_add(
        &self,
        project_id: Option<&str>,
        title: &str,
        description: &str,
        status: Option<&str>,
    ) -> Result<Task> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Error::InvalidInput("task title cannot be empty".into()));
        }
        let status = status.unwrap_or("backlog");
        validate_status(status)?;
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks
             WHERE ((?1 IS NULL AND project_id IS NULL) OR project_id = ?1) AND status = ?2",
            params![project_id, status],
            |r| r.get(0),
        )?;
        let now = Utc::now();
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.map(str::to_string),
            title: title.to_string(),
            description: description.to_string(),
            status: status.to_string(),
            position,
            created_at: now,
            updated_at: now,
        };
        self.conn.execute(
            "INSERT INTO tasks (id, project_id, title, description, status, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                task.id,
                task.project_id,
                task.title,
                task.description,
                task.status,
                task.position,
                task.created_at.to_rfc3339(),
                task.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(task)
    }

    /// Update title/description/status of a task (position is managed via
    /// [`Registry::task_move`]).
    pub fn task_update(&self, task: &Task) -> Result<()> {
        if task.title.trim().is_empty() {
            return Err(Error::InvalidInput("task title cannot be empty".into()));
        }
        validate_status(&task.status)?;
        let changed = self.conn.execute(
            "UPDATE tasks SET title = ?2, description = ?3, status = ?4, updated_at = ?5
             WHERE id = ?1",
            params![
                task.id,
                task.title.trim(),
                task.description,
                task.status,
                Utc::now().to_rfc3339(),
            ],
        )?;
        if changed == 0 {
            return Err(Error::NotFound(format!("task {}", task.id)));
        }
        Ok(())
    }

    /// Move a task to `status` at `position` (drag & drop), shifting the
    /// other cards in the destination column down.
    pub fn task_move(&mut self, id: &str, status: &str, position: i64) -> Result<()> {
        validate_status(status)?;
        let position = position.max(0);
        let tx = self.conn.transaction()?;
        let project_id: Option<String> = tx
            .query_row(
                "SELECT project_id FROM tasks WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("task {id}")))?;
        tx.execute(
            "UPDATE tasks SET position = position + 1
             WHERE ((?1 IS NULL AND project_id IS NULL) OR project_id = ?1)
               AND status = ?2 AND position >= ?3 AND id != ?4",
            params![project_id, status, position, id],
        )?;
        tx.execute(
            "UPDATE tasks SET status = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, status, position, Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn task_delete(&self, id: &str) -> Result<()> {
        let changed = self
            .conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(Error::NotFound(format!("task {id}")));
        }
        Ok(())
    }
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    let favorite_commands: String = row.get(4)?;
    let linked_executables: String = row.get(5)?;
    let created_at: String = row.get(8)?;
    let last_opened_at: Option<String> = row.get(9)?;
    let path: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: path.clone(),
        layout_preset_id: row.get(3)?,
        favorite_commands: serde_json::from_str(&favorite_commands).unwrap_or_default(),
        linked_executables: serde_json::from_str(&linked_executables).unwrap_or_default(),
        preferred_ide: row.get(6)?,
        tab_order: row.get(7)?,
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        last_opened_at: last_opened_at
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
        icon: row.get(10)?,
        color: row.get(11)?,
        pinned: row.get::<_, i64>(12)? != 0,
        path_exists: path.is_empty() || std::path::Path::new(&path).is_dir(),
    })
}

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    let created_at: String = row.get(6)?;
    let updated_at: String = row.get(7)?;
    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        status: row.get(4)?,
        position: row.get(5)?,
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_workspaces_have_no_path() {
        let reg = Registry::open_in_memory().unwrap();
        let blank = reg.add_blank(None).unwrap();
        assert_eq!(blank.path, "");
        assert_eq!(blank.name, "Workspace");
        assert!(blank.path_exists, "blank tabs are never marked missing");
        let named = reg.add_blank(Some("Scratch".into())).unwrap();
        assert_eq!(named.name, "Scratch");
        let listed = reg.list().unwrap();
        assert!(listed.iter().all(|p| p.path_exists));
    }

    #[test]
    fn path_exists_reflects_disk_state() {
        let reg = Registry::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let real = reg
            .add(dir.path().to_str().unwrap(), Some("real".into()))
            .unwrap();
        assert!(real.path_exists);
        let ghost = reg.add("/definitely/not/a/real/path", None).unwrap();
        assert!(!ghost.path_exists);
        let listed = reg.list().unwrap();
        assert!(listed.iter().find(|p| p.id == real.id).unwrap().path_exists);
        assert!(
            !listed
                .iter()
                .find(|p| p.id == ghost.id)
                .unwrap()
                .path_exists
        );
    }

    #[test]
    fn add_list_get_update_remove() {
        let reg = Registry::open_in_memory().unwrap();
        let p1 = reg.add("/home/dev/alpha", None).unwrap();
        let p2 = reg.add("/home/dev/beta", Some("Beta!".into())).unwrap();
        assert_eq!(p1.name, "alpha");
        assert_eq!(p2.name, "Beta!");
        assert_eq!(p2.tab_order, 1);

        let mut got = reg.get(&p1.id).unwrap();
        got.favorite_commands.push("cargo test".into());
        got.preferred_ide = Some("zed".into());
        reg.update(&got).unwrap();
        assert_eq!(
            reg.get(&p1.id).unwrap().favorite_commands,
            vec!["cargo test"]
        );

        reg.remove(&p2.id).unwrap();
        assert_eq!(reg.list().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_path_rejected() {
        let reg = Registry::open_in_memory().unwrap();
        reg.add("/home/dev/alpha", None).unwrap();
        assert!(reg.add("/home/dev/alpha", None).is_err());
    }

    #[test]
    fn reorder_persists() {
        let mut reg = Registry::open_in_memory().unwrap();
        let a = reg.add("/p/a", None).unwrap();
        let b = reg.add("/p/b", None).unwrap();
        let c = reg.add("/p/c", None).unwrap();
        reg.reorder(&[c.id.clone(), a.id.clone(), b.id.clone()])
            .unwrap();
        let names: Vec<String> = reg.list().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["c", "a", "b"]);
    }

    #[test]
    fn touch_opened_sets_timestamp() {
        let reg = Registry::open_in_memory().unwrap();
        let p = reg.add("/p/x", None).unwrap();
        assert!(p.last_opened_at.is_none());
        reg.touch_opened(&p.id).unwrap();
        assert!(reg.get(&p.id).unwrap().last_opened_at.is_some());
    }

    #[test]
    fn remove_records_recent_and_reopen_clears_it() {
        let reg = Registry::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let p = reg.add(&path, Some("My proj".into())).unwrap();
        assert!(reg.recent_list(0).unwrap().is_empty());
        reg.remove(&p.id).unwrap();
        let recents = reg.recent_list(0).unwrap();
        assert_eq!(recents.len(), 1);
        assert_eq!(recents[0].path, path);
        assert_eq!(recents[0].name, "My proj");
        assert!(recents[0].path_exists);
        // Reopening the same folder hides it from the recents list.
        reg.add(&path, None).unwrap();
        assert!(reg.recent_list(0).unwrap().is_empty());
    }

    #[test]
    fn blank_workspaces_never_become_recents() {
        let reg = Registry::open_in_memory().unwrap();
        let p = reg.add_blank(None).unwrap();
        reg.remove(&p.id).unwrap();
        assert!(reg.recent_list(0).unwrap().is_empty());
    }

    #[test]
    fn recent_list_orders_limits_and_deletes() {
        let reg = Registry::open_in_memory().unwrap();
        let a = reg.add("/tmp/luxor-recent-a", None).unwrap();
        let b = reg.add("/tmp/luxor-recent-b", None).unwrap();
        reg.remove(&a.id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        reg.remove(&b.id).unwrap();
        let recents = reg.recent_list(0).unwrap();
        assert_eq!(recents.len(), 2);
        // Newest removal first.
        assert_eq!(recents[0].path, "/tmp/luxor-recent-b");
        assert!(!recents[0].path_exists);
        assert_eq!(reg.recent_list(1).unwrap().len(), 1);
        reg.recent_delete("/tmp/luxor-recent-b").unwrap();
        let recents = reg.recent_list(0).unwrap();
        assert_eq!(recents.len(), 1);
        assert_eq!(recents[0].path, "/tmp/luxor-recent-a");
    }

    #[test]
    fn recents_table_is_pruned_to_cap() {
        let reg = Registry::open_in_memory().unwrap();
        for i in 0..60 {
            let p = reg.add(&format!("/tmp/luxor-prune-{i}"), None).unwrap();
            reg.remove(&p.id).unwrap();
        }
        let recents = reg.recent_list(0).unwrap();
        assert!(recents.len() <= 50, "expected <= 50, got {}", recents.len());
        // The newest entry survives pruning.
        assert!(recents.iter().any(|r| r.path == "/tmp/luxor-prune-59"));
    }

    #[test]
    fn missing_project_is_not_found() {
        let reg = Registry::open_in_memory().unwrap();
        assert_eq!(reg.get("nope").unwrap_err().kind(), "not_found");
        assert_eq!(reg.remove("nope").unwrap_err().kind(), "not_found");
    }

    #[test]
    fn empty_path_rejected() {
        let reg = Registry::open_in_memory().unwrap();
        assert_eq!(reg.add("  ", None).unwrap_err().kind(), "invalid_input");
    }

    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("projects.db");
        {
            let reg = Registry::open(&db).unwrap();
            reg.add("/p/persist", None).unwrap();
        }
        let reg = Registry::open(&db).unwrap();
        assert_eq!(reg.list().unwrap().len(), 1);
    }

    // -- tasks ---------------------------------------------------------------

    #[test]
    fn task_add_appends_to_column_bottom() {
        let reg = Registry::open_in_memory().unwrap();
        let a = reg.task_add(None, "first", "", None).unwrap();
        let b = reg
            .task_add(None, "second", "desc", Some("backlog"))
            .unwrap();
        assert_eq!(a.position, 0);
        assert_eq!(b.position, 1);
        assert_eq!(a.status, "backlog");
        let tasks = reg.task_list(None).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "first");
    }

    #[test]
    fn task_boards_are_isolated_per_project() {
        let reg = Registry::open_in_memory().unwrap();
        let p = reg.add("/p/board", None).unwrap();
        reg.task_add(Some(&p.id), "project task", "", None).unwrap();
        reg.task_add(None, "global task", "", None).unwrap();
        assert_eq!(reg.task_list(Some(&p.id)).unwrap().len(), 1);
        assert_eq!(reg.task_list(None).unwrap().len(), 1);
        assert_eq!(reg.task_list(Some("other")).unwrap().len(), 0);
    }

    #[test]
    fn task_move_shifts_destination_column() {
        let mut reg = Registry::open_in_memory().unwrap();
        let a = reg.task_add(None, "a", "", Some("todo")).unwrap();
        let b = reg.task_add(None, "b", "", Some("todo")).unwrap();
        let c = reg.task_add(None, "c", "", Some("backlog")).unwrap();
        // Drop "c" between "a" and "b" in the todo column.
        reg.task_move(&c.id, "todo", 1).unwrap();
        let todo: Vec<String> = reg
            .task_list(None)
            .unwrap()
            .into_iter()
            .filter(|t| t.status == "todo")
            .map(|t| t.title)
            .collect();
        assert_eq!(todo, vec!["a", "c", "b"]);
        let _ = (a, b);
    }

    #[test]
    fn task_update_and_delete() {
        let reg = Registry::open_in_memory().unwrap();
        let mut t = reg.task_add(None, "before", "", None).unwrap();
        t.title = "after".into();
        t.status = "done".into();
        reg.task_update(&t).unwrap();
        let stored = &reg.task_list(None).unwrap()[0];
        assert_eq!(stored.title, "after");
        assert_eq!(stored.status, "done");
        reg.task_delete(&t.id).unwrap();
        assert!(reg.task_list(None).unwrap().is_empty());
        assert_eq!(reg.task_delete(&t.id).unwrap_err().kind(), "not_found");
    }

    #[test]
    fn task_rejects_bad_input() {
        let reg = Registry::open_in_memory().unwrap();
        assert_eq!(
            reg.task_add(None, "  ", "", None).unwrap_err().kind(),
            "invalid_input"
        );
        assert_eq!(
            reg.task_add(None, "x", "", Some("bogus"))
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }

    #[test]
    fn tasks_persist_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("projects.db");
        {
            let reg = Registry::open(&db).unwrap();
            reg.task_add(None, "persisted", "body", Some("in_progress"))
                .unwrap();
        }
        let reg = Registry::open(&db).unwrap();
        let tasks = reg.task_list(None).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "persisted");
        assert_eq!(tasks[0].status, "in_progress");
    }
}
