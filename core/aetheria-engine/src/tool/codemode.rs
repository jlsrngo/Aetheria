//! OpenCode Codemode Execution Sandbox — mirrors `packages/codemode/src/tool.ts`.
//! Runs self-contained JavaScript inside a `vm.runInNewContext` sandbox with workspace-jailed
//! helpers (`workspaceDir`, jailed `fs`, `path`, `readText`, `writeText`, `readJson`, `writeJson`,
//! `exists`, `listDir`, `mkdir`) — zero raw `require`/`process`/`child_process` escape surface —
//! using interruptible `tokio::process::Command` with `kill_on_drop(true)` and timeout enforcement.

use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

use crate::tool::truncator::{bound_tool_output_with_spill, TruncateDirection};

const DEFAULT_CODEMODE_TIMEOUT_MS: u64 = 30_000;
const MAX_CODEMODE_TIMEOUT_MS: u64 = 120_000;

pub fn codemode_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "codemode",
            "description": "Execute a self-contained JavaScript script in a workspace-jailed Node.js VM sandbox with pre-bound helpers (`workspaceDir`, jailed `fs`, `path`, `readText`, `writeText`, `readJson`, `writeJson`, `exists`, `listDir`, `mkdir`). Use this for batch scene generation, bulk JSON/SVG/geometry math, or multi-file transformations in a single step.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "JavaScript code to run inside an async sandboxed IIFE with workspace helpers pre-bound."
                    },
                    "description": {
                        "type": "string",
                        "description": "Short summary of what this batch script computes or modifies."
                    },
                    "timeoutMs": {
                        "type": "integer",
                        "description": "Optional execution timeout in milliseconds (default 30000, max 120000)."
                    }
                },
                "required": ["code"]
            }
        }
    })
}

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

fn kill_node_tree(pid: Option<u32>) {
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

pub async fn execute_codemode(
    session_id: &str,
    workspace_dir: &str,
    arguments: &Value,
) -> Value {
    let user_code = arguments
        .get("code")
        .or_else(|| arguments.get("script"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if user_code.is_empty() {
        return json!({ "ok": false, "error": "codemode `code` parameter is required" });
    }

    let timeout_ms = arguments
        .get("timeoutMs")
        .or_else(|| arguments.get("timeout"))
        .and_then(|v| v.as_u64())
        .map(|n| n.clamp(1_000, MAX_CODEMODE_TIMEOUT_MS))
        .unwrap_or(DEFAULT_CODEMODE_TIMEOUT_MS);

    let ws_root = Path::new(workspace_dir);
    let sid_dir = sanitize_session_segment(session_id);
    let sandbox_dir = ws_root.join(".aetheria").join("codemode").join(&sid_dir);
    if !crate::paths::contains_path(ws_root, &sandbox_dir) {
        return json!({ "ok": false, "error": "Codemode sandbox directory resolved outside workspace." });
    }
    let _ = tokio::fs::create_dir_all(&sandbox_dir).await;

    let run_id = crate::paths::gen_id("cm");
    let script_file = sandbox_dir.join(format!("run_{}.cjs", run_id));
    let user_code_file = sandbox_dir.join(format!("user_{}.js", run_id));

    if let Err(e) = tokio::fs::write(&user_code_file, user_code).await {
        return json!({ "ok": false, "error": format!("Failed to stage codemode source: {}", e) });
    }

    let harness_code = r#"const realFs = require("fs");
const realPath = require("path");
const vm = require("vm");

const workspaceDir = realFs.realpathSync(process.env.AETHERIA_CODEMODE_WS || process.cwd());
const userCodePath = process.env.AETHERIA_CODEMODE_USER_CODE;
const userCode = realFs.readFileSync(userCodePath, "utf8");
const timeoutMs = Number(process.env.AETHERIA_CODEMODE_TIMEOUT_MS || "30000");

function resolveSafe(rel) {
  if (typeof rel !== "string" || !rel.trim()) {
    throw new Error("Path must be a non-empty string");
  }
  const target = realPath.resolve(workspaceDir, rel);
  const existing = realFs.existsSync(target)
    ? realFs.realpathSync(target)
    : (() => {
        let cur = realPath.dirname(target);
        const tail = [realPath.basename(target)];
        while (!realFs.existsSync(cur)) {
          const parent = realPath.dirname(cur);
          if (parent === cur) break;
          tail.unshift(realPath.basename(cur));
          cur = parent;
        }
        const base = realFs.existsSync(cur) ? realFs.realpathSync(cur) : cur;
        return realPath.join(base, ...tail);
      })();
  const relPath = realPath.relative(workspaceDir, existing);
  if (relPath.startsWith("..") || realPath.isAbsolute(relPath)) {
    throw new Error("Path outside workspace blocked by codemode sandbox: " + rel);
  }
  return existing;
}

const jailedFs = Object.freeze({
  readFileSync(p, enc) {
    return realFs.readFileSync(resolveSafe(p), enc === undefined ? "utf8" : enc);
  },
  writeFileSync(p, data, enc) {
    const safe = resolveSafe(p);
    realFs.mkdirSync(realPath.dirname(safe), { recursive: true });
    return realFs.writeFileSync(safe, data, enc === undefined ? "utf8" : enc);
  },
  existsSync(p) {
    try { return realFs.existsSync(resolveSafe(p)); } catch { return false; }
  },
  readdirSync(p, opts) {
    return realFs.readdirSync(resolveSafe(p || "."), opts);
  },
  mkdirSync(p, opts) {
    return realFs.mkdirSync(resolveSafe(p), opts || { recursive: true });
  },
  statSync(p) {
    return realFs.statSync(resolveSafe(p));
  },
  unlinkSync(p) {
    return realFs.unlinkSync(resolveSafe(p));
  },
});

const safePath = Object.freeze({
  join: realPath.join,
  resolve: (...segs) => resolveSafe(realPath.join(...segs)),
  dirname: realPath.dirname,
  basename: realPath.basename,
  extname: realPath.extname,
  relative: realPath.relative,
  sep: realPath.sep,
  posix: realPath.posix,
});

function readText(rel) {
  return jailedFs.readFileSync(rel, "utf8");
}
function writeText(rel, data) {
  const safe = resolveSafe(rel);
  realFs.mkdirSync(realPath.dirname(safe), { recursive: true });
  realFs.writeFileSync(safe, String(data), "utf8");
  return realPath.relative(workspaceDir, safe).replace(/\\/g, "/");
}
function readJson(rel) {
  return JSON.parse(readText(rel));
}
function writeJson(rel, data) {
  return writeText(rel, JSON.stringify(data, null, 2));
}
function exists(rel) {
  return jailedFs.existsSync(rel);
}
function listDir(rel = ".") {
  return jailedFs.readdirSync(rel);
}
function mkdir(rel) {
  jailedFs.mkdirSync(rel, { recursive: true });
  return rel;
}

const sandbox = Object.create(null);
sandbox.workspaceDir = workspaceDir;
sandbox.fs = jailedFs;
sandbox.path = safePath;
sandbox.resolveSafe = resolveSafe;
sandbox.resolvePath = resolveSafe;
sandbox.readText = readText;
sandbox.writeText = writeText;
sandbox.readJson = readJson;
sandbox.writeJson = writeJson;
sandbox.exists = exists;
sandbox.listDir = listDir;
sandbox.mkdir = mkdir;
sandbox.console = Object.freeze({
  log: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  info: (...a) => console.info(...a),
});
sandbox.Math = Math;
sandbox.JSON = JSON;
sandbox.Date = Date;
sandbox.URL = URL;
sandbox.Buffer = Buffer;
sandbox.Uint8Array = Uint8Array;
sandbox.Float32Array = Float32Array;
sandbox.Float64Array = Float64Array;
sandbox.Int32Array = Int32Array;
sandbox.Map = Map;
sandbox.Set = Set;
sandbox.RegExp = RegExp;
sandbox.Promise = Promise;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;

const ctx = vm.createContext(sandbox, {
  codeGeneration: { strings: false, wasm: false },
});

const wrapped = "(async () => {\n" + userCode + "\n})()";
(async () => {
  const script = new vm.Script(wrapped, { filename: "codemode-sandbox.js" });
  const promise = script.runInContext(ctx, { timeout: timeoutMs });
  const result = await promise;
  if (result !== undefined) {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
"#;

    if let Err(e) = tokio::fs::write(&script_file, harness_code).await {
        let _ = tokio::fs::remove_file(&user_code_file).await;
        return json!({ "ok": false, "error": format!("Failed to write codemode harness: {}", e) });
    }

    let interrupt_rx = crate::session::coordinator::subscribe_session_interrupt(session_id);
    let mut cmd = tokio::process::Command::new("node");
    cmd.arg(&script_file)
        .current_dir(workspace_dir)
        .env("AETHERIA_CODEMODE_WS", workspace_dir)
        .env("AETHERIA_CODEMODE_USER_CODE", &user_code_file)
        .env("AETHERIA_CODEMODE_TIMEOUT_MS", timeout_ms.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    for key in crate::tool::bash::SENSITIVE_ENV_VARS {
        cmd.env_remove(key);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let spawn_res = cmd.spawn();
    let exec_outcome = match spawn_res {
        Ok(child) => {
            let pid = child.id();
            tokio::select! {
                biased;
                _ = crate::session::coordinator::wait_session_interrupt(interrupt_rx) => {
                    kill_node_tree(pid);
                    Err(("aborted", "Codemode execution aborted by user".to_string()))
                }
                _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => {
                    kill_node_tree(pid);
                    Err(("timeout", format!("Codemode execution timed out after {}ms", timeout_ms)))
                }
                out = child.wait_with_output() => {
                    out.map_err(|e| ("io", format!("Codemode process failed: {}", e)))
                }
            }
        }
        Err(e) => Err(("io", format!("Failed to launch Node.js for codemode: {}", e))),
    };

    let _ = tokio::fs::remove_file(&script_file).await;
    let _ = tokio::fs::remove_file(&user_code_file).await;

    match exec_outcome {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let ok = output.status.success();
            let combined = if !stdout.is_empty() && !stderr.is_empty() {
                format!("{}\n[stderr]\n{}", stdout, stderr)
            } else if !stdout.is_empty() {
                stdout.clone()
            } else if !stderr.is_empty() {
                stderr.clone()
            } else {
                "(codemode completed with no stdout)".to_string()
            };
            let (bounded, truncated, spill_rel) = bound_tool_output_with_spill(
                "codemode",
                &combined,
                Some(workspace_dir),
                Some(&format!("cm_{}", run_id)),
                TruncateDirection::Tail,
            );
            crate::session::message::emit_event(
                workspace_dir,
                "codemode.executed",
                json!({ "sessionID": session_id, "ok": ok }),
            );
            let mut res = json!({
                "ok": ok,
                "exitCode": output.status.code().unwrap_or(-1),
                "output": bounded,
                "truncated": truncated
            });
            if !ok && !stderr.is_empty() {
                res["error"] = json!(stderr.lines().next().unwrap_or("Codemode script failed"));
            }
            if let Some(rel) = spill_rel {
                res["logFile"] = json!(rel);
            }
            res
        }
        Err(("aborted", msg)) => json!({ "ok": false, "aborted": true, "error": msg }),
        Err(("timeout", msg)) => json!({ "ok": false, "timedOut": true, "error": msg }),
        Err((_, msg)) => json!({ "ok": false, "error": msg }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codemode_definition_valid() {
        let def = codemode_tool_definition();
        assert_eq!(def["function"]["name"], "codemode");
    }

    #[tokio::test]
    async fn codemode_vm_sandbox_allows_workspace_io_and_blocks_host_escape() {
        let tmp = std::env::temp_dir().join(format!(
            "aetheria_cm_vm_{}_{}",
            std::process::id(),
            crate::paths::now_ms()
        ));
        std::fs::create_dir_all(&tmp).expect("mkdir");
        let ws = tmp.to_string_lossy().to_string();

        // 1. Valid workspace read/write works cleanly
        let ok_res = execute_codemode(
            "sess_cm_ok",
            &ws,
            &json!({
                "code": "writeJson('data/out.json', { answer: 42 }); return readJson('data/out.json').answer;"
            }),
        )
        .await;
        assert_eq!(ok_res.get("ok").and_then(Value::as_bool), Some(true), "ok_res={}", ok_res);
        assert!(ok_res["output"].as_str().unwrap().contains("42"));

        // 2. Attempting raw `require('fs')` fails inside VM sandbox
        let req_res = execute_codemode(
            "sess_cm_req",
            &ws,
            &json!({ "code": "const f = require('fs'); return f.readdirSync('/');" }),
        )
        .await;
        assert_eq!(req_res.get("ok").and_then(Value::as_bool), Some(false), "req_res={}", req_res);

        // 3. Attempting parent directory traversal via jailed `fs` is blocked
        let esc_res = execute_codemode(
            "sess_cm_esc",
            &ws,
            &json!({ "code": "return fs.readFileSync('../outside_secret.txt', 'utf8');" }),
        )
        .await;
        assert_eq!(esc_res.get("ok").and_then(Value::as_bool), Some(false), "esc_res={}", esc_res);
        assert!(esc_res["output"]
            .as_str()
            .unwrap_or("")
            .contains("outside workspace"));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
