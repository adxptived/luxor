//! Process tree viewer: live process listing scoped to a root PID (usually a
//! terminal's shell) plus kill support for runaway processes.

use std::collections::HashMap;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::agents::descendants;
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
pub struct ProcessNode {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    /// Depth in the rendered tree (0 = root of the query).
    pub depth: usize,
}

/// Flattened process tree rooted at `root_pid` (depth-first order, `depth`
/// gives indentation). When `root_pid` is 0, returns the heaviest processes
/// system-wide (top 50 by CPU).
pub fn process_tree(root_pid: u32) -> Result<Vec<ProcessNode>> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let make_node = |sys: &System, pid: u32, depth: usize| -> Option<ProcessNode> {
        let proc = sys.process(Pid::from_u32(pid))?;
        let cmd: Vec<String> = proc
            .cmd()
            .iter()
            .map(|c| c.to_string_lossy().to_string())
            .collect();
        Some(ProcessNode {
            pid,
            parent: proc.parent().map(|p| p.as_u32()),
            name: proc.name().to_string_lossy().to_string(),
            cmd: cmd.join(" ").chars().take(300).collect(),
            cpu_percent: proc.cpu_usage(),
            memory_bytes: proc.memory(),
            depth,
        })
    };

    if root_pid == 0 {
        let mut nodes: Vec<ProcessNode> = sys
            .processes()
            .keys()
            .filter_map(|pid| make_node(&sys, pid.as_u32(), 0))
            .collect();
        nodes.sort_by(|a, b| {
            b.cpu_percent
                .partial_cmp(&a.cpu_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        nodes.truncate(50);
        return Ok(nodes);
    }

    // Build child edges, then DFS from the root for stable indentation.
    let mut edges: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, proc) in sys.processes() {
        if let Some(parent) = proc.parent() {
            edges.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }
    let mut out = Vec::new();
    let Some(root) = make_node(&sys, root_pid, 0) else {
        return Err(Error::NotFound(format!("process {root_pid}")));
    };
    out.push(root);
    let mut stack: Vec<(u32, usize)> = edges
        .get(&root_pid)
        .map(|kids| kids.iter().rev().map(|k| (*k, 1)).collect())
        .unwrap_or_default();
    while let Some((pid, depth)) = stack.pop() {
        if out.len() >= 500 {
            break;
        }
        if let Some(node) = make_node(&sys, pid, depth) {
            out.push(node);
        }
        if let Some(kids) = edges.get(&pid) {
            for kid in kids.iter().rev() {
                stack.push((*kid, depth + 1));
            }
        }
    }
    Ok(out)
}

/// A process is "gone" for our purposes if it is no longer listed, or is listed
/// only as a zombie/dead entry (terminated, awaiting reaping by its real
/// parent — which is not us, so it can linger in the table). Treating those as
/// dead is what makes the kill button reliable: a successful SIGKILL on an
/// agent owned by a shell leaves a short-lived zombie, and we must not report
/// that back as "still running".
fn process_alive(sys: &System, pid: u32) -> bool {
    match sys.process(Pid::from_u32(pid)) {
        None => false,
        Some(p) => !matches!(
            p.status(),
            sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead
        ),
    }
}

/// Build the ordered kill list (deepest descendant first, the target last) so
/// parents cannot respawn watchers while we work down the tree.
fn kill_targets(sys: &System, pid: u32, with_children: bool) -> Vec<u32> {
    if !with_children {
        return vec![pid];
    }
    let mut edges: HashMap<u32, Vec<u32>> = HashMap::new();
    for (p, proc) in sys.processes() {
        if let Some(parent) = proc.parent() {
            edges.entry(parent.as_u32()).or_default().push(p.as_u32());
        }
    }
    let mut kids = descendants(pid, &edges);
    kids.reverse();
    kids.push(pid);
    kids.dedup();
    kids
}

/// Kill a process (and optionally its whole subtree).
///
/// Unlike a naive single SIGKILL pass, this *verifies* the kill: after signaling
/// it re-reads the process table and, for anything still alive, signals a second
/// time. The return value counts processes that were actually terminated, and an
/// error is returned when the target survives — so the UI can surface a real
/// "couldn't stop it" message instead of optimistically hiding a row that then
/// reappears on the next poll (the classic "kill button does nothing" bug).
pub fn kill_process(pid: u32, with_children: bool) -> Result<usize> {
    if pid <= 1 {
        return Err(Error::InvalidInput("refusing to kill pid <= 1".into()));
    }
    if pid == std::process::id() {
        return Err(Error::InvalidInput("refusing to kill Luxor itself".into()));
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let targets = kill_targets(&sys, pid, with_children);
    let self_pid = std::process::id();

    // The target wasn't running to begin with.
    if !targets
        .iter()
        .any(|&t| sys.process(Pid::from_u32(t)).is_some())
    {
        return Err(Error::NotFound(format!("process {pid}")));
    }

    // First pass: SIGKILL the whole list (deepest first).
    for &target in &targets {
        if target == self_pid {
            continue;
        }
        if let Some(proc) = sys.process(Pid::from_u32(target)) {
            proc.kill();
        }
    }

    // Let the OS deliver the signals, then verify and retry survivors once.
    std::thread::sleep(std::time::Duration::from_millis(120));
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for &target in &targets {
        if target == self_pid {
            continue;
        }
        if process_alive(&sys, target) {
            if let Some(proc) = sys.process(Pid::from_u32(target)) {
                proc.kill();
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(80));
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let killed = targets
        .iter()
        .filter(|&&t| t != self_pid && !process_alive(&sys, t))
        .count();

    // The most important case: the process the user actually clicked is gone.
    if process_alive(&sys, pid) {
        return Err(Error::Process(format!(
            "could not stop process {pid} — it is still running (it may belong to another user or need elevated permissions)"
        )));
    }
    if killed == 0 {
        return Err(Error::NotFound(format!("process {pid}")));
    }
    Ok(killed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_process_tree_contains_self() {
        let pid = std::process::id();
        let tree = process_tree(pid).unwrap();
        assert_eq!(tree[0].pid, pid);
        assert_eq!(tree[0].depth, 0);
        assert!(!tree[0].name.is_empty());
    }

    #[test]
    fn top_processes_when_root_zero() {
        let list = process_tree(0).unwrap();
        assert!(!list.is_empty());
        assert!(list.len() <= 50);
    }

    #[test]
    fn kill_guards() {
        assert!(kill_process(0, false).is_err());
        assert!(kill_process(1, false).is_err());
        assert!(kill_process(std::process::id(), false).is_err());
    }

    #[test]
    fn kill_unknown_pid_is_not_found() {
        // A pid that is extremely unlikely to exist.
        let err = kill_process(4_000_000_000, false).unwrap_err();
        assert!(matches!(err, Error::NotFound(_)));
    }

    #[cfg(unix)]
    #[test]
    fn kill_terminates_a_real_child() {
        use std::process::Command;
        // Spawn a plain, long-lived child (no TTY needed, so this runs in CI).
        let mut child = Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep");
        let pid = child.id();

        let killed = kill_process(pid, true).expect("kill should succeed");
        assert!(killed >= 1, "expected at least one process terminated");

        // The verification loop guarantees it is actually gone.
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        assert!(!process_alive(&sys, pid), "child must be dead after kill");

        // Reap so we don't leak a zombie from the test itself.
        let _ = child.wait();
    }
}
