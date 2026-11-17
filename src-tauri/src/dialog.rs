//! Aetheria Native Desktop Dialog Module (Pure Rust)
//!
//! Provides native Windows dialogs for folder picking, file selection,
//! and Windows Explorer reveals without relying on Electron or browser APIs.

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Opens the native Windows folder picker dialog (Modern Windows File Explorer).
#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let picked = rfd::FileDialog::new()
            .set_title("Select Active Project Folder")
            .pick_folder();
        Ok(picked.map(|p| {
            let raw = p.to_string_lossy().to_string();
            aetheria_engine::desktop::set_active_workspace_root(&raw);
            raw
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the native Windows file picker dialog (Modern Windows File Explorer).
#[tauri::command]
pub async fn pick_file(filter: Option<String>) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Select File");
        if let Some(f) = filter {
            let exts: Vec<&str> = f
                .split('|')
                .nth(1)
                .unwrap_or("*.*")
                .split(';')
                .map(|s| s.trim().trim_start_matches("*."))
                .filter(|s| !s.is_empty() && *s != "*")
                .collect();
            if !exts.is_empty() {
                dialog = dialog.add_filter("Files", &exts);
            }
        }
        let picked = dialog.pick_file();
        Ok(picked.map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_safe_desktop_target(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err("Invalid empty or flag-prefixed path".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return aetheria_engine::desktop::sys::validate_external_url(trimmed);
    }
    if trimmed.contains(['\0', '&', '|', ';', '`', '\r', '\n']) {
        return Err("Path contains forbidden shell control characters".to_string());
    }
    let p = std::path::Path::new(trimmed);
    if !p.exists() {
        return Err(format!("Target path does not exist: {}", trimmed));
    }
    Ok(trimmed.to_string())
}

/// Reveals a file or folder in Windows Explorer with selection.
#[tauri::command]
pub fn show_in_explorer(path: String) -> Result<(), String> {
    let safe_path = validate_safe_desktop_target(&path)?;
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer");
        cmd.args(["/select,", &safe_path]);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}

/// Opens a file or URL with the default system application.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let safe_path = validate_safe_desktop_target(&path)?;
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "start", "", &safe_path]);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}
