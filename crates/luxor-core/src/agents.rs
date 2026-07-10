//! Detection of running AI CLI agents (Claude Code, Codex, Gemini CLI, …)
//! and per-process-tree resource usage for terminals.
//!
//! The matcher is pure (testable); [`AgentSampler`] owns a `sysinfo::System`
//! and should be reused between samples so CPU percentages are meaningful.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Known AI coding agents: `(binary stem, id, label)`. The stem is compared
/// case-insensitively against the process name (and against script arguments
/// when the process is an interpreter such as `node` or `python`).
///
/// Keep this list current — see <https://github.com/> ecosystem trackers and
/// the project CHANGELOG for the source of new entries.
pub const KNOWN_AGENTS: &[(&str, &str, &str)] = &[
    // Frontier-lab terminals
    ("devin", "devin", "Devin"),
    ("hermes", "hermes", "Hermes"),
    ("claude", "claude", "Claude Code"),
    ("codex", "codex", "Codex CLI"),
    ("gemini", "gemini", "Gemini CLI"),
    ("copilot", "copilot", "Copilot CLI"),
    ("grok", "grok", "Grok CLI"),
    ("kimi", "kimi", "Kimi CLI"),
    // Provider-agnostic / open-source harnesses
    ("opencode", "opencode", "OpenCode"),
    ("openhands", "openhands", "OpenHands"),
    ("cline", "cline", "Cline"),
    ("roo", "roo", "Roo Code"),
    ("goose", "goose", "Goose"),
    ("crush", "crush", "Crush"),
    ("pi", "pi", "Pi"),
    ("continue", "continue", "Continue"),
    ("gptme", "gptme", "gptme"),
    ("cody", "cody", "Cody"),
    ("sgpt", "shell-gpt", "Shell-GPT"),
    // Vendor / commercial CLIs
    ("amp", "amp", "Amp"),
    ("cursor-agent", "cursor-agent", "Cursor Agent"),
    ("droid", "droid", "Factory Droid"),
    ("auggie", "auggie", "Augment CLI"),
    ("rovodev", "rovodev", "Rovo Dev"),
    ("codebuff", "codebuff", "Codebuff"),
    ("qodo", "qodo", "Qodo Command"),
    ("qoder", "qoder", "Qoder CLI"),
    ("qodercli", "qoder", "Qoder CLI"),
    ("kilocode", "kilocode", "Kilo Code"),
    // New / 2025 agents
    ("tabby", "tabby", "Tabby"),
    ("windsurf", "windsurf", "Windsurf"),
    ("windsurf-agent", "windsurf", "Windsurf"),
    ("trae", "trae", "Trae"),
    ("trae-agent", "trae", "Trae"),
    ("gemini-cli", "gemini", "Gemini CLI"),
    ("deepseek-coder", "deepseek-coder", "DeepSeek Coder"),
    // Git-native / classic tools
    ("aider", "aider", "Aider"),
    ("plandex", "plandex", "Plandex"),
    ("pdx", "plandex", "Plandex"),
];

/// Package-path hints: when an agent is launched via an interpreter as
/// `node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js`, the script
/// file (`cli.js`/`index.js`/`dist/main.js`) carries no agent name. We then
/// scan every argument for a known package-path substring (compared
/// lowercase). Each maps to an id present in [`KNOWN_AGENTS`].
const PKG_HINTS: &[(&str, &str)] = &[
    ("devin", "devin"),
    ("devin-cli", "devin"),
    ("hermes-agent", "hermes"),
    ("hermes", "hermes"),
    ("claude-code", "claude"),
    ("@anthropic-ai/claude", "claude"),
    ("@openai/codex", "codex"),
    ("openai/codex", "codex"),
    ("gemini-cli", "gemini"),
    ("@google/gemini", "gemini"),
    ("@github/copilot", "copilot"),
    ("copilot-cli", "copilot"),
    ("opencode-ai", "opencode"),
    ("all-hands-ai", "openhands"),
    ("openhands", "openhands"),
    ("@continuedev", "continue"),
    ("@sourcegraph/cody", "cody"),
    ("cody-agent", "cody"),
    ("@augmentcode", "auggie"),
    ("@qodo", "qodo"),
    // Qoder ships its CLI as `qodercli`, sometimes launched via node from its
    // package dir, so match the package path too (not just the binary stem).
    ("@qoder", "qoder"),
    ("qodercli", "qoder"),
    ("qoder-cli", "qoder"),
    ("kilo-code", "kilocode"),
    ("kilocode", "kilocode"),
    ("roo-cline", "roo"),
    ("roo-code", "roo"),
    ("cursor-agent", "cursor-agent"),
    // New package-path hints for 2025 agents
    ("@tabbyml", "tabby"),
    ("tabby-ml", "tabby"),
    ("@windsurf", "windsurf"),
    ("windsurf-code", "windsurf"),
    ("@trae", "trae"),
    ("trae-ai", "trae"),
    ("@deepseek", "deepseek-coder"),
    ("deepseek-coder", "deepseek-coder"),
    // Git-native / classic tools
    ("aider", "aider"),
    ("plandex-ai", "plandex"),
    ("plandex", "plandex"),
];

/// Interpreters whose first script/package argument decides what is actually
/// running. Includes package runners (`npx`, `bunx`, `uvx`, `pnpm dlx`, …) so
/// `npx @openai/codex` and `uvx aider` are detected too.
const INTERPRETERS: &[&str] = &[
    "node",
    "node.exe",
    "bun",
    "bun.exe",
    "deno",
    "deno.exe",
    "python",
    "python3",
    "python.exe",
    "uv",
    "uvx",
    "npx",
    "npx.exe",
    "bunx",
    "pnpm",
    "yarn",
    "npm",
    "npm.exe",
    "pipx",
    "pipx.exe",
];

/// One detected agent kind, aggregated over all of its processes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AgentInfo {
    /// Stable id (e.g. `claude`).
    pub id: String,
    /// Human-readable name (e.g. `Claude Code`).
    pub label: String,
    /// Number of matching processes.
    pub count: u32,
    /// Sum of per-process CPU usage (100 = one full core).
    pub cpu_percent: f32,
    /// Sum of resident memory in bytes.
    pub mem_bytes: u64,
}

/// Resource usage of a process and all of its descendants (a terminal tab).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TreeStats {
    pub root_pid: u32,
    /// Number of live processes in the tree (including the root).
    pub processes: u32,
    /// Sum of CPU usage over the tree (100 = one full core).
    pub cpu_percent: f32,
    /// Sum of resident memory in bytes.
    pub mem_bytes: u64,
    /// Labels of known AI agents detected inside the tree (deduped, sorted),
    /// e.g. `["Claude Code"]` — lets the terminal show "agent working" UI.
    pub agents: Vec<String>,
}

/// One detected agent process (detail rows for the Agents panel).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AgentProcess {
    /// Stable agent id (e.g. `claude`).
    pub id: String,
    /// Human-readable agent name (e.g. `Claude Code`).
    pub label: String,
    pub pid: u32,
    /// CPU usage of this process (100 = one full core).
    pub cpu_percent: f32,
    /// Resident memory in bytes.
    pub mem_bytes: u64,
    /// Seconds since the process started.
    pub run_secs: u64,
    /// Working directory the agent runs in ("where") — empty when unknown.
    pub cwd: String,
    /// Parent process id (the shell/terminal that launched it), when known.
    pub parent_pid: Option<u32>,
    /// Heuristic "actively working" flag: CPU above [`BUSY_CPU_PERCENT`].
    pub busy: bool,
    /// Abbreviated command line (for tooltips).
    pub cmd: String,
}

/// CPU usage (100 = one full core) above which an agent is considered to be
/// actively working rather than idle/waiting for input.
pub const BUSY_CPU_PERCENT: f32 = 4.0;

/// Strip directories and a trailing `.exe`/`.cmd`/`.bat`/`.ps1`/`.js`/`.mjs`
/// extension: `/usr/bin/CLAUDE.exe` → `claude`.
fn stem(s: &str) -> String {
    let name = s.rsplit(['/', '\\']).next().unwrap_or(s);
    let lower = name.to_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".ps1", ".js", ".mjs", ".py"] {
        if let Some(stripped) = lower.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    lower
}

/// Look up an agent by binary stem (e.g. `claude`).
fn lookup(stem: &str) -> Option<(&'static str, &'static str)> {
    KNOWN_AGENTS
        .iter()
        .find(|(s, _, _)| *s == stem)
        .map(|(_, id, label)| (*id, *label))
}

/// Look up an agent by stable id (e.g. `claude`), returning `(id, label)`.
fn lookup_id(id: &str) -> Option<(&'static str, &'static str)> {
    KNOWN_AGENTS
        .iter()
        .find(|(_, i, _)| *i == id)
        .map(|(_, id, label)| (*id, *label))
}

/// Scan every argument for a known package-path substring (lowercased). This
/// catches agents launched as `node /.../@vendor/agent-cli/dist/main.js`.
fn match_pkg_hint(cmd: &[String]) -> Option<(&'static str, &'static str)> {
    for arg in cmd {
        let lower = arg.to_lowercase();
        for (needle, id) in PKG_HINTS {
            if lower.contains(needle) {
                if let Some(hit) = lookup_id(id) {
                    return Some(hit);
                }
            }
        }
    }
    None
}

/// Match a process (name + command line) to a known agent, in three stages:
///
/// 1. the process name itself is a known binary (`claude`, `codex`, …);
/// 2. it is an interpreter/package-runner (`node`, `npx`, `uvx`, …) whose
///    first non-flag argument is a known binary/package (`npx @openai/codex`);
/// 3. any argument contains a known package-path substring
///    (`node /.../@anthropic-ai/claude-code/cli.js`).
pub fn match_agent(name: &str, cmd: &[String]) -> Option<(&'static str, &'static str)> {
    let n = stem(name);
    if let Some(hit) = lookup(&n) {
        return Some(hit);
    }
    if INTERPRETERS.contains(&n.as_str()) {
        // Scan a generous window of args: real invocations often carry several
        // interpreter flags (`node --max-old-space-size=… --enable-source-maps
        // …/cli.js`) or runner flags (`uv run --directory … aider`) before the
        // script/package that actually names the agent.
        for arg in cmd.iter().skip(1).take(10) {
            if arg.starts_with('-') {
                continue;
            }
            if let Some(hit) = lookup(&stem(arg)) {
                return Some(hit);
            }
            // `pnpm dlx <pkg>` / `npm exec <pkg>` etc.: skip the subcommand.
            if matches!(arg.as_str(), "dlx" | "exec" | "run" | "x" | "tool") {
                continue;
            }
        }
    }
    match_pkg_hint(cmd)
}

/// Aggregate raw process rows `(name, cmd, cpu_percent, mem_bytes)` into one
/// [`AgentInfo`] per detected agent, sorted by label.
pub fn aggregate_agents<I>(procs: I) -> Vec<AgentInfo>
where
    I: IntoIterator<Item = (String, Vec<String>, f32, u64)>,
{
    let mut by_id: BTreeMap<&'static str, AgentInfo> = BTreeMap::new();
    for (name, cmd, cpu, mem) in procs {
        let Some((id, label)) = match_agent(&name, &cmd) else {
            continue;
        };
        let entry = by_id.entry(id).or_insert_with(|| AgentInfo {
            id: id.to_string(),
            label: label.to_string(),
            count: 0,
            cpu_percent: 0.0,
            mem_bytes: 0,
        });
        entry.count += 1;
        entry.cpu_percent += cpu.max(0.0);
        entry.mem_bytes = entry.mem_bytes.saturating_add(mem);
    }
    let mut out: Vec<AgentInfo> = by_id.into_values().collect();
    out.sort_by(|a, b| a.label.cmp(&b.label));
    out
}

/// All pids reachable from `root` in the parent→children `edges` map,
/// including `root` itself. Cycle-safe.
pub fn descendants(root: u32, edges: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut queue: VecDeque<u32> = VecDeque::from([root]);
    let mut out = Vec::new();
    while let Some(pid) = queue.pop_front() {
        if !seen.insert(pid) {
            continue;
        }
        out.push(pid);
        if let Some(children) = edges.get(&pid) {
            queue.extend(children.iter().copied());
        }
    }
    out
}

/// Walk up the parent chain from `start` (using a pid→parent map) and return
/// the working directory of the nearest ancestor that owns a Luxor PTY shell
/// session (`pty_dirs`: shell pid → cwd).
///
/// This is how the Agents panel recovers a "working directory" on platforms
/// where the OS hides a process's own cwd (notably Windows, where sysinfo
/// cannot read `cwd()` for processes it doesn't own): if the agent was started
/// inside a Luxor terminal, it is a descendant of that terminal's shell, so we
/// inherit the shell's directory. Cycle/own-parent safe with a depth guard.
pub fn pty_cwd_for(
    start: u32,
    parents: &HashMap<u32, u32>,
    pty_dirs: &HashMap<u32, String>,
) -> Option<String> {
    if pty_dirs.is_empty() {
        return None;
    }
    let mut cur = start;
    let mut seen: HashSet<u32> = HashSet::new();
    for _ in 0..256 {
        if let Some(dir) = pty_dirs.get(&cur) {
            return Some(dir.clone());
        }
        if !seen.insert(cur) {
            break; // cycle
        }
        match parents.get(&cur) {
            Some(&p) if p != cur => cur = p,
            _ => break,
        }
    }
    None
}

/// Stateful process sampler. Keep one instance alive: per-process CPU usage
/// is a delta between consecutive refreshes.
pub struct AgentSampler {
    sys: System,
}

impl Default for AgentSampler {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentSampler {
    pub fn new() -> Self {
        Self { sys: System::new() }
    }

    fn refresh(&mut self) {
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
    }

    /// Detect running AI agents, aggregated per agent kind.
    pub fn agents(&mut self) -> Vec<AgentInfo> {
        self.refresh();
        aggregate_agents(self.sys.processes().values().map(|p| {
            (
                p.name().to_string_lossy().to_string(),
                p.cmd()
                    .iter()
                    .map(|c| c.to_string_lossy().to_string())
                    .collect::<Vec<_>>(),
                p.cpu_usage(),
                p.memory(),
            )
        }))
    }

    /// Detail rows for every running agent process (the Agents panel).
    ///
    /// `pty_dirs` maps a Luxor PTY shell's pid to its working directory; agents
    /// whose own cwd is hidden by the OS inherit the directory of the nearest
    /// ancestor terminal (see [`pty_cwd_for`]). Pass an empty map to disable.
    pub fn agent_processes(&mut self, pty_dirs: &HashMap<u32, String>) -> Vec<AgentProcess> {
        self.refresh();
        // pid → parent pid, used to climb from an agent to its owning terminal.
        let parents: HashMap<u32, u32> = self
            .sys
            .processes()
            .iter()
            .filter_map(|(pid, p)| p.parent().map(|pp| (pid.as_u32(), pp.as_u32())))
            .collect();
        let mut out: Vec<AgentProcess> = self
            .sys
            .processes()
            .iter()
            .filter_map(|(pid, p)| {
                let name = p.name().to_string_lossy().to_string();
                let cmd: Vec<String> = p
                    .cmd()
                    .iter()
                    .map(|c| c.to_string_lossy().to_string())
                    .collect();
                let (id, label) = match_agent(&name, &cmd)?;
                let mut cmd_preview = cmd.join(" ");
                if cmd_preview.is_empty() {
                    cmd_preview = name;
                }
                if cmd_preview.len() > 160 {
                    cmd_preview.truncate(160);
                    cmd_preview.push('…');
                }
                let cpu = p.cpu_usage().max(0.0);
                // Prefer the process's own cwd; when the OS hides it, inherit
                // from the Luxor terminal that launched the agent.
                let own_cwd = p
                    .cwd()
                    .map(|c| c.to_string_lossy().to_string())
                    .filter(|s| !s.is_empty());
                let cwd = own_cwd
                    .or_else(|| pty_cwd_for(pid.as_u32(), &parents, pty_dirs))
                    .unwrap_or_default();
                Some(AgentProcess {
                    id: id.to_string(),
                    label: label.to_string(),
                    pid: pid.as_u32(),
                    cpu_percent: cpu,
                    mem_bytes: p.memory(),
                    run_secs: p.run_time(),
                    cwd,
                    parent_pid: p.parent().map(|pp| pp.as_u32()),
                    busy: cpu >= BUSY_CPU_PERCENT,
                    cmd: cmd_preview,
                })
            })
            .collect();
        out.sort_by(|a, b| a.label.cmp(&b.label).then(a.pid.cmp(&b.pid)));
        out
    }

    /// Resource usage for the process tree rooted at `root_pid` (a terminal's
    /// shell and everything it spawned). `None` when the root is gone.
    pub fn tree_stats(&mut self, root_pid: u32) -> Option<TreeStats> {
        self.refresh();
        if !self.sys.processes().contains_key(&Pid::from_u32(root_pid)) {
            return None;
        }
        let mut edges: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, proc_) in self.sys.processes() {
            if let Some(parent) = proc_.parent() {
                edges.entry(parent.as_u32()).or_default().push(pid.as_u32());
            }
        }
        let mut stats = TreeStats {
            root_pid,
            processes: 0,
            cpu_percent: 0.0,
            mem_bytes: 0,
            agents: Vec::new(),
        };
        for pid in descendants(root_pid, &edges) {
            if let Some(p) = self.sys.process(Pid::from_u32(pid)) {
                stats.processes += 1;
                stats.cpu_percent += p.cpu_usage().max(0.0);
                stats.mem_bytes = stats.mem_bytes.saturating_add(p.memory());
                let name = p.name().to_string_lossy().to_string();
                let cmd: Vec<String> = p
                    .cmd()
                    .iter()
                    .map(|c| c.to_string_lossy().to_string())
                    .collect();
                if let Some((_, label)) = match_agent(&name, &cmd) {
                    if !stats.agents.iter().any(|a| a == label) {
                        stats.agents.push(label.to_string());
                    }
                }
            }
        }
        stats.agents.sort();
        Some(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn matches_plain_binaries_case_insensitively() {
        assert_eq!(
            match_agent("claude", &cmd(&["claude"])),
            Some(("claude", "Claude Code"))
        );
        assert_eq!(
            match_agent("CODEX.exe", &cmd(&["CODEX.exe", "--full-auto"])),
            Some(("codex", "Codex CLI"))
        );
        assert_eq!(match_agent("vim", &cmd(&["vim"])), None);
    }

    #[test]
    fn matches_interpreter_scripts() {
        assert_eq!(
            match_agent(
                "node",
                &cmd(&[
                    "node",
                    "/usr/lib/node_modules/@google/gemini-cli/dist/gemini.js"
                ])
            ),
            Some(("gemini", "Gemini CLI"))
        );
        // Flags before the script path are skipped.
        assert_eq!(
            match_agent(
                "node",
                &cmd(&["node", "--max-old-space-size=8192", "C:\\npm\\claude.js"])
            ),
            Some(("claude", "Claude Code"))
        );
        // A random node script is not an agent.
        assert_eq!(match_agent("node", &cmd(&["node", "server.js"])), None);
    }

    #[test]
    fn interpreter_itself_never_matches_directly() {
        // `python` is an interpreter, not an agent — even with no args.
        assert_eq!(match_agent("python3", &cmd(&["python3"])), None);
    }

    #[test]
    fn aggregates_processes_per_agent() {
        let rows = vec![
            ("claude".into(), cmd(&["claude"]), 12.0, 100),
            ("claude".into(), cmd(&["claude"]), 8.0, 50),
            ("gemini".into(), cmd(&["gemini"]), 1.0, 10),
            ("bash".into(), cmd(&["bash"]), 99.0, 999),
        ];
        let agents = aggregate_agents(rows);
        assert_eq!(agents.len(), 2);
        let claude = agents.iter().find(|a| a.id == "claude").unwrap();
        assert_eq!(claude.count, 2);
        assert!((claude.cpu_percent - 20.0).abs() < 0.001);
        assert_eq!(claude.mem_bytes, 150);
        assert_eq!(agents.iter().find(|a| a.id == "bash"), None);
    }

    #[test]
    fn known_agents_have_unique_stems_and_ids() {
        let mut stems: Vec<&str> = KNOWN_AGENTS.iter().map(|(s, _, _)| *s).collect();
        stems.sort();
        stems.dedup();
        assert_eq!(stems.len(), KNOWN_AGENTS.len());
    }

    #[test]
    fn descendants_walks_the_tree_and_survives_cycles() {
        let mut edges: HashMap<u32, Vec<u32>> = HashMap::new();
        edges.insert(1, vec![2, 3]);
        edges.insert(2, vec![4]);
        edges.insert(4, vec![1]); // cycle back to the root
        let mut pids = descendants(1, &edges);
        pids.sort();
        assert_eq!(pids, vec![1, 2, 3, 4]);
        assert_eq!(descendants(99, &HashMap::new()), vec![99]);
    }

    #[test]
    fn pty_cwd_for_inherits_from_nearest_terminal_ancestor() {
        // agent(40) → node(30) → shell(20) → luxor(10); shell owns a PTY.
        let mut parents: HashMap<u32, u32> = HashMap::new();
        parents.insert(40, 30);
        parents.insert(30, 20);
        parents.insert(20, 10);
        let mut pty_dirs: HashMap<u32, String> = HashMap::new();
        pty_dirs.insert(20, "/home/me/project".to_string());
        assert_eq!(
            pty_cwd_for(40, &parents, &pty_dirs).as_deref(),
            Some("/home/me/project"),
        );
        // No terminal in the ancestry → None.
        assert_eq!(pty_cwd_for(40, &parents, &HashMap::new()), None);
        let mut other: HashMap<u32, String> = HashMap::new();
        other.insert(999, "/nope".to_string());
        assert_eq!(pty_cwd_for(40, &parents, &other), None);
    }

    #[test]
    fn pty_cwd_for_survives_parent_cycles() {
        let mut parents: HashMap<u32, u32> = HashMap::new();
        parents.insert(1, 2);
        parents.insert(2, 1); // cycle, no PTY anywhere
        assert_eq!(
            pty_cwd_for(1, &parents, &{
                let mut m = HashMap::new();
                m.insert(7u32, "/x".to_string());
                m
            }),
            None
        );
    }

    #[test]
    fn sampler_smoke_test() {
        let mut sampler = AgentSampler::new();
        let _ = sampler.agents(); // must not panic
        let _ = sampler.agent_processes(&HashMap::new()); // must not panic
                                                          // The current test process definitely exists and has >= 1 process.
        let me = std::process::id();
        let stats = sampler.tree_stats(me).expect("own process tree");
        assert!(stats.processes >= 1);
        assert_eq!(stats.root_pid, me);
        assert_eq!(sampler.tree_stats(u32::MAX - 7), None);
    }

    #[test]
    fn qodercli_and_new_agents_are_known() {
        assert_eq!(
            match_agent("qodercli.exe", &cmd(&["qodercli.exe"])),
            Some(("qoder", "Qoder CLI"))
        );
        assert_eq!(
            match_agent("qoder", &cmd(&["qoder", "chat"])),
            Some(("qoder", "Qoder CLI"))
        );
        assert_eq!(
            match_agent("node", &cmd(&["node", "C:\\npm\\kilocode.js"])),
            Some(("kilocode", "Kilo Code"))
        );
    }

    #[test]
    fn newly_added_agents_are_detected() {
        for (bin, id, label) in [
            ("opencode", "opencode", "OpenCode"),
            ("openhands", "openhands", "OpenHands"),
            ("cline", "cline", "Cline"),
            ("plandex", "plandex", "Plandex"),
            ("pdx", "plandex", "Plandex"),
            ("cody", "cody", "Cody"),
            ("gptme", "gptme", "gptme"),
            ("sgpt", "shell-gpt", "Shell-GPT"),
        ] {
            assert_eq!(match_agent(bin, &cmd(&[bin])), Some((id, label)), "{bin}");
        }
    }

    #[test]
    fn package_runners_match_first_package_arg() {
        // npx / uvx / bunx style launches.
        assert_eq!(
            match_agent("npx", &cmd(&["npx", "@openai/codex"])),
            Some(("codex", "Codex CLI"))
        );
        assert_eq!(
            match_agent("uvx", &cmd(&["uvx", "aider"])),
            Some(("aider", "Aider"))
        );
        // `pnpm dlx <pkg>` — the `dlx` subcommand is skipped.
        assert_eq!(
            match_agent("pnpm", &cmd(&["pnpm", "dlx", "opencode"])),
            Some(("opencode", "OpenCode"))
        );
    }

    #[test]
    fn package_path_hints_match_when_script_name_is_generic() {
        // The classic `node /.../@vendor/agent/cli.js` form: the script file is
        // a generic `cli.js`, so we fall back to the package-path hint.
        assert_eq!(
            match_agent(
                "node",
                &cmd(&[
                    "node",
                    "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js",
                ])
            ),
            Some(("claude", "Claude Code"))
        );
        assert_eq!(
            match_agent(
                "node",
                &cmd(&[
                    "node",
                    "/home/u/.npm/_npx/abc/node_modules/opencode-ai/dist/index.js"
                ])
            ),
            Some(("opencode", "OpenCode"))
        );
        assert_eq!(
            match_agent(
                "python3",
                &cmd(&["python3", "/opt/all-hands-ai/openhands/cli/main.py"])
            ),
            Some(("openhands", "OpenHands"))
        );
        // No hint, no match.
        assert_eq!(
            match_agent("node", &cmd(&["node", "/srv/app/server.js"])),
            None
        );
    }

    #[test]
    fn pkg_hints_reference_real_agent_ids() {
        for (_, id) in PKG_HINTS {
            assert!(
                lookup_id(id).is_some(),
                "pkg hint id `{id}` not in KNOWN_AGENTS"
            );
        }
    }
}
