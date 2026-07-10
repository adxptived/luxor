//! Docker panel backend — thin wrapper around the `docker` CLI (works with
//! Docker Desktop, Podman's docker shim, Colima, …). No socket dependency.

use std::process::Command;

use serde::Serialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

fn docker_cmd() -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new("docker");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn run_docker(args: &[&str]) -> Result<String> {
    let output = docker_cmd()
        .args(args)
        .output()
        .map_err(|e| Error::Launcher(format!("docker CLI not found: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(Error::Launcher(if err.is_empty() {
            format!("docker {} failed", args.first().unwrap_or(&""))
        } else {
            err
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Docker CLI version, or None when docker is not installed/running.
pub fn version() -> Option<String> {
    run_docker(&["version", "--format", "{{.Client.Version}}"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Parse one-per-line `docker … --format '{{json .}}'` output.
fn parse_json_lines(raw: &str) -> Vec<serde_json::Value> {
    raw.lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
        .collect()
}

fn s(v: &serde_json::Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

pub fn containers(all: bool) -> Result<Vec<DockerContainer>> {
    let mut args = vec!["ps", "--format", "{{json .}}"];
    if all {
        args.push("--all");
    }
    let raw = run_docker(&args)?;
    Ok(parse_json_lines(&raw)
        .iter()
        .map(|v| DockerContainer {
            id: s(v, "ID"),
            name: s(v, "Names"),
            image: s(v, "Image"),
            state: s(v, "State"),
            status: s(v, "Status"),
            ports: s(v, "Ports"),
        })
        .collect())
}

pub fn images() -> Result<Vec<DockerImage>> {
    let raw = run_docker(&["images", "--format", "{{json .}}"])?;
    Ok(parse_json_lines(&raw)
        .iter()
        .map(|v| DockerImage {
            id: s(v, "ID"),
            repository: s(v, "Repository"),
            tag: s(v, "Tag"),
            size: s(v, "Size"),
            created: s(v, "CreatedSince"),
        })
        .collect())
}

pub fn logs(container_id: &str, tail: usize) -> Result<String> {
    validate_id(container_id)?;
    let tail_str = tail.clamp(10, 5000).to_string();
    // docker logs writes to both stdout and stderr; capture both.
    let output = docker_cmd()
        .args(["logs", "--tail", &tail_str, container_id])
        .output()
        .map_err(|e| Error::Launcher(format!("docker CLI not found: {e}")))?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() && text.trim().is_empty() {
        return Err(Error::Launcher("docker logs failed".into()));
    }
    Ok(text)
}

/// Run a command inside a running container (`docker exec`). The command is
/// tokenized by whitespace and passed as an args ARRAY — no shell involved,
/// so there is no interpolation/injection surface (same policy as the rest of
/// this module). Combined stdout+stderr is returned so error output from the
/// in-container command is visible in the panel.
pub fn exec(container_id: &str, command: &str) -> Result<String> {
    validate_id(container_id)?;
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err(Error::InvalidInput("empty exec command".into()));
    }
    let output = docker_cmd()
        .arg("exec")
        .arg(container_id)
        .args(&parts)
        .output()
        .map_err(|e| Error::Launcher(format!("docker CLI not found: {e}")))?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() && text.trim().is_empty() {
        return Err(Error::Launcher(format!(
            "docker exec failed (status {})",
            output.status
        )));
    }
    Ok(text)
}

/// `action`: start | stop | restart | rm. Image removal uses `rmi`.
pub fn container_action(container_id: &str, action: &str) -> Result<()> {
    validate_id(container_id)?;
    match action {
        "start" | "stop" | "restart" | "rm" | "rmi" => {
            run_docker(&[action, container_id])?;
            Ok(())
        }
        other => Err(Error::InvalidInput(format!(
            "unknown docker action: {other}"
        ))),
    }
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || !id.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == '/' || c == ':'
        })
    {
        return Err(Error::InvalidInput(format!("invalid docker id: {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_lines_parse() {
        let raw = "{\"ID\":\"abc\",\"Names\":\"web\",\"Image\":\"nginx\",\"State\":\"running\",\"Status\":\"Up 2 hours\",\"Ports\":\"80/tcp\"}\nnot json\n{\"ID\":\"def\",\"Names\":\"db\",\"Image\":\"postgres\",\"State\":\"exited\",\"Status\":\"Exited\",\"Ports\":\"\"}";
        let values = parse_json_lines(raw);
        assert_eq!(values.len(), 2);
        assert_eq!(s(&values[0], "Names"), "web");
        assert_eq!(s(&values[1], "Image"), "postgres");
    }

    #[test]
    fn id_validation() {
        assert!(validate_id("abc123").is_ok());
        assert!(validate_id("my-container_1").is_ok());
        assert!(validate_id("nginx:latest").is_ok());
        assert!(validate_id("bad id; rm -rf /").is_err());
        assert!(validate_id("").is_err());
        assert!(container_action("abc", "explode").is_err());
    }
}
