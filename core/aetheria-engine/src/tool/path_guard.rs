//! Workspace Path Isolation Guard for all filesystem tools.
//!
//! Ensures every resolved relative/absolute path stays strictly inside the active workspace directory.

use crate::paths::contains_path;
use std::path::{Path, PathBuf};

pub fn resolve_isolated_path(workspace_dir: &str, raw_file: &str) -> Result<PathBuf, String> {
    let ws_buf = if workspace_dir.trim().is_empty() {
        if let Some(active) = crate::desktop::get_active_workspace_root() {
            PathBuf::from(active)
        } else {
            let scratch = crate::paths::aetheria_dot_dir().join("scratch");
            let _ = std::fs::create_dir_all(&scratch);
            scratch
        }
    } else {
        PathBuf::from(workspace_dir)
    };
    let base = ws_buf.as_path();
    let mut clean_raw = raw_file.trim();

    // Deduplicate redundant "workspace/" or "workspace\" prefix when base already ends in "workspace"
    let base_is_workspace = base
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("workspace"))
        .unwrap_or(false);

    if base_is_workspace {
        while clean_raw.starts_with("workspace/") || clean_raw.starts_with("workspace\\") {
            clean_raw = &clean_raw["workspace/".len()..];
        }
        while clean_raw.starts_with("./workspace/") || clean_raw.starts_with(".\\workspace\\") {
            clean_raw = &clean_raw["./workspace/".len()..];
        }
    }

    let candidate = Path::new(clean_raw);
    let resolved = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(clean_raw)
    };
    if !contains_path(base, &resolved) {
        return Err(format!(
            "Project Folder Isolation Error: '{}' is outside the active project folder '{}'",
            raw_file, base.display()
        ));
    }
    Ok(resolved)
}

/// Rejects creating or overwriting built-in offline engine runtimes inside a project's `script/`
/// folder (`aetheria-motion.js`, `three.min.js`, `three.js`). Allows editing the repo's own
/// bundled runtime source files (`apps/public/script/aetheria-motion.js` and `assets/script/three.min.js`).
pub fn validate_writable_runtime_path(target: &Path) -> Result<(), String> {
    let Some(file_name) = target.file_name().and_then(|n| n.to_str()) else {
        return Ok(());
    };
    let lower_name = file_name.to_ascii_lowercase();
    if !matches!(lower_name.as_str(), "aetheria-motion.js" | "three.min.js" | "three.js") {
        return Ok(());
    }
    let parent_is_script = target
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("script"))
        .unwrap_or(false);
    if !parent_is_script {
        return Ok(());
    }
    let norm = target
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if norm.ends_with("/apps/public/script/aetheria-motion.js")
        || norm.ends_with("/assets/script/three.min.js")
    {
        return Ok(());
    }
    Err(format!(
        "Protected Built-in Runtime Error: 'script/{}' is a built-in offline engine runtime served automatically from memory (/script/{}). Do NOT create or overwrite it. Put window.__filmMeta, window.renderAt(t), and window.__ready = true in 'script/scene1.js' (or 'script/main.js') and 'index.html' instead.",
        file_name, file_name
    ))
}

pub fn resolve_writable_isolated_path(workspace_dir: &str, raw_file: &str) -> Result<PathBuf, String> {
    let resolved = resolve_isolated_path(workspace_dir, raw_file)?;
    validate_writable_runtime_path(&resolved)?;
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_isolated_path_deduplicates_workspace_prefix() {
        let ws = "E:\\JS\\ArunakiNexus\\workspace";

        let p1 = resolve_isolated_path(ws, "workspace/src/Root.tsx").unwrap();
        assert_eq!(p1, PathBuf::from("E:\\JS\\ArunakiNexus\\workspace\\src\\Root.tsx"));

        let p2 = resolve_isolated_path(ws, "workspace\\src\\Root.tsx").unwrap();
        assert_eq!(p2, PathBuf::from("E:\\JS\\ArunakiNexus\\workspace\\src\\Root.tsx"));

        let p3 = resolve_isolated_path(ws, "src/Root.tsx").unwrap();
        assert_eq!(p3, PathBuf::from("E:\\JS\\ArunakiNexus\\workspace\\src\\Root.tsx"));

        let p4 = resolve_isolated_path(ws, "./workspace/src/Root.tsx").unwrap();
        assert_eq!(p4, PathBuf::from("E:\\JS\\ArunakiNexus\\workspace\\src\\Root.tsx"));
    }

    #[test]
    fn test_resolve_writable_isolated_path_blocks_builtin_project_runtimes() {
        let dir = std::env::temp_dir().join(format!("aetheria_rt_guard_{}", std::process::id()));
        let ws = dir.to_string_lossy();

        for blocked in [
            "script/aetheria-motion.js",
            "./script/three.min.js",
            "public/script/three.js",
            "SCRIPT/AetherIA-Motion.JS",
        ] {
            let err = resolve_writable_isolated_path(&ws, blocked).unwrap_err();
            assert!(err.contains("Protected Built-in Runtime Error"), "unexpected: {}", err);
        }

        assert!(resolve_writable_isolated_path(&ws, "script/scene1.js").is_ok());
        assert!(resolve_writable_isolated_path(&ws, "apps/public/script/aetheria-motion.js").is_ok());
    }
}

