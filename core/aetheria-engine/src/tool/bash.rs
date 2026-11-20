//! Workspace Shell Execution Tool — mirrors OpenCode `packages/core/src/tool/plugin/shell.ts`.
//! Runs Python/OpenCV/FFmpeg/Node/Rust/verification commands inside the isolated workspace with:
//! - Consistent shell per platform (PowerShell on Windows with UTF-8 encoding, `/bin/sh` on Unix)
//! - Persistent per-session scratch directory (`.aetheria/scratch/<session>`) across calls
//!   (lazily pruned after 24h TTL so multi-step scripts never lose intermediate files!)
//! - Configurable `timeout` (ms) with process-tree cleanup & cooperative user interrupt support.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use super::resolve_isolated_path;
use crate::session::message::emit_event;

const DEFAULT_BASH_TIMEOUT_MS: u64 = 120_000;
const MAX_BASH_TIMEOUT_MS: u64 = 300_000;
const SCRATCH_TTL_SECS: u64 = 24 * 60 * 60;

pub(crate) const SENSITIVE_ENV_VARS: &[&str] = &[
    "AETHERIA_SERVER_PASSWORD",
    "AETHERIA_SERVER_USERNAME",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "QWEN_API_KEY",
    "DASHSCOPE_API_KEY",
];

fn sanitize_session_segment(session_id: &str) -> String {
    let clean: String = session_id
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if clean.is_empty() {
        "default".to_string()
    } else {
        clean
    }
}

pub(crate) fn validate_bash_command(command: &str) -> Result<(), String> {
    let lower = command.to_lowercase();
    let forbidden_patterns = [
        ("dev-server-password", "Reading engine server credentials is blocked."),
        (".aetheria/credentials", "Reading credential storage is blocked."),
        (".aetheria\\credentials", "Reading credential storage is blocked."),
        ("aetheria_server_password", "Accessing server password env var is blocked."),
        ("diskpart", "Host disk management commands are blocked."),
        ("reg delete", "Modifying Windows registry hives is blocked."),
        ("rm -rf /", "Root filesystem deletion is blocked."),
        ("del /s /q c:\\", "System drive deletion is blocked."),
        ("rd /s /q c:\\", "System drive deletion is blocked."),
        ("format c:", "Formatting host drives is blocked."),
    ];
    for (pat, reason) in forbidden_patterns {
        if lower.contains(pat) {
            return Err(format!("Blocked unsafe shell command: {}", reason));
        }
    }
    Ok(())
}

static SESSION_CWD_MAP: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn session_cwd_store() -> &'static Mutex<HashMap<String, PathBuf>> {
    SESSION_CWD_MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired_scratch_dirs(scratch_root: &Path, active_segment: &str) {
    let Ok(rd) = std::fs::read_dir(scratch_root) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(SCRATCH_TTL_SECS))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == active_segment {
            continue;
        }
        let path = entry.path();
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                }
            }
        }
    }
}

pub fn bash_tool_definition() -> Value {
    let shell_label = if cfg!(windows) {
        "PowerShell (powershell.exe on Windows, UTF-8 output)"
    } else {
        "/bin/sh on Unix"
    };
    let description = format!(
        "{}\n\nRuntime environment: OS={} | Shell={}. Session scratch files in `.aetheria/scratch/` persist across bash calls within the same session.",
        include_str!("prompt/bash.txt").trim(),
        std::env::consts::OS,
        shell_label
    );
    json!({
        "type": "function",
        "function": {
            "name": "bash",
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute inside the active project workspace (e.g. Python/OpenCV pixel inspection, FFmpeg/FFprobe, Node.js, or validation utility)."
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Relative working directory inside workspace. Defaults to workspace root '.'."
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Optional command timeout in milliseconds (default 120000, max 300000)."
                    }
                },
                "required": ["command"]
            }
        }
    })
}

pub async fn execute_bash(
    session_id: &str,
    workspace_dir: &str,
    arguments: &Value,
) -> Value {
    let command = arguments
        .get("command")
        .or_else(|| arguments.get("cmd"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if command.is_empty() {
        return json!({ "ok": false, "error": "Command is required" });
    }
    if let Err(err) = validate_bash_command(command) {
        return json!({ "ok": false, "error": err });
    }

    let timeout_ms = arguments
        .get("timeout")
        .or_else(|| arguments.get("timeoutMs"))
        .and_then(|v| v.as_u64())
        .map(|n| n.clamp(1_000, MAX_BASH_TIMEOUT_MS))
        .unwrap_or(DEFAULT_BASH_TIMEOUT_MS);

    // Isolate scratch directory per session and KEEP IT ALIVE across calls in the same session
    // so multi-step Python/OpenCV scripts and intermediate files survive between tool calls.
    let seg = sanitize_session_segment(session_id);
    let scratch_root = Path::new(workspace_dir).join(".aetheria").join("scratch");
    let scratch_dir = scratch_root.join(&seg);
    if crate::paths::contains_path(Path::new(workspace_dir), &scratch_dir) {
        let _ = tokio::fs::create_dir_all(&scratch_dir).await;
        prune_expired_scratch_dirs(&scratch_root, &seg);
    }

    // Determine working directory (strictly inside workspace; persists across session bash calls)
    let workdir = if let Some(wd) = arguments.get("workdir").and_then(|v| v.as_str()) {
        match resolve_isolated_path(workspace_dir, wd) {
            Ok(p) => {
                session_cwd_store()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(session_id.to_string(), p.clone());
                p
            }
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    } else {
        session_cwd_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .cloned()
            .filter(|p| p.exists() && crate::paths::contains_path(Path::new(workspace_dir), p))
            .unwrap_or_else(|| PathBuf::from(workspace_dir))
    };

    let cmd_str = command.to_string();
    let cwd = workdir.clone();
    let session_id_owned = session_id.to_string();
    let workspace_dir_owned = workspace_dir.to_string();
    let interrupt_rx = crate::session::coordinator::subscribe_session_interrupt(session_id);

    let res = run_interruptible_shell(&cmd_str, &cwd, &scratch_dir, timeout_ms, &interrupt_rx).await;

    match res {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            let combined_output = if !stdout.is_empty() && !stderr.is_empty() {
                format!("{}\n\n[stderr]\n{}", stdout, stderr)
            } else if !stdout.is_empty() {
                stdout.clone()
            } else if !stderr.is_empty() {
                stderr.clone()
            } else {
                "(no output)".to_string()
            };

            emit_event(
                &workspace_dir_owned,
                "command.executed",
                json!({
                    "command": command,
                    "exitCode": exit_code,
                    "sessionID": session_id_owned
                }),
            );

            let rel_cwd = cwd
                .strip_prefix(Path::new(workspace_dir))
                .map(|p| {
                    let s = p.to_string_lossy().replace('\\', "/");
                    if s.is_empty() { ".".to_string() } else { s }
                })
                .unwrap_or_else(|_| ".".to_string());

            json!({
                "ok": output.status.success(),
                "exitCode": exit_code,
                "cwd": rel_cwd,
                "stdout": stdout,
                "stderr": stderr,
                "output": combined_output
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => json!({
            "ok": false,
            "aborted": true,
            "error": "Command execution aborted by user"
        }),
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => json!({
            "ok": false,
            "timedOut": true,
            "error": format!("Command timed out after {}ms. Pass a higher `timeout` (up to 300000ms) or simplify the command.", timeout_ms)
        }),
        Err(e) => json!({ "ok": false, "error": format!("Failed to execute command: {}", e) }),
    }
}

fn kill_child_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .output();
    }
}

fn build_augmented_path(
    current_path: Option<&std::ffi::OsStr>,
    extra_dirs: &[PathBuf],
) -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = extra_dirs
        .iter()
        .filter(|d| !d.as_os_str().is_empty())
        .cloned()
        .collect();
    if let Some(existing) = current_path {
        for p in std::env::split_paths(existing) {
            if !dirs.contains(&p) {
                dirs.push(p);
            }
        }
    }
    if dirs.is_empty() {
        return None;
    }
    std::env::join_paths(dirs).ok()
}

async fn run_command_with_interrupt(
    program: &str,
    args: &[String],
    cwd: &Path,
    scratch_dir: &Path,
    timeout_ms: u64,
    interrupt_rx: &tokio::sync::watch::Receiver<bool>,
) -> std::io::Result<std::process::Output> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.current_dir(cwd);
    let mut extra_path_dirs = vec![crate::paths::aetheria_dot_dir().join("bin")];
    if let Some(ff) = crate::paths::locate_ffmpeg_binary() {
        if let Some(parent) = ff.parent() {
            extra_path_dirs.insert(0, parent.to_path_buf());
        }
    }
    if let Some(merged_path) =
        build_augmented_path(std::env::var_os("PATH").as_deref(), &extra_path_dirs)
    {
        cmd.env("PATH", merged_path);
    }
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    cmd.env("AETHERIA_SCRATCH_DIR", scratch_dir);
    for key in SENSITIVE_ENV_VARS {
        cmd.env_remove(key);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    let child = cmd.spawn()?;
    let pid = child.id();

    tokio::select! {
        biased;
        _ = crate::session::coordinator::wait_session_interrupt(interrupt_rx.clone()) => {
            kill_child_process_tree(pid);
            Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Command aborted by user"))
        }
        _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => {
            kill_child_process_tree(pid);
            Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Command timed out"))
        }
        res = child.wait_with_output() => res,
    }
}

async fn run_interruptible_shell(
    cmd_str: &str,
    cwd: &Path,
    scratch_dir: &Path,
    timeout_ms: u64,
    interrupt_rx: &tokio::sync::watch::Receiver<bool>,
) -> std::io::Result<std::process::Output> {
    if *interrupt_rx.borrow() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "Command aborted by user",
        ));
    }

    if cfg!(windows) {
        // Consistent UTF-8 PowerShell execution on Windows (eliminates cmd.exe quoting/piping drift).
        let wrapped = format!(
            "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n{}",
            cmd_str
        );
        let args = vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-Command".to_string(),
            wrapped,
        ];
        run_command_with_interrupt(
            "powershell.exe",
            &args,
            cwd,
            scratch_dir,
            timeout_ms,
            interrupt_rx,
        )
        .await
    } else {
        let args = vec!["-c".to_string(), cmd_str.to_string()];
        run_command_with_interrupt("/bin/sh", &args, cwd, scratch_dir, timeout_ms, interrupt_rx)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn augmented_path_prepends_ffmpeg_dir_without_duplicates() {
        let bin_dir = PathBuf::from(if cfg!(windows) {
            r"C:\tools\ffmpeg\bin"
        } else {
            "/opt/ffmpeg/bin"
        });
        let sys_dir = PathBuf::from(if cfg!(windows) {
            r"C:\Windows\System32"
        } else {
            "/usr/bin"
        });
        let existing =
            std::env::join_paths([sys_dir.clone(), bin_dir.clone()]).expect("join paths");
        let merged =
            build_augmented_path(Some(&existing), &[bin_dir.clone()]).expect("merged path");
        let parts: Vec<PathBuf> = std::env::split_paths(&merged).collect();
        assert_eq!(parts[0], bin_dir);
        assert_eq!(parts[1], sys_dir);
        assert_eq!(parts.iter().filter(|p| **p == bin_dir).count(), 1);
    }

    #[tokio::test]
    async fn execute_bash_runs_in_workspace_root_and_persists_session_scratch() {
        let tmp = std::env::temp_dir().join(format!(
            "aetheria_bash_ws_{}_{}",
            std::process::id(),
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp ws");
        std::fs::write(tmp.join("probe_marker.txt"), "ok").expect("write marker");

        let ws_str = tmp.to_string_lossy().to_string();
        let sid = "test-bash-scratch-persist";

        // Step 1: write a state file into session scratch dir
        let res1 = execute_bash(
            sid,
            &ws_str,
            &json!({
                "command": "python -c \"import os; assert os.path.isfile('probe_marker.txt'); open(os.path.join(os.environ['AETHERIA_SCRATCH_DIR'], 'step1.txt'), 'w').write('PERSISTED_42'); print('MARKER_OK')\""
            }),
        )
        .await;
        assert_eq!(res1.get("ok").and_then(|v| v.as_bool()), Some(true), "res1: {}", res1);
        assert!(res1["output"].as_str().unwrap_or("").contains("MARKER_OK"));

        // Step 2: verify scratch file is STILL there on the next bash call!
        let res2 = execute_bash(
            sid,
            &ws_str,
            &json!({
                "command": "python -c \"import os; print(open(os.path.join(os.environ['AETHERIA_SCRATCH_DIR'], 'step1.txt')).read())\""
            }),
        )
        .await;
        assert_eq!(res2.get("ok").and_then(|v| v.as_bool()), Some(true), "res2: {}", res2);
        assert!(
            res2["output"].as_str().unwrap_or("").contains("PERSISTED_42"),
            "scratch file must persist across bash calls in same session: {}",
            res2
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_bash_command_blocks_secret_reads_and_host_destruction() {
        assert!(validate_bash_command("cat ~/.aetheria/dev-server-password").is_err());
        assert!(validate_bash_command("reg delete HKLM\\Software").is_err());
        assert!(validate_bash_command("ffprobe -v error audio/scene1.wav").is_ok());
    }
}
