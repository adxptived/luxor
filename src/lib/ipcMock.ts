/**
 * In-memory mock backend for browser/dev mode (no Tauri shell).
 *
 * Extracted from `ipc.ts`, where 654 lines of fixtures sat inline in the module
 * that also defines the production IPC surface. Besides the obvious readability
 * win, the split lets `invoke()` pull this in with a dynamic `import()`, so the
 * fixtures are no longer bundled into the desktop build that can never run them.
 *
 * `mockInvoke` is the single entry point; it mirrors the Rust command names.
 */

import { logsAsText } from "./logBuffer";
import type {
  AppConfig,
  LayoutPreset,
  MarketSkill,
  Project,
  SkillEntry,
  Task,
} from "./types";

const mockState = {
  config: null as AppConfig | null,
  projects: [] as Project[],
  presets: [] as LayoutPreset[],
  tasks: [
    {
      id: "mock-task-1",
      project_id: null,
      title: "Wire up the deploy script",
      description: "Add a `deploy` task to the launcher and document it in README.",
      status: "backlog",
      position: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "mock-task-2",
      project_id: null,
      title: "Fix flaky terminal resize",
      description: "",
      status: "in_progress",
      position: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ] as Task[],
};

let MOCK_SKILLS: SkillEntry[] = [
  {
    convention: "claude",
    name: "pdf-tools",
    path: "/mock/.claude/skills/pdf-tools",
    skill_md: "/mock/.claude/skills/pdf-tools/SKILL.md",
    is_dir: true,
    size: 1240,
    enabled: true,
    content_hash: "aaaaaaaaaaaaaaaa",
  },
  {
    convention: "codex",
    name: "code-review",
    path: "/mock/.codex/skills/code-review.md",
    skill_md: "/mock/.codex/skills/code-review.md",
    is_dir: false,
    size: 480,
    enabled: true,
    content_hash: "bbbbbbbbbbbbbbbb",
  },
  {
    convention: "agents",
    name: "pdf-tools",
    path: "/mock/.agents/skills/pdf-tools",
    skill_md: "/mock/.agents/skills/pdf-tools/SKILL.md",
    is_dir: true,
    size: 1240,
    enabled: false,
    content_hash: "aaaaaaaaaaaaaaaa",
  },
];

const MOCK_MARKET: MarketSkill[] = [
  {
    source: "vercel-labs/skills",
    skill_id: "find-skills",
    name: "find-skills",
    installs: 1967841,
    is_official: true,
    url: "https://skills.sh/vercel-labs/skills/find-skills",
  },
  {
    source: "anthropics/skills",
    skill_id: "frontend-design",
    name: "frontend-design",
    installs: 530372,
    is_official: true,
    url: "https://skills.sh/anthropics/skills/frontend-design",
  },
];

function defaultMockConfig(): AppConfig {
  return {
    theme: "dark",
    tab_bar_position: "top",
    accent_color: "#e8b059",
    confirm_destructive: true,
    terminal: {
      shell: null,
      external_terminal: null,
      shell_args: [],
      fast_powershell_startup: true,
      font_family: "Cascadia Mono, JetBrains Mono, Consolas, monospace",
      font_size: 14,
      scrollback: 10000,
      webgl: true,
      cursor_style: "block",
      cursor_blink: true,
      copy_on_select: false,
      bell_notifications: true,
      show_stats: true,
    },
    git: {
      diff_view: "side_by_side",
      auto_refresh_secs: 5,
    },
    hotkeys: [],
    preferred_editors: ["code", "zed"],
    ui: {
      topbar_size: 36,
      sidebar_width: 208,
      left_sidebar_collapsed: false,
      left_sidebar_open: true,
      chrome_actions: [],
      left_sidebar_icon_position: "top",
      tab_radius: 7,
      tab_outline: false,
      quick_actions: "top",
      nav_order: [],
      nav_hidden: [],
      nav_sidebar: [],
      nav_chrome: [],
      nav_topbar_left: [],
      nav_topbar_center: [],
      browser_enabled: false,
      zoom: 1,
      close_to_tray: true,
      editor_theme: "luxor-dark",
      side_panel_enabled: false,
      side_panel_widgets: [],
      side_panel_width: 260,
      right_panel_enabled: false,
      right_panel_widgets: [],
      right_panel_width: 280,
      right_panel_embed: "",
      right_panel_config: "",
      ui_font: "",
      mono_font: "",
      ui_font_scale: 100,
      editor_minimap: false,
      editor_autosave: false,
      language: "en",
      update_repo: "adxptived/luxor",
      update_check: true,
      plus_menu_hidden: [],
      allow_second_window: false,
      launch_on_startup: false,
      tray: {
        show_projects: true,
        show_new_terminal: true,
        show_new_window: false,
        show_settings: true,
        show_close_to_tray: true,
      },
      glass_enabled: true,
      glass_opacity: 20,
      diagnostics_tab: false,
    },
    notifications: {
      enabled: true,
      os_native: true,
      command_done: true,
      min_command_secs: 10,
      agent_done: true,
    },
    status_bar: {
      show_project: true,
      show_git: true,
      show_cpu: true,
      show_ram: true,
      show_net: false,
      show_ping: false,
      show_clock: false,
      show_zoom: false,
      show_tasks: false,
      show_timer: true,
      show_agents: true,
      ping_host: "1.1.1.1:443",
      refresh_secs: 2,
      segment_order: [],
    },
    custom_ides: [],
    default_ide: null,
  };
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const a = (args ?? {}) as Record<string, never>;
  switch (cmd) {
    case "config_get":
      return (mockState.config ??= defaultMockConfig()) as T;
    case "config_set":
      mockState.config = a["config"];
      return undefined as T;
    case "project_list":
      // Return a snapshot — handing out the live array lets callers alias
      // internal state (caused duplicate project tabs in dev mode).
      return [...mockState.projects] as T;
    case "project_add": {
      const path = a["path"] as string;
      const project: Project = {
        id: `mock-${Date.now()}`,
        name: (a["name"] as string | null) ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path,
        path,
        layout_preset_id: null,
        favorite_commands: [],
        linked_executables: [],
        preferred_ide: null,
        tab_order: mockState.projects.length,
        path_exists: true,
        created_at: new Date().toISOString(),
        last_opened_at: null,
        icon: null,
        color: null,
        pinned: false,
      };
      mockState.projects.push(project);
      return project as T;
    }
    case "project_add_blank": {
      const project: Project = {
        id: `mock-blank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: (a["name"] as string | null) ?? "Blank workspace",
        path: "",
        layout_preset_id: null,
        favorite_commands: [],
        linked_executables: [],
        preferred_ide: null,
        tab_order: mockState.projects.length,
        path_exists: true,
        created_at: new Date().toISOString(),
        last_opened_at: null,
        icon: null,
        color: null,
        pinned: false,
      };
      mockState.projects.push(project);
      return project as T;
    }
    case "project_remove":
      mockState.projects = mockState.projects.filter((p) => p.id !== a["id"]);
      return undefined as T;
    case "project_update": {
      const project = a["project"] as Project;
      mockState.projects = mockState.projects.map((p) => (p.id === project.id ? project : p));
      return undefined as T;
    }
    case "project_reorder":
    case "project_touch":
      return undefined as T;
    case "task_list": {
      const pid = (a["projectId"] as string | null) ?? null;
      return mockState.tasks
        .filter((t) => t.project_id === pid)
        .sort((x, y) => x.status.localeCompare(y.status) || x.position - y.position) as T;
    }
    case "task_add": {
      const status = (a["status"] as string | null) ?? "backlog";
      const pid = (a["projectId"] as string | null) ?? null;
      const peers = mockState.tasks.filter((t) => t.project_id === pid && t.status === status);
      const task: Task = {
        id: `mock-task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        project_id: pid,
        title: a["title"] as string,
        description: (a["description"] as string | null) ?? "",
        status,
        position: peers.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockState.tasks.push(task);
      return task as T;
    }
    case "task_update": {
      const task = a["task"] as Task;
      mockState.tasks = mockState.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t));
      return undefined as T;
    }
    case "task_move": {
      const id = a["id"] as string;
      const status = a["status"] as string;
      const position = a["position"] as number;
      const task = mockState.tasks.find((t) => t.id === id);
      if (task) {
        for (const t of mockState.tasks) {
          if (t.id !== id && t.project_id === task.project_id && t.status === status && t.position >= position) {
            t.position += 1;
          }
        }
        task.status = status;
        task.position = position;
      }
      return undefined as T;
    }
    case "task_delete":
      mockState.tasks = mockState.tasks.filter((t) => t.id !== a["id"]);
      return undefined as T;
    case "skills_scan":
      return MOCK_SKILLS as T;
    case "skills_copy": {
      const path = a["skillPath"] as string;
      const src = MOCK_SKILLS.find((s) => s.path === path) ?? MOCK_SKILLS[0];
      return { ...src, convention: a["toConvention"] as string } as T;
    }
    case "skills_import":
      return {
        convention: a["convention"] as string,
        name: a["name"] as string,
        path: `/mock/.${a["convention"]}/skills/${a["name"]}`,
        skill_md: `/mock/.${a["convention"]}/skills/${a["name"]}/SKILL.md`,
        is_dir: true,
        size: (a["content"] as string).length,
        enabled: true,
        content_hash: "cccccccccccccccc",
      } as T;
    case "skills_set_enabled": {
      const path = a["skillPath"] as string;
      const enabled = a["enabled"] as boolean;
      const next = enabled
        ? path.replace(/\.disabled$/, "")
        : path.endsWith(".disabled")
          ? path
          : `${path}.disabled`;
      MOCK_SKILLS = MOCK_SKILLS.map((sk) =>
        sk.path === path ? { ...sk, enabled, path: next } : sk,
      );
      return next as T;
    }
    case "skills_remove":
      MOCK_SKILLS = MOCK_SKILLS.filter((sk) => sk.path !== a["skillPath"]);
      return undefined as T;
    case "skills_global_root":
      return "/home/mock" as T;
    case "recent_list":
      return [
        {
          path: "/home/mock/old-project",
          name: "old-project",
          last_removed_at: new Date().toISOString(),
          path_exists: true,
        },
      ] as T;
    case "recent_delete":
      return undefined as T;
    case "pty_detect_shells":
      return [
        { command: "/bin/bash", label: "System default (/bin/bash)" },
        { command: "zsh", label: "Zsh" },
      ] as T;
    case "launcher_detect_terminals":
      return [
        { command: "gnome-terminal", label: "GNOME Terminal" },
        { command: "alacritty", label: "Alacritty" },
      ] as T;
    case "market_catalog":
      return MOCK_MARKET as T;
    case "market_search": {
      const q = String(a["query"] ?? "").toLowerCase().trim();
      if (!q) return [] as T;
      return MOCK_MARKET.filter(
        (s) => s.name.toLowerCase().includes(q) || s.source.toLowerCase().includes(q),
      ) as T;
    }
    case "market_skill_md":
      return `# ${a["skillId"]}\n\nMock SKILL.md fetched from ${a["source"]}.` as T;
    case "layout_list":
      return mockState.presets as T;
    case "layout_save": {
      const preset = a["preset"] as LayoutPreset;
      mockState.presets = [...mockState.presets.filter((p) => p.id !== preset.id), preset];
      return preset as T;
    }
    case "layout_delete":
      mockState.presets = mockState.presets.filter((p) => p.id !== a["id"]);
      return undefined as T;
    case "pty_spawn":
      return { session_id: `mock-${Date.now()}`, shell: "mock-shell", cwd: null, pid: 4242 } as T;
    case "pty_write":
    case "pty_resize":
    case "pty_kill":
      return undefined as T;
    case "pty_list":
      return [] as T;
    case "git_status":
      return {
        branch: "main",
        head_detached: false,
        ahead: 1,
        behind: 0,
        entries: [
          { path: "src/components/TopBar.tsx", staged: null, unstaged: "modified" },
          { path: "src/panels/DiffPanel.tsx", staged: null, unstaged: "modified" },
          { path: "src/components/NavRail.tsx", staged: "new", unstaged: null },
        ],
      } as T;
    case "git_file_diff":
      return {
        path: String(a["filePath"] ?? "src/components/TopBar.tsx"),
        binary: false,
        old_content: [
          "export function Toolbar() {",
          "  return (",
          '    <div className="topbar">',
          '      <button className="icon">←</button>',
          '      <button className="icon">→</button>',
          '      <button className="settings">Settings</button>',
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
        new_content: [
          "export function Toolbar() {",
          "  return (",
          '    <div className="topbar topbar--clean">',
          '      <button className="square" title="New panel">□</button>',
          '      <button className="square" title="Left sidebar">▣</button>',
          '      <button className="square" title="Right sidebar">▢</button>',
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
      } as T;
    case "git_blame":
      return {
        hunks: [
          { start_line: 1, lines: 1, commit_id: "a".repeat(40), short_id: "aaaaaaa", author: "Ada Lovelace", time: 1718000000, summary: "Initial commit", },
          { start_line: 2, lines: 2, commit_id: "b".repeat(40), short_id: "bbbbbbb", author: "Grace Hopper", time: 1750000000, summary: "Fix the flux capacitor", },
        ],
        lines: ["# Mock file", "", "Browser dev mode."],
        truncated: false,
      } as T;
    case "git_last_commit_message":
      return null as T;
    case "git_discover_root":
      // Any project folder counts as a repo in mock mode so the Git panel
      // (incl. the blame tab) is explorable in the browser.
      return (a["path"] ?? null) as T;
    // NOTE: `project_add_blank` is handled earlier in this same switch; a second
    // case here was unreachable (Vite flagged the duplicate) and has been removed.
    case "fs_list_dir":
      return [
        { name: "src", path: "/mock/src", is_dir: true, size: 0, modified: null },
        { name: "README.md", path: "/mock/README.md", is_dir: false, size: 1240, modified: null },
      ] as T;
    case "fs_search":
      return [
        { name: "README.md", path: "/mock/README.md", is_dir: false, size: 1240, modified: null },
        { name: "main.tsx", path: "/mock/src/main.tsx", is_dir: false, size: 2048, modified: null },
      ] as T;
    case "fs_read_text":
      return { content: "# Mock file\n\nBrowser dev mode.", truncated: false } as T;
    case "fs_write_text":
    case "fs_create_file":
    case "fs_create_dir":
    case "fs_rename":
    case "fs_copy":
    case "fs_delete":
      return undefined as T;
    case "fs_read_base64":
      return "" as T;
    case "db_tables":
      return [{ name: "items", rows: 2 }] as T;
    case "db_rows":
      return {
        columns: ["id", "name"],
        rows: [["1", "first"], ["2", "second"]],
        total: 2,
        rowids: [1, 2],
        editable: true,
      } as T;
    case "db_table_info":
      return {
        name: "items",
        columns: [
          { name: "id", decl_type: "INTEGER", notnull: true, pk: true, dflt: null },
          { name: "name", decl_type: "TEXT", notnull: false, pk: false, dflt: null },
        ],
        row_count: 2,
        has_rowid: true,
        create_sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
        indexes: [],
      } as T;
    case "db_update_cell":
    case "db_insert_row":
    case "db_delete_rows":
      return (cmd === "db_update_cell" ? undefined : 1) as T;
    case "stats_sample":
      return {
        cpu_percent: 12 + Math.random() * 20,
        mem_used: 8.2 * 1024 ** 3,
        mem_total: 16 * 1024 ** 3,
        net_rx_bps: Math.random() * 300_000,
        net_tx_bps: Math.random() * 60_000,
      } as T;
    case "stats_ping":
      return Math.round(10 + Math.random() * 30) as T;
    case "agents_sample":
      return [
        { id: "claude", label: "Claude Code", count: 2, cpu_percent: 14.5, mem_bytes: 512 * 1024 ** 2 },
        { id: "codex", label: "Codex CLI", count: 1, cpu_percent: 3.2, mem_bytes: 256 * 1024 ** 2 },
      ] as T;
    case "pty_tree_stats":
      return { root_pid: 4242, processes: 3, cpu_percent: 2.5, mem_bytes: 86 * 1024 ** 2, agents: [] } as T;
    case "agents_processes":
      return [
        { id: "claude", label: "Claude Code", pid: 1111, cpu_percent: 18.5, mem_bytes: 512 * 1024 ** 2, run_secs: 322, cwd: "/Users/dev/projects/luxor", parent_pid: 4242, busy: true, cmd: "claude --dangerously-skip-permissions" },
        { id: "claude", label: "Claude Code", pid: 1133, cpu_percent: 0.4, mem_bytes: 318 * 1024 ** 2, run_secs: 1290, cwd: "/Users/dev/projects/aeterna", parent_pid: 4310, busy: false, cmd: "claude" },
        { id: "codex", label: "Codex CLI", pid: 2222, cpu_percent: 3.2, mem_bytes: 256 * 1024 ** 2, run_secs: 64, cwd: "/Users/dev/projects/luxor/crates", parent_pid: 4242, busy: false, cmd: "codex exec" },
        { id: "opencode", label: "OpenCode", pid: 3333, cpu_percent: 7.1, mem_bytes: 180 * 1024 ** 2, run_secs: 410, cwd: "/Users/dev/work/api", parent_pid: 5001, busy: true, cmd: "node /usr/lib/node_modules/opencode-ai/dist/index.js" },
      ] as T;
    case "window_open_new":
    case "tray_set_projects":
    case "tray_popup_fit":
      return undefined as T;
    case "tray_popup_hide_if_cursor_outside":
      return false as T;
    case "cli_poll_requests":
      return [] as T;
    case "window_ready":
      return undefined as T;
    case "git_log":
    case "git_file_history":
    case "git_branches":
    case "git_stash_list":
    case "git_commit_files":
      return [] as T;
    case "git_commit_stats":
      return { files_changed: 0, insertions: 0, deletions: 0 } as T;
    case "launcher_detect_ides":
      return [{ command: "code", label: "VS Code" }] as T;
    case "launcher_open_default_app":
      return undefined as T;
    case "launcher_find_executables":
      return [] as T;
    case "git_token_exists":
      return false as T;
    case "git_tags":
      return [
        { name: "v0.5.0", target_id: "a".repeat(40), short_target: "aaaaaaa", message: "release", annotated: true },
      ] as T;
    case "git_reflog":
    case "git_submodules":
    case "git_conflict_paths":
    case "search_in_project":
      return (cmd === "search_in_project"
        ? { hits: [], files_scanned: 0, truncated: false }
        : []) as T;
    case "replace_in_project":
      return { files_changed: 0, replacements: 0 } as T;
    case "git_stage":
    case "git_unstage":
    case "git_discard":
    case "git_commit":
    case "git_branch_create":
    case "git_branch_checkout":
    case "git_branch_delete":
    case "git_stash_save":
    case "git_stash_apply":
    case "git_stash_pop":
    case "git_stash_drop":
    case "git_fetch":
    case "git_pull":
    case "git_push":
    case "git_token_set":
    case "git_token_delete":
    case "git_tag_create":
    case "git_tag_delete":
    case "git_push_tag":
    case "git_submodule_update":
    case "git_conflict_resolve":
    case "note_set":
    case "snippet_delete":
    case "bookmark_delete":
    case "session_delete":
    case "docker_action":
      return undefined as T;
    case "fs_write_text_encoded":
      // Mirrors `fs_write_text`: the command returns the file's new mtime.
      return Date.now() as T;
    case "git_cherry_pick":
      return "b".repeat(40) as T;
    case "git_conflict_sides":
      return { path: "src/a.ts", base: "base", ours: "ours", theirs: "theirs", current: "<<<<<<<" } as T;
    case "db_query":
      return { columns: ["result"], rows: [["ok"]], total: 1 } as T;
    case "fs_encodings":
      return ["utf-8", "utf-16le", "windows-1251"] as T;
    case "fs_detect_encoding":
      return "utf-8" as T;
    case "fs_read_text_encoded":
      return { content: "mock content", truncated: false } as T;
    case "env_files":
    case "log_files":
    case "dep_manifests":
    case "snippet_list":
    case "bookmark_list":
    case "session_list":
    case "registry_search":
    case "osv_check":
    case "docker_containers":
    case "docker_images":
    case "crash_list":
    case "github_issues":
    case "github_issue_comments":
    case "github_pulls":
    case "github_runs":
      return [] as T;
    case "frontend_log":
      return undefined as T;
    case "frontend_log_read":
      // No Rust log file in the browser/dev build — serve the live buffer.
      return logsAsText() as T;
    case "frontend_log_clear":
    case "open_log_folder":
      return undefined as T;
    case "diag_collect":
      return `Luxor diagnostics report (browser mock)\n\n--- Frontend log (session) ---\n${logsAsText()}\n` as T;
    case "github_repo":
      return null as T;
    case "github_comment_add":
      return undefined as T;
    case "update_check":
      return {
        current: "0.6.0", latest: "0.6.0", update_available: false, name: "",
        notes: "", published_at: "", html_url: "", assets: [],
      } as T;
    case "disk_usage":
      return { total_bytes: 123 * 1024 ** 2, dirs: [{ path: "node_modules", bytes: 100 * 1024 ** 2, cleanable: true }] } as T;
    case "note_get":
      return "" as T;
    case "snippet_save":
      return { ...(args?.snippet as object), id: "mock-id", created_at: "", updated_at: "" } as T;
    case "bookmark_toggle":
      return { id: "mock-bm", project_id: null, file: String(args?.file ?? ""), line: Number(args?.line ?? 0), note: "", created_at: "" } as T;
    case "session_save":
      return { id: "mock-session", project_id: null, name: String(args?.name ?? ""), data: String(args?.data ?? "{}"), created_at: "" } as T;
    case "http_request":
      return { status: 200, status_text: "OK", headers: [], body: "{}", truncated: false, elapsed_ms: 12 } as T;
    case "latest_versions":
      return {} as T;
    case "docker_version":
      return null as T;
    case "docker_logs":
    case "log_tail":
    case "crash_read":
      return "" as T;
    case "process_tree":
      return [{ pid: 4242, parent: null, name: "zsh", cmd: "zsh", cpu_percent: 0.5, memory_bytes: 12 * 1024 ** 2, depth: 0 }] as T;
    case "process_kill":
      return 1 as T;
    default:
      throw new Error(`mock: command not available in browser: ${cmd}`);
  }
}
