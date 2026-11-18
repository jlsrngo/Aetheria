//! Per-video project subfolder registry (`<workspace>/projects/<slug>/`).
//!
//! Keeps each generated video (`index.html`, `script/`, `audio/`, `output/`, `.aetheria/`)
//! isolated in its own subfolder while remaining backwards-compatible with legacy workspaces
//! that place `index.html` directly in the workspace root.

use super::film_inspector::inspect_workspace_film;
use super::motion::resolve_active_dir_from_request;
use crate::paths::contains_path;
use crate::tool::path_guard::resolve_isolated_path;
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub(crate) const PROJECTS_DIR_NAME: &str = "projects";
const ACTIVE_PROJECT_REL: &str = ".aetheria/active-project.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProjectInfo {
    pub id: String,
    pub title: String,
    pub relative_path: String,
    pub has_index: bool,
    pub scene_count: usize,
    pub duration: f64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProjectsState {
    pub active_project: Option<String>,
    pub has_root_legacy_film: bool,
    pub projects: Vec<StudioProjectInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveProjectMarker {
    project: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSelectPayload {
    pub directory: Option<String>,
    pub project: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreatePayload {
    pub directory: Option<String>,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeletePayload {
    pub directory: Option<String>,
    pub project: String,
}

/// Converts an arbitrary video title into a safe lowercase kebab-case folder slug.
pub fn slugify_project_title(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
        if slug.len() >= 56 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled-video".to_string()
    } else {
        trimmed
    }
}

/// Validates a project slug so it cannot escape `<ws_root>/projects/`.
pub fn is_valid_project_slug(slug: &str) -> bool {
    let s = slug.trim();
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains('\0')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Extracts an explicit video title prefix (`Storyboard:`, `Judul:`, `Title:`, `Topic:`, `Topik:`).
pub fn extract_explicit_video_title(prompt: &str) -> Option<String> {
    for raw_line in prompt.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let without_cmds: Vec<&str> = line
            .split_whitespace()
            .skip_while(|tok| tok.starts_with('/'))
            .collect();
        if without_cmds.is_empty() {
            continue;
        }
        let cleaned_line = without_cmds.join(" ");
        let lower = cleaned_line.to_ascii_lowercase();
        for prefix in ["storyboard:", "judul:", "title:", "topic:", "topik:"] {
            if lower.starts_with(prefix) {
                let rest = cleaned_line[prefix.len()..].trim();
                let unquoted = rest.trim_matches(|c| c == '"' || c == '\'' || c == '“' || c == '”');
                if !unquoted.is_empty() {
                    return Some(unquoted.chars().take(80).collect());
                }
            }
        }
    }
    None
}

/// Returns true when the prompt explicitly requests a brand-new video or multi-scene storyboard.
pub fn is_new_video_creation_prompt(prompt: &str) -> bool {
    if extract_explicit_video_title(prompt).is_some() {
        return true;
    }
    let lower = prompt.to_ascii_lowercase();
    if [
        "video baru",
        "new video",
        "proyek baru",
        "project baru",
        "new project",
        "buatkan video",
        "buat video",
        "bikin video",
        "create a video",
        "create video",
        "make a video",
        "video profil",
        "video dokumenter",
        "video edukasi",
        "video promosi",
        "video tentang",
    ]
    .iter()
    .any(|kw| lower.contains(kw))
    {
        return true;
    }
    lower.contains("scene 1") && lower.contains("scene 2")
}

/// Returns true when the prompt explicitly asks for a narrated or short-form social video
/// (TikTok/Reels/Shorts/voiceover) rather than a silent Adobe Stock microstock clip.
pub fn is_explicit_social_or_narrated_video_prompt(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    if lower.contains("microstock")
        || lower.contains("micsrostock")
        || lower.contains("adobe stock")
        || lower.contains("stok adobe")
        || lower.contains("/adobe-stock")
    {
        return false;
    }
    [
        "tiktok",
        "reels",
        "youtube shorts",
        "voiceover",
        "voice over",
        "narasi",
        "narrated",
    ]
    .iter()
    .any(|kw| lower.contains(kw))
}

/// Returns true when the prompt is an instruction to edit/restyle/fix the current active project
/// rather than starting a brand-new named video project.
pub fn is_revision_or_style_adjustment_prompt(prompt: &str) -> bool {
    if is_new_video_creation_prompt(prompt) {
        return false;
    }
    let lower = prompt.to_ascii_lowercase();
    [
        "pakai style",
        "style ini",
        "buat rapih",
        "rapih",
        "rapikan",
        "rasio",
        "landscape",
        "lanscape",
        "portrait",
        "potrait",
        "ubah ",
        "perbaiki",
        "ganti ",
        "restyle",
        "fix ",
        "ini aja",
        "lanjut",
        "continue",
        "teruskan",
    ]
    .iter()
    .any(|kw| lower.contains(kw))
}

fn is_url_only_or_reference_intro_line(lower_line: &str) -> bool {
    let tokens: Vec<&str> = lower_line.split_whitespace().collect();
    if tokens.is_empty() {
        return true;
    }
    let has_url = tokens
        .iter()
        .any(|t| t.starts_with("http://") || t.starts_with("https://"));
    if !has_url {
        return false;
    }
    let non_url_words: Vec<&str> = tokens
        .into_iter()
        .filter(|t| !t.starts_with("http://") && !t.starts_with("https://"))
        .collect();
    non_url_words.len() <= 4
        && non_url_words.iter().all(|w| {
            matches!(
                w.trim_matches(|c: char| !c.is_ascii_alphanumeric()),
                "ini"
                    | "contoh"
                    | "contohnya"
                    | "referensi"
                    | "referensinya"
                    | "ref"
                    | "link"
                    | "url"
                    | "style"
                    | "gaya"
                    | "seperti"
                    | "dari"
                    | "video"
            )
        })
}

/// Extracts a human-readable video title from a user prompt or storyboard text.
pub fn extract_video_title_from_prompt(prompt: &str) -> Option<String> {
    if let Some(explicit) = extract_explicit_video_title(prompt) {
        return Some(explicit);
    }
    for raw_line in prompt.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        // Strip leading slash commands like `/mg-soft-clay-story /audio:mystery`
        let without_cmds: Vec<&str> = line
            .split_whitespace()
            .skip_while(|tok| tok.starts_with('/'))
            .collect();
        if without_cmds.is_empty() {
            continue;
        }
        let cleaned_line = without_cmds.join(" ");
        let lower = cleaned_line.to_ascii_lowercase();
        if is_url_only_or_reference_intro_line(&lower) {
            continue;
        }
        if !lower.starts_with("format:") && !lower.starts_with("musik") && !lower.starts_with("detik")
        {
            let unquoted = cleaned_line
                .trim_matches(|c| c == '"' || c == '\'' || c == '“' || c == '”');
            if !unquoted.is_empty() {
                return Some(unquoted.chars().take(80).collect());
            }
        }
    }
    None
}

fn read_active_project_slug(ws_root: &Path) -> Option<String> {
    let ws_str = ws_root.to_string_lossy();
    let marker_path = resolve_isolated_path(&ws_str, ACTIVE_PROJECT_REL).ok()?;
    let raw = std::fs::read_to_string(marker_path).ok()?;
    let parsed: ActiveProjectMarker = serde_json::from_str(&raw).ok()?;
    let slug = parsed.project.trim().to_string();
    if is_valid_project_slug(&slug) {
        Some(slug)
    } else {
        None
    }
}

fn write_active_project_slug(ws_root: &Path, slug: Option<&str>) -> Result<(), String> {
    let ws_str = ws_root.to_string_lossy();
    let marker_path = resolve_isolated_path(&ws_str, ACTIVE_PROJECT_REL)?;
    match slug {
        Some(s) => {
            if !is_valid_project_slug(s) {
                return Err(format!("Invalid project slug '{}'", s));
            }
            if let Some(parent) = marker_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed creating .aetheria dir: {}", e))?;
            }
            let payload = serde_json::to_string_pretty(&ActiveProjectMarker {
                project: s.to_string(),
            })
            .map_err(|e| format!("Failed serializing active project marker: {}", e))?;
            std::fs::write(&marker_path, payload)
                .map_err(|e| format!("Failed writing active project marker: {}", e))
        }
        None => {
            if marker_path.exists() {
                std::fs::remove_file(&marker_path)
                    .map_err(|e| format!("Failed clearing active project marker: {}", e))?;
            }
            Ok(())
        }
    }
}

fn dir_updated_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn inspect_project_dir(dir: &Path, slug: &str) -> StudioProjectInfo {
    let index_path = dir.join("index.html");
    let has_index = index_path.is_file();
    let meta = if has_index {
        inspect_workspace_film(&index_path)
    } else {
        inspect_workspace_film(Path::new(""))
    };
    let title = if !meta.title.trim().is_empty() {
        meta.title.clone()
    } else {
        slug.replace('-', " ")
    };
    let updated_at_ms = if has_index {
        dir_updated_ms(&index_path)
    } else {
        dir_updated_ms(dir)
    };
    StudioProjectInfo {
        id: slug.to_string(),
        title,
        relative_path: format!("{}/{}", PROJECTS_DIR_NAME, slug),
        has_index,
        scene_count: meta.scenes.len(),
        duration: meta.duration,
        updated_at_ms,
    }
}

/// Lists all per-video subfolders inside `<ws_root>/projects/` plus the active project slug.
pub fn list_studio_projects(ws_root: &Path) -> StudioProjectsState {
    let projects_root = ws_root.join(PROJECTS_DIR_NAME);
    let mut projects = Vec::new();
    if projects_root.is_dir() && contains_path(ws_root, &projects_root) {
        if let Ok(entries) = std::fs::read_dir(&projects_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() || !contains_path(&projects_root, &path) {
                    continue;
                }
                let Some(slug) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if !is_valid_project_slug(slug) {
                    continue;
                }
                projects.push(inspect_project_dir(&path, slug));
            }
        }
    }
    projects.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms).then_with(|| a.id.cmp(&b.id)));

    let has_root_legacy_film = ws_root.join("index.html").is_file()
        || ws_root.join("workspace").join("index.html").is_file();

    let mut active_project = read_active_project_slug(ws_root)
        .filter(|slug| projects.iter().any(|p| p.id == *slug));
    if active_project.is_none() {
        active_project = projects
            .iter()
            .find(|p| p.has_index)
            .or_else(|| projects.first())
            .map(|p| p.id.clone());
    }

    StudioProjectsState {
        active_project,
        has_root_legacy_film,
        projects,
    }
}

/// Resolves the active film root directory (containing `index.html`) inside `ws_root`.
/// Priority: active project (`projects/<slug>/index.html`) -> `<ws_root>/index.html`
/// -> `<ws_root>/workspace/index.html` -> most recently updated `projects/<slug>/index.html`.
pub fn resolve_active_film_root(ws_root: &Path) -> Option<PathBuf> {
    if let Some(slug) = read_active_project_slug(ws_root) {
        let proj_dir = ws_root.join(PROJECTS_DIR_NAME).join(&slug);
        if contains_path(ws_root, &proj_dir) && proj_dir.is_dir() {
            if proj_dir.join("index.html").is_file() {
                return Some(proj_dir);
            }
            return None;
        }
    }

    let direct = ws_root.join("index.html");
    if direct.is_file() {
        return Some(ws_root.to_path_buf());
    }

    let sub = ws_root.join("workspace").join("index.html");
    if sub.is_file() {
        return Some(ws_root.join("workspace"));
    }

    let state = list_studio_projects(ws_root);
    if let Some(first_with_index) = state.projects.into_iter().find(|p| p.has_index) {
        let proj_dir = ws_root.join(PROJECTS_DIR_NAME).join(first_with_index.id);
        if contains_path(ws_root, &proj_dir) && proj_dir.join("index.html").is_file() {
            return Some(proj_dir);
        }
    }
    None
}

/// Returns the active project directory (`<ws_root>/projects/<slug>`) even before `index.html` exists,
/// falling back to `resolve_active_film_root` for legacy workspace-root projects.
pub fn resolve_active_project_or_film_root(ws_root: &Path) -> Option<PathBuf> {
    if let Some(slug) = read_active_project_slug(ws_root) {
        let proj_dir = ws_root.join(PROJECTS_DIR_NAME).join(&slug);
        if contains_path(ws_root, &proj_dir) && proj_dir.is_dir() {
            return Some(proj_dir);
        }
    }
    resolve_active_film_root(ws_root)
}

/// Creates `<ws_root>/projects/<slug>/` with standard subdirectories and selects it as active.
pub fn create_studio_project(ws_root: &Path, title: &str) -> Result<StudioProjectInfo, String> {
    let base_slug = slugify_project_title(title);
    let ws_str = ws_root.to_string_lossy();
    let mut slug = base_slug.clone();
    let mut suffix = 2usize;
    loop {
        let rel = format!("{}/{}", PROJECTS_DIR_NAME, slug);
        let candidate = resolve_isolated_path(&ws_str, &rel)?;
        if !candidate.exists() {
            for sub in ["script", "audio", "output"] {
                let sub_path = resolve_isolated_path(&ws_str, &format!("{}/{}", rel, sub))?;
                std::fs::create_dir_all(&sub_path).map_err(|e| {
                    format!("Failed creating project subfolder '{}': {}", sub_path.display(), e)
                })?;
            }
            write_active_project_slug(ws_root, Some(&slug))?;
            return Ok(inspect_project_dir(&candidate, &slug));
        }
        slug = format!("{}-{}", base_slug, suffix);
        suffix += 1;
        if suffix > 999 {
            return Err("Too many projects with the same title".to_string());
        }
    }
}

/// Ensures an isolated project subfolder exists for a new video/storyboard prompt and selects it.
/// Reuses the current active project for restyle/revision prompts (without explicit `Storyboard:` /
/// `Judul:` / `Title:`), or reuses an empty project with matching slug, or creates a new subfolder.
pub fn ensure_project_for_prompt(ws_root: &Path, prompt: &str) -> Result<StudioProjectInfo, String> {
    let ws_str = ws_root.to_string_lossy();
    if is_revision_or_style_adjustment_prompt(prompt) {
        if let Some(active_slug) = read_active_project_slug(ws_root) {
            let rel = format!("{}/{}", PROJECTS_DIR_NAME, active_slug);
            let active_dir = resolve_isolated_path(&ws_str, &rel)?;
            if active_dir.is_dir() {
                return Ok(inspect_project_dir(&active_dir, &active_slug));
            }
        }
        let state = list_studio_projects(ws_root);
        if let Some(first) = state.projects.into_iter().next() {
            let rel = format!("{}/{}", PROJECTS_DIR_NAME, first.id);
            let proj_dir = resolve_isolated_path(&ws_str, &rel)?;
            if proj_dir.is_dir() {
                write_active_project_slug(ws_root, Some(&first.id))?;
                return Ok(first);
            }
        }
    }

    let title = if is_revision_or_style_adjustment_prompt(prompt) {
        let ts = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("video-{}", ts)
    } else {
        extract_video_title_from_prompt(prompt).unwrap_or_else(|| {
            let ts = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("video-{}", ts)
        })
    };
    let base_slug = slugify_project_title(&title);
    let rel = format!("{}/{}", PROJECTS_DIR_NAME, base_slug);
    let existing = resolve_isolated_path(&ws_str, &rel)?;
    if existing.is_dir() && !existing.join("index.html").is_file() {
        for sub in ["script", "audio", "output"] {
            let sub_path = resolve_isolated_path(&ws_str, &format!("{}/{}", rel, sub))?;
            std::fs::create_dir_all(&sub_path).map_err(|e| {
                format!("Failed creating project subfolder '{}': {}", sub_path.display(), e)
            })?;
        }
        write_active_project_slug(ws_root, Some(&base_slug))?;
        if is_explicit_social_or_narrated_video_prompt(prompt) {
            clear_microstock_lock_for_project(ws_root, &existing);
        }
        return Ok(inspect_project_dir(&existing, &base_slug));
    }
    let created = create_studio_project(ws_root, &title)?;
    if is_explicit_social_or_narrated_video_prompt(prompt) {
        let proj_dir = ws_root.join(PROJECTS_DIR_NAME).join(&created.id);
        clear_microstock_lock_for_project(ws_root, &proj_dir);
    }
    Ok(created)
}

fn clear_microstock_lock_for_project(ws_root: &Path, project_dir: &Path) {
    let _ = crate::studio::microstock::manifest::save_workspace_mode(ws_root, false, "1920x1080", 30);
    if let Ok(mut manifest) = crate::studio::microstock::manifest::load_manifest(ws_root, project_dir) {
        if manifest.enabled {
            manifest.enabled = false;
            let _ = crate::studio::microstock::manifest::save_manifest(ws_root, project_dir, &manifest);
        }
    }
}

/// Returns true when the workspace has an active project selection or existing `projects/` subfolders.
pub fn has_active_project_selection(ws_root: &Path) -> bool {
    if read_active_project_slug(ws_root).is_some() {
        return true;
    }
    let state = list_studio_projects(ws_root);
    !state.projects.is_empty()
}

/// Creates or reuses an isolated `projects/<slug>/` folder derived from an uploaded HTML/SVG filename
/// and selects it as active so new file uploads never collide with a previous session's active project.
pub fn ensure_project_for_uploaded_file(
    ws_root: &Path,
    file_name: &str,
) -> Result<StudioProjectInfo, String> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("uploaded-stage");
    let base_slug = slugify_project_title(stem);
    let ws_str = ws_root.to_string_lossy();
    let rel = format!("{}/{}", PROJECTS_DIR_NAME, base_slug);
    let existing = resolve_isolated_path(&ws_str, &rel)?;
    if existing.is_dir() && !existing.join("index.html").is_file() {
        for sub in ["script", "audio", "output"] {
            let sub_path = resolve_isolated_path(&ws_str, &format!("{}/{}", rel, sub))?;
            std::fs::create_dir_all(&sub_path).map_err(|e| {
                format!("Failed creating project subfolder '{}': {}", sub_path.display(), e)
            })?;
        }
        write_active_project_slug(ws_root, Some(&base_slug))?;
        return Ok(inspect_project_dir(&existing, &base_slug));
    }
    create_studio_project(ws_root, stem)
}

/// Selects an existing project subfolder (or `"__root__"` to clear selection to legacy root).
pub fn select_studio_project(ws_root: &Path, slug: &str) -> Result<Option<String>, String> {
    let trimmed = slug.trim();
    if trimmed == "__root__" || trimmed.is_empty() {
        write_active_project_slug(ws_root, None)?;
        return Ok(None);
    }
    if !is_valid_project_slug(trimmed) {
        return Err(format!("Invalid project slug '{}'", trimmed));
    }
    let ws_str = ws_root.to_string_lossy();
    let rel = format!("{}/{}", PROJECTS_DIR_NAME, trimmed);
    let proj_dir = resolve_isolated_path(&ws_str, &rel)?;
    if !proj_dir.is_dir() {
        return Err(format!("Project '{}' not found", trimmed));
    }
    write_active_project_slug(ws_root, Some(trimmed))?;
    Ok(Some(trimmed.to_string()))
}

/// Deletes a single project subfolder `<ws_root>/projects/<slug>/` without affecting others.
pub fn delete_studio_project(ws_root: &Path, slug: &str) -> Result<Option<String>, String> {
    let trimmed = slug.trim();
    if !is_valid_project_slug(trimmed) {
        return Err(format!("Invalid project slug '{}'", trimmed));
    }
    let ws_str = ws_root.to_string_lossy();
    let rel = format!("{}/{}", PROJECTS_DIR_NAME, trimmed);
    let proj_dir = resolve_isolated_path(&ws_str, &rel)?;
    let projects_root = ws_root.join(PROJECTS_DIR_NAME);
    if !contains_path(&projects_root, &proj_dir) || !proj_dir.is_dir() {
        return Err(format!("Project '{}' not found", trimmed));
    }
    std::fs::remove_dir_all(&proj_dir)
        .map_err(|e| format!("Failed deleting project '{}': {}", trimmed, e))?;

    let was_active = read_active_project_slug(ws_root).as_deref() == Some(trimmed);
    if was_active {
        let next = list_studio_projects(ws_root).active_project;
        write_active_project_slug(ws_root, next.as_deref())?;
        return Ok(next);
    }
    Ok(read_active_project_slug(ws_root))
}

fn resolve_dir_opt(
    explicit_dir: Option<&str>,
    q: &HashMap<String, String>,
    headers: &HeaderMap,
) -> Option<PathBuf> {
    if let Some(dir) = explicit_dir.map(str::trim).filter(|s| !s.is_empty()) {
        let norm = crate::paths::normalize_workspace_path(dir);
        crate::desktop::set_active_workspace_root(&norm);
        return Some(PathBuf::from(norm));
    }
    resolve_active_dir_from_request(q, headers)
}

/// GET /api/studio/projects
pub async fn handle_list_projects(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(ws_root) = resolve_active_dir_from_request(&q, &headers) else {
        return Json(json!({
            "data": StudioProjectsState {
                active_project: None,
                has_root_legacy_film: false,
                projects: Vec::new(),
            }
        }))
        .into_response();
    };
    Json(json!({ "data": list_studio_projects(&ws_root) })).into_response()
}

/// POST /api/studio/projects/select
pub async fn handle_select_project(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<ProjectSelectPayload>,
) -> impl IntoResponse {
    let Some(ws_root) = resolve_dir_opt(payload.directory.as_deref(), &q, &headers) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No active workspace directory" })),
        )
            .into_response();
    };
    match select_studio_project(&ws_root, &payload.project) {
        Ok(active) => Json(json!({ "data": { "activeProject": active } })).into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    }
}

/// POST /api/studio/projects/create
pub async fn handle_create_project(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<ProjectCreatePayload>,
) -> impl IntoResponse {
    let Some(ws_root) = resolve_dir_opt(payload.directory.as_deref(), &q, &headers) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No active workspace directory" })),
        )
            .into_response();
    };
    match create_studio_project(&ws_root, &payload.title) {
        Ok(project) => Json(json!({ "data": { "project": project } })).into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    }
}

/// POST /api/studio/projects/delete
pub async fn handle_delete_project(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(payload): Json<ProjectDeletePayload>,
) -> impl IntoResponse {
    let Some(ws_root) = resolve_dir_opt(payload.directory.as_deref(), &q, &headers) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No active workspace directory" })),
        )
            .into_response();
    };
    match delete_studio_project(&ws_root, &payload.project) {
        Ok(active) => {
            Json(json!({ "data": { "deleted": payload.project, "activeProject": active } }))
                .into_response()
        }
        Err(err) => (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_ws(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{}_{}", prefix, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn slugify_and_extract_title_from_storyboard_prompt() {
        let prompt = "/mg-soft-clay-story /audio:mystery\n\nStoryboard: “Mayat yang Menipu Hitler”\n\nFormat: 9:16";
        let title = extract_video_title_from_prompt(prompt).unwrap();
        assert_eq!(title, "Mayat yang Menipu Hitler");
        assert_eq!(slugify_project_title(&title), "mayat-yang-menipu-hitler");
    }

    #[test]
    fn create_select_resolve_and_delete_isolated_projects() {
        let ws = make_temp_ws("aetheria_proj_reg");
        let p1 = create_studio_project(&ws, "Mayat yang Menipu Hitler").unwrap();
        assert_eq!(p1.id, "mayat-yang-menipu-hitler");
        std::fs::write(
            ws.join("projects").join(&p1.id).join("index.html"),
            "<html><title>Video 1</title></html>",
        )
        .unwrap();

        let p2 = create_studio_project(&ws, "Video Kedua").unwrap();
        assert_eq!(p2.id, "video-kedua");
        std::fs::write(
            ws.join("projects").join(&p2.id).join("index.html"),
            "<html><title>Video 2</title></html>",
        )
        .unwrap();

        // Newly created p2 should be active
        assert_eq!(
            resolve_active_film_root(&ws).unwrap(),
            ws.join("projects").join("video-kedua")
        );

        // Switch back to p1
        select_studio_project(&ws, "mayat-yang-menipu-hitler").unwrap();
        assert_eq!(
            resolve_active_film_root(&ws).unwrap(),
            ws.join("projects").join("mayat-yang-menipu-hitler")
        );

        // Delete p1; p2 must remain intact and become active
        let next = delete_studio_project(&ws, "mayat-yang-menipu-hitler").unwrap();
        assert_eq!(next.as_deref(), Some("video-kedua"));
        assert!(!ws.join("projects").join("mayat-yang-menipu-hitler").exists());
        assert!(ws.join("projects").join("video-kedua").join("index.html").is_file());

        // Path traversal must be rejected
        assert!(delete_studio_project(&ws, "../outside").is_err());

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn restyle_prompt_reuses_active_project_instead_of_creating_bogus_slug() {
        let ws = make_temp_ws("aetheria_proj_restyle");
        let existing = create_studio_project(&ws, "Abstract Landscape").unwrap();
        assert_eq!(existing.id, "abstract-landscape");

        let reused = ensure_project_for_prompt(
            &ws,
            "/mg-soft-clay-story pakai style ini aja buat rapih dan rasionya buat lanscape",
        )
        .unwrap();
        assert_eq!(reused.id, "abstract-landscape");
        assert!(!ws
            .join("projects")
            .join("pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscape")
            .exists());

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn uploaded_html_file_switches_away_from_stale_active_project() {
        let ws = make_temp_ws("aetheria_proj_uploaded_html");
        let stale = create_studio_project(
            &ws,
            "pakai style ini aja buat rapih dan rasionya buat lanscap",
        )
        .unwrap();
        assert_eq!(
            stale.id,
            "pakai-style-ini-aja-buat-rapih-dan-rasionya-buat-lanscap"
        );
        assert!(has_active_project_selection(&ws));

        let switched = ensure_project_for_uploaded_file(
            &ws,
            "animasi_happy_new_year_2027_city_skyline_fireworks_microstock.html",
        )
        .unwrap();
        assert_eq!(
            switched.id,
            "animasi-happy-new-year-2027-city-skyline-fireworks-micro"
        );
        let state = list_studio_projects(&ws);
        assert_eq!(state.active_project.as_deref(), Some(switched.id.as_str()));

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn empty_active_project_does_not_leak_legacy_root_index_html() {
        let ws = make_temp_ws("aetheria_proj_no_root_leak");
        std::fs::write(
            ws.join("index.html"),
            "<html><title>Legacy Root Film</title></html>",
        )
        .unwrap();

        let created = create_studio_project(&ws, "Fresh Project").unwrap();
        assert_eq!(created.id, "fresh-project");
        assert!(resolve_active_film_root(&ws).is_none());

        std::fs::write(
            ws.join("projects").join(&created.id).join("index.html"),
            "<html><title>Fresh Film</title></html>",
        )
        .unwrap();
        assert_eq!(
            resolve_active_film_root(&ws).unwrap(),
            ws.join("projects").join("fresh-project")
        );

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn tiktok_storyline_with_reference_url_creates_new_project_and_clears_stale_microstock_lock() {
        let ws = make_temp_ws("aetheria_proj_tiktok_vs_ms");
        let old_ms = create_studio_project(&ws, "buat animasinya ini untuk micsrostock").unwrap();
        let old_dir = ws.join("projects").join(&old_ms.id);
        let mut ms_manifest = crate::studio::microstock::manifest::MicrostockManifest::default();
        ms_manifest.enabled = true;
        ms_manifest.preset = "3840x2160".to_string();
        crate::studio::microstock::manifest::save_manifest(&ws, &old_dir, &ms_manifest).unwrap();
        crate::studio::microstock::manifest::save_workspace_mode(&ws, true, "3840x2160", 30).unwrap();

        let prompt = "ini contohnya https://pin.it/3L9k7puLg\n\nBuatkan video profil produk tentang \"Aetheria (ArunakiNexus)\" untuk format TikTok / Reels (9:16, 1080x1920, 30fps, durasi sekitar 30–35 detik).\n\nScene 1 — Hook\nScene 2 — Solusi dan kartu fitur yang rapi dengan rasio portrait.";
        assert!(!is_revision_or_style_adjustment_prompt(prompt));

        let created = ensure_project_for_prompt(&ws, prompt).unwrap();
        assert_ne!(created.id, old_ms.id);
        assert!(created.id.contains("aetheria"));
        assert!(!created.id.contains("pin-it"));
        assert!(
            crate::studio::microstock::active_microstock_lock(&ws.to_string_lossy()).is_none(),
            "new TikTok project must not inherit stale Adobe Stock lock"
        );

        let _ = std::fs::remove_dir_all(&ws);
    }
}
