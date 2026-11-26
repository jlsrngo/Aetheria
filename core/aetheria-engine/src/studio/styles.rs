//! Isolated Motion Skill Manager for Aetheria Nexus.
//! All motion skills are strictly stored and discovered in `.aetheria/skills/`.
//! External skills outside `.aetheria/skills/` are completely ignored.

use axum::{
    extract::Path as AxumPath,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::path::Path;

const SKILL_META_FILE: &str = "skill-meta.json";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SkillPackageFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub origin: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_video: Option<String>,
    pub deletable: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AddSkillPayload {
    pub name: String,
    #[serde(alias = "filePath")]
    pub file_path: Option<String>,
    #[serde(alias = "draftDir")]
    pub draft_dir: Option<String>,
    #[serde(alias = "markdown")]
    pub content: Option<String>,
    pub description: Option<String>,
    pub origin: Option<String>,
    #[serde(alias = "sourceVideo")]
    pub source_video: Option<String>,
    #[serde(default)]
    pub files: Option<Vec<SkillPackageFile>>,
}

pub type AddStylePayload = AddSkillPayload;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredSkill {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: String,
    pub path: String,
    pub has_brief: bool,
    pub has_kit: bool,
    pub builtin: bool,
    pub origin: String,
    pub deletable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_video: Option<String>,
    pub preview_fonts: Vec<String>,
}

pub type RegisteredStyle = RegisteredSkill;

/// Normalizes name into a clean kebab-case command slug (e.g. "Editorial Kinetic v2" -> "editorial-kinetic-v2").
pub fn slugify_skill_name(name: &str) -> String {
    let clean = name.trim().to_lowercase();
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in clean.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if (ch == '-' || ch == '_' || ch == ' ') && !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    slug.trim_end_matches('-').to_string()
}

pub fn slugify_style_name(name: &str) -> String {
    slugify_skill_name(name)
}

fn read_skill_meta(skill_dir: &Path) -> Option<SkillMeta> {
    let raw = std::fs::read_to_string(skill_dir.join(SKILL_META_FILE)).ok()?;
    serde_json::from_str::<SkillMeta>(&raw).ok()
}

/// Returns true when a skill directory represents a protected built-in skill.
/// Any existing skill without `skill-meta.json` (`deletable: true`) is treated as built-in.
pub fn is_protected_builtin_skill(skill_dir: &Path) -> bool {
    match read_skill_meta(skill_dir) {
        Some(meta) => !meta.deletable,
        None => true,
    }
}

fn write_skill_meta(
    skill_dir: &Path,
    origin: &str,
    source_video: Option<&str>,
) -> Result<SkillMeta, String> {
    let normalized_origin = match origin.trim().to_ascii_lowercase().as_str() {
        "reference" | "ref" => "reference",
        "imported" | "import" => "imported",
        _ => "custom",
    };
    let meta = SkillMeta {
        origin: normalized_origin.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        source_video: source_video
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from),
        deletable: true,
    };
    let serialized = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed serializing {}: {}", SKILL_META_FILE, e))?;
    std::fs::write(skill_dir.join(SKILL_META_FILE), serialized)
        .map_err(|e| format!("Failed writing {}: {}", SKILL_META_FILE, e))?;
    Ok(meta)
}

fn extract_skill_summary(skill_md: &str, fallback_slug: &str, custom_desc: Option<&str>) -> (String, String, Vec<String>) {
    let mut title = String::new();
    let mut description = custom_desc.unwrap_or("").trim().to_string();
    let mut preview_fonts = Vec::new();
    let mut in_frontmatter = false;

    for (idx, line) in skill_md.lines().enumerate() {
        let trimmed = line.trim();
        if idx == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
                continue;
            }
            if title.is_empty() {
                if let Some(rest) = trimmed.strip_prefix("name:") {
                    let val = rest.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        title = val.to_string();
                    }
                }
            }
            if description.is_empty() {
                if let Some(rest) = trimmed.strip_prefix("description:") {
                    let val = rest.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        description = val.to_string();
                    }
                }
            }
            continue;
        }

        if title.is_empty() && trimmed.starts_with("# ") {
            title = trimmed.trim_start_matches("# ").trim().to_string();
        } else if description.is_empty()
            && !trimmed.is_empty()
            && !trimmed.starts_with('#')
            && !trimmed.starts_with("```")
            && !trimmed.starts_with("---")
            && !trimmed.starts_with('>')
        {
            description = trimmed.to_string();
        }

        for font in ["Inter", "JetBrains Mono", "Space Grotesk", "Playfair Display", "Fredoka", "Syne"] {
            if trimmed.contains(font) && !preview_fonts.iter().any(|f| f == font) {
                preview_fonts.push(font.to_string());
            }
        }
    }

    if title.is_empty() {
        title = fallback_slug.replace('-', " ");
    }
    if description.is_empty() {
        description = format!("Motion skill for /{}", fallback_slug);
    }
    (title, description, preview_fonts)
}

fn ensure_writable_skill_target(skills_root: &Path, slug: &str) -> Result<std::path::PathBuf, String> {
    let skill_dir = skills_root.join(slug);
    if !crate::paths::contains_path(skills_root, &skill_dir) {
        return Err(format!("Skill path '{}' escapes .aetheria/skills/", slug));
    }
    if skill_dir.exists() && is_protected_builtin_skill(&skill_dir) {
        return Err(format!(
            "Built-in skill '{}' is protected and cannot be overwritten. Choose a different custom skill name.",
            slug
        ));
    }
    Ok(skill_dir)
}

fn is_safe_skill_package_rel(raw: &str) -> Option<String> {
    let clean = raw.trim().replace('\\', "/");
    let clean = clean.trim_start_matches("./").trim_start_matches('/');
    if clean.is_empty() || clean.contains("..") || clean.contains(':') {
        return None;
    }
    let lower = clean.to_ascii_lowercase();
    if lower == SKILL_META_FILE {
        // Metadata is written by the engine itself to preserve built-in protection invariants.
        return None;
    }
    let allowed_ext = [
        ".md", ".json", ".js", ".html", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp",
    ];
    if !allowed_ext.iter().any(|ext| lower.ends_with(ext)) {
        return None;
    }
    Some(clean.to_string())
}

fn copy_skill_dir_recursive(
    src_root: &Path,
    src_cur: &Path,
    dst_root: &Path,
) -> Result<usize, String> {
    let mut copied = 0usize;
    let entries = std::fs::read_dir(src_cur)
        .map_err(|e| format!("Failed reading skill package dir '{}': {}", src_cur.display(), e))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname.starts_with('.') || fname == "node_modules" || fname == "output" {
                continue;
            }
            copied += copy_skill_dir_recursive(src_root, &p, dst_root)?;
        } else if p.is_file() {
            if let Ok(rel) = p.strip_prefix(src_root) {
                if let Some(clean_rel) = is_safe_skill_package_rel(&rel.to_string_lossy()) {
                    let dst = dst_root.join(&clean_rel);
                    if !crate::paths::contains_path(dst_root, &dst) {
                        continue;
                    }
                    if let Some(parent) = dst.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| {
                            format!("Failed creating parent dir for '{}': {}", clean_rel, e)
                        })?;
                    }
                    std::fs::copy(&p, &dst).map_err(|e| {
                        format!(
                            "Failed copying '{}' to '{}': {}",
                            p.display(),
                            dst.display(),
                            e
                        )
                    })?;
                    copied += 1;
                }
            }
        }
    }
    Ok(copied)
}

fn validate_kit_json_if_present(skill_dir: &Path) -> Result<bool, String> {
    let kit_path = skill_dir.join("examples").join("kit.json");
    if !kit_path.is_file() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&kit_path)
        .map_err(|e| format!("Failed reading examples/kit.json: {}", e))?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("Invalid JSON in examples/kit.json: {}", e))?;
    Ok(true)
}

fn build_registered_skill(
    slug: &str,
    skill_dir: &Path,
    skill_md: &str,
    custom_desc: Option<&str>,
    meta: &SkillMeta,
    has_kit: bool,
) -> RegisteredSkill {
    let (title, description, preview_fonts) = extract_skill_summary(skill_md, slug, custom_desc);
    let has_brief = skill_dir.join("examples").join("story.example.json").is_file()
        || skill_dir.join("SKILL.md").is_file();
    RegisteredSkill {
        id: slug.to_string(),
        name: title,
        command: format!("/{}", slug),
        description,
        path: format!(".aetheria/skills/{}", slug),
        has_brief,
        has_kit,
        builtin: !meta.deletable,
        origin: meta.origin.clone(),
        deletable: meta.deletable,
        source_video: meta.source_video.clone(),
        preview_fonts,
    }
}

/// Core single-markdown skill registration into `.aetheria/skills/<slug>/SKILL.md` + `skill-meta.json`.
pub fn register_skill_internal(
    raw_name: &str,
    file_path: Option<&str>,
    content_override: Option<&str>,
    custom_desc: Option<&str>,
) -> Result<RegisteredSkill, String> {
    let skills_root = crate::paths::project_root().join(".aetheria").join("skills");
    register_skill_in_root(
        &skills_root,
        raw_name,
        file_path,
        None,
        content_override,
        custom_desc,
        None,
        None,
        None,
    )
}

pub fn register_style_internal(
    raw_name: &str,
    file_path: Option<&str>,
    content_override: Option<&str>,
    custom_desc: Option<&str>,
) -> Result<RegisteredStyle, String> {
    register_skill_internal(raw_name, file_path, content_override, custom_desc)
}

/// Registers a complete declarative skill package (`SKILL.md` + optional `examples/kit.json`,
/// `examples/script/*.js`, `examples/story.example.json`, `assets/kit-gallery.jpg`) into
/// `.aetheria/skills/<slug>/` from:
/// - Mode A: `files[]` multi-file payload
/// - Mode B: `draft_dir` or local directory `file_path` containing `SKILL.md`
/// - Mode C: single `SKILL.md` file path or inline markdown `content`
pub fn register_skill_package_internal(
    raw_name: &str,
    file_path: Option<&str>,
    content_override: Option<&str>,
    custom_desc: Option<&str>,
    files: Option<&[SkillPackageFile]>,
) -> Result<RegisteredSkill, String> {
    register_skill_package_with_meta(
        raw_name,
        file_path,
        None,
        content_override,
        custom_desc,
        None,
        None,
        files,
    )
}

pub fn register_skill_package_with_meta(
    raw_name: &str,
    file_path: Option<&str>,
    draft_dir: Option<&str>,
    content_override: Option<&str>,
    custom_desc: Option<&str>,
    origin: Option<&str>,
    source_video: Option<&str>,
    files: Option<&[SkillPackageFile]>,
) -> Result<RegisteredSkill, String> {
    let skills_root = crate::paths::project_root().join(".aetheria").join("skills");
    register_skill_in_root(
        &skills_root,
        raw_name,
        file_path,
        draft_dir,
        content_override,
        custom_desc,
        origin,
        source_video,
        files,
    )
}

#[allow(clippy::too_many_arguments)]
fn register_skill_in_root(
    skills_root: &Path,
    raw_name: &str,
    file_path: Option<&str>,
    draft_dir: Option<&str>,
    content_override: Option<&str>,
    custom_desc: Option<&str>,
    origin: Option<&str>,
    source_video: Option<&str>,
    files: Option<&[SkillPackageFile]>,
) -> Result<RegisteredSkill, String> {
    let slug = slugify_skill_name(raw_name);
    if slug.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    std::fs::create_dir_all(skills_root)
        .map_err(|e| format!("Failed creating skills root '{}': {}", skills_root.display(), e))?;
    let skill_dir = ensure_writable_skill_target(skills_root, &slug)?;

    // Mode A: Multi-file package upload (`files[]`)
    if let Some(pkg_files) = files {
        if !pkg_files.is_empty() {
            let mut skill_md_text = String::new();
            for f in pkg_files {
                let Some(clean_rel) = is_safe_skill_package_rel(&f.path) else {
                    return Err(format!("Unsafe or unsupported skill package file path: '{}'", f.path));
                };
                if clean_rel.eq_ignore_ascii_case("SKILL.md") {
                    skill_md_text = f.content.clone();
                }
            }
            if skill_md_text.trim().is_empty() {
                return Err("Declarative skill package must include a non-empty `SKILL.md`.".to_string());
            }

            std::fs::create_dir_all(&skill_dir)
                .map_err(|e| format!("Failed creating skill directory '{}': {}", skill_dir.display(), e))?;

            for f in pkg_files {
                let Some(clean_rel) = is_safe_skill_package_rel(&f.path) else {
                    continue;
                };
                let dst = skill_dir.join(&clean_rel);
                if !crate::paths::contains_path(&skill_dir, &dst) {
                    return Err(format!("Skill package path escapes skill directory: '{}'", f.path));
                }
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed creating parent dir for '{}': {}", clean_rel, e))?;
                }
                std::fs::write(&dst, &f.content)
                    .map_err(|e| format!("Failed writing '{}': {}", clean_rel, e))?;
            }

            let has_kit = validate_kit_json_if_present(&skill_dir)?;
            let meta = write_skill_meta(&skill_dir, origin.unwrap_or("custom"), source_video)?;
            return Ok(build_registered_skill(
                &slug,
                &skill_dir,
                &skill_md_text,
                custom_desc,
                &meta,
                has_kit,
            ));
        }
    }

    // Mode B: Draft directory promotion or local skill directory import
    let dir_candidate = draft_dir
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            file_path
                .map(str::trim)
                .filter(|s| !s.is_empty() && Path::new(s).is_dir())
        });
    if let Some(dir_str) = dir_candidate {
        let src = Path::new(dir_str);
        if !src.is_dir() {
            return Err(format!("Skill draft directory not found: '{}'", dir_str));
        }
        let src_skill_md = src.join("SKILL.md");
        if !src_skill_md.is_file() {
            return Err(format!(
                "Skill package directory '{}' must contain a non-empty `SKILL.md`.",
                dir_str
            ));
        }
        let skill_md_text = std::fs::read_to_string(&src_skill_md)
            .map_err(|e| format!("Failed reading '{}': {}", src_skill_md.display(), e))?;
        if skill_md_text.trim().is_empty() {
            return Err(format!("`SKILL.md` inside '{}' is empty.", dir_str));
        }

        std::fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("Failed creating skill directory '{}': {}", skill_dir.display(), e))?;
        let copied = copy_skill_dir_recursive(src, src, &skill_dir)?;
        if copied == 0 {
            return Err(format!("No valid skill package files found in '{}'", dir_str));
        }
        let has_kit = validate_kit_json_if_present(&skill_dir)?;
        let default_origin = if draft_dir.is_some() { "reference" } else { "imported" };
        let meta = write_skill_meta(&skill_dir, origin.unwrap_or(default_origin), source_video)?;
        return Ok(build_registered_skill(
            &slug,
            &skill_dir,
            &skill_md_text,
            custom_desc,
            &meta,
            has_kit,
        ));
    }

    // Mode C: Single markdown file or inline markdown content -> clean SKILL.md (zero legacy Remotion files)
    let raw_md = if let Some(content) = content_override.filter(|c| !c.trim().is_empty()) {
        content.to_string()
    } else if let Some(fp) = file_path.map(str::trim).filter(|s| !s.is_empty()) {
        std::fs::read_to_string(fp)
            .map_err(|e| format!("Failed to read skill file '{}': {}", fp, e))?
    } else {
        return Err("Provide `draft_dir`, `files`, `file_path`, or `content` with a valid SKILL.md.".to_string());
    };

    if raw_md.trim().is_empty() {
        return Err("Skill markdown content is empty".to_string());
    }

    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed creating skill directory '{}': {}", skill_dir.display(), e))?;
    std::fs::write(skill_dir.join("SKILL.md"), &raw_md)
        .map_err(|e| format!("Failed writing SKILL.md for '{}': {}", slug, e))?;
    let meta = write_skill_meta(&skill_dir, origin.unwrap_or("custom"), source_video)?;
    Ok(build_registered_skill(
        &slug,
        &skill_dir,
        &raw_md,
        custom_desc,
        &meta,
        false,
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeleteSkillError {
    InvalidName(String),
    NotFound(String),
    ProtectedBuiltin(String),
    Io(String),
}

impl DeleteSkillError {
    pub fn message(&self) -> &str {
        match self {
            DeleteSkillError::InvalidName(m)
            | DeleteSkillError::NotFound(m)
            | DeleteSkillError::ProtectedBuiltin(m)
            | DeleteSkillError::Io(m) => m,
        }
    }
}

/// Deletes a user-created or reference-created custom skill from `.aetheria/skills/<slug>/`.
/// Refuses to delete protected built-in skills.
pub fn delete_skill_internal(raw_id: &str) -> Result<String, DeleteSkillError> {
    let skills_root = crate::paths::project_root().join(".aetheria").join("skills");
    delete_skill_in_root(&skills_root, raw_id)
}

fn delete_skill_in_root(skills_root: &Path, raw_id: &str) -> Result<String, DeleteSkillError> {
    let trimmed = raw_id.trim();
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(DeleteSkillError::InvalidName(format!(
            "Invalid skill identifier '{}'",
            raw_id
        )));
    }
    let slug = slugify_skill_name(trimmed);
    if slug.is_empty() {
        return Err(DeleteSkillError::InvalidName(
            "Skill id cannot be empty".to_string(),
        ));
    }
    let skill_dir = skills_root.join(&slug);
    if !crate::paths::contains_path(skills_root, &skill_dir) {
        return Err(DeleteSkillError::InvalidName(format!(
            "Skill path '{}' escapes .aetheria/skills/",
            slug
        )));
    }
    if !skill_dir.is_dir() {
        return Err(DeleteSkillError::NotFound(format!(
            "Skill '{}' not found in .aetheria/skills/",
            slug
        )));
    }
    if is_protected_builtin_skill(&skill_dir) {
        return Err(DeleteSkillError::ProtectedBuiltin(format!(
            "Built-in skill '{}' is protected and cannot be deleted.",
            slug
        )));
    }
    std::fs::remove_dir_all(&skill_dir).map_err(|e| {
        DeleteSkillError::Io(format!("Failed deleting skill '{}': {}", slug, e))
    })?;
    Ok(slug)
}

/// POST /api/skills/add (also alias /api/styles/add)
pub async fn handle_add_style(Json(payload): Json<AddSkillPayload>) -> impl IntoResponse {
    match register_skill_package_with_meta(
        &payload.name,
        payload.file_path.as_deref(),
        payload.draft_dir.as_deref(),
        payload.content.as_deref(),
        payload.description.as_deref(),
        payload.origin.as_deref(),
        payload.source_video.as_deref(),
        payload.files.as_deref(),
    ) {
        Ok(skill) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "skill": skill.clone(),
                "style": skill.clone(),
                "message": format!("Skill '{}' successfully registered to .aetheria/skills/! Available as '{}'", skill.name, skill.command)
            })),
        ),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": err
            })),
        ),
    }
}

/// DELETE /api/skills/:id (also alias /api/styles/:id)
pub async fn handle_delete_skill(AxumPath(id): AxumPath<String>) -> impl IntoResponse {
    match delete_skill_internal(&id) {
        Ok(slug) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "deletedId": slug,
                "message": format!("Custom skill '/{}' deleted from .aetheria/skills/.", slug)
            })),
        ),
        Err(err) => {
            let status = match &err {
                DeleteSkillError::InvalidName(_) => StatusCode::BAD_REQUEST,
                DeleteSkillError::NotFound(_) => StatusCode::NOT_FOUND,
                DeleteSkillError::ProtectedBuiltin(_) => StatusCode::FORBIDDEN,
                DeleteSkillError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                Json(json!({
                    "success": false,
                    "error": err.message()
                })),
            )
        }
    }
}

/// GET /api/skills (also alias /api/styles)
/// Exclusively scans .aetheria/skills/ — does NOT read any external skills!
pub async fn handle_list_styles() -> impl IntoResponse {
    let skills = list_all_skills_internal();
    Json(json!({
        "success": true,
        "skills": skills.clone(),
        "styles": skills
    }))
}

/// Scans ONLY `.aetheria/skills/`. Completely isolated from other skills.
pub fn list_all_skills_internal() -> Vec<RegisteredSkill> {
    let target_dir = crate::paths::project_root().join(".aetheria").join("skills");
    list_all_skills_in_root(&target_dir)
}

fn list_all_skills_in_root(target_dir: &Path) -> Vec<RegisteredSkill> {
    let mut skills = Vec::new();
    let mut seen_ids = HashSet::new();

    if !target_dir.is_dir() {
        return skills;
    }

    let Ok(entries) = std::fs::read_dir(target_dir) else {
        return skills;
    };
    let mut sorted: Vec<_> = entries.flatten().collect();
    sorted.sort_by_key(|e| e.file_name());

    for entry in sorted {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let id = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        if id.is_empty() || seen_ids.contains(&id) {
            continue;
        }

        let skill_md = std::fs::read_to_string(p.join("SKILL.md"))
            .or_else(|_| std::fs::read_to_string(p.join("style.md")))
            .or_else(|_| std::fs::read_to_string(p.join("README.md")))
            .unwrap_or_default();

        let (title, desc, fonts) = extract_skill_summary(&skill_md, &id, None);
        let meta = read_skill_meta(&p);
        let (builtin, origin, deletable, source_video) = match meta {
            Some(m) => (!m.deletable, m.origin, m.deletable, m.source_video),
            None => (true, "builtin".to_string(), false, None),
        };
        let has_kit = p.join("examples").join("kit.json").is_file();
        let has_brief = p.join("examples").join("story.example.json").is_file()
            || p.join("SKILL.md").is_file();

        seen_ids.insert(id.clone());
        skills.push(RegisteredSkill {
            id: id.clone(),
            name: title,
            command: format!("/{}", id),
            description: desc,
            path: p.display().to_string(),
            has_brief,
            has_kit,
            builtin,
            origin,
            deletable,
            source_video,
            preview_fonts: fonts,
        });
    }

    skills
}

pub fn list_all_styles_internal() -> Vec<RegisteredStyle> {
    list_all_skills_internal()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_skill_mgr_{}_{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify_skill_name("My Custom Motion Skill"), "my-custom-motion-skill");
        assert_eq!(slugify_skill_name("/cyber-neon-v2"), "cyber-neon-v2");
    }

    #[test]
    fn test_register_package_draft_and_delete_protects_builtins() {
        let tmp = temp_test_dir("pkg_lifecycle");
        let skills_root = tmp.join("skills");
        let draft_dir = tmp.join("draft-skill");
        std::fs::create_dir_all(skills_root.join("mg-builtin-demo")).unwrap();
        std::fs::write(
            skills_root.join("mg-builtin-demo").join("SKILL.md"),
            "# Built-in Demo\n\nProtected built-in style.\n",
        )
        .unwrap();

        // Prepare a declarative draft skill directory
        std::fs::create_dir_all(draft_dir.join("examples").join("script")).unwrap();
        std::fs::create_dir_all(draft_dir.join("assets")).unwrap();
        std::fs::write(
            draft_dir.join("SKILL.md"),
            "---\nname: cobalt-ref\ndescription: Editorial cobalt card style from reference.\n---\n# Cobalt Ref\n",
        )
        .unwrap();
        std::fs::write(
            draft_dir.join("examples").join("kit.json"),
            r#"{"scripts":["script/cobalt-kit.js"]}"#,
        )
        .unwrap();
        std::fs::write(
            draft_dir.join("examples").join("script").join("cobalt-kit.js"),
            "window.CobaltKit = {};",
        )
        .unwrap();
        std::fs::write(draft_dir.join("assets").join("kit-gallery.jpg"), b"fakejpg").unwrap();

        // 1. Promote draft directory to custom skill
        let reg = register_skill_in_root(
            &skills_root,
            "Cobalt Ref",
            None,
            Some(&draft_dir.to_string_lossy()),
            None,
            None,
            Some("reference"),
            Some("ref_pinterest.mp4"),
            None,
        )
        .expect("draft promotion must succeed");

        assert_eq!(reg.id, "cobalt-ref");
        assert_eq!(reg.command, "/cobalt-ref");
        assert!(reg.has_kit);
        assert!(!reg.builtin);
        assert!(reg.deletable);
        assert_eq!(reg.origin, "reference");
        assert_eq!(reg.source_video.as_deref(), Some("ref_pinterest.mp4"));
        assert!(!skills_root.join("cobalt-ref").join("REMOTION_BRIEF.md").exists());
        assert!(skills_root.join("cobalt-ref").join("assets").join("kit-gallery.jpg").is_file());
        assert!(skills_root.join("cobalt-ref").join(SKILL_META_FILE).is_file());

        // 2. Listing distinguishes built-in vs custom reference skill
        let listed = list_all_skills_in_root(&skills_root);
        let builtin_entry = listed.iter().find(|s| s.id == "mg-builtin-demo").unwrap();
        assert!(builtin_entry.builtin);
        assert!(!builtin_entry.deletable);
        let custom_entry = listed.iter().find(|s| s.id == "cobalt-ref").unwrap();
        assert!(!custom_entry.builtin);
        assert!(custom_entry.deletable);
        assert_eq!(custom_entry.origin, "reference");

        // 3. Attempting to overwrite or delete built-in must fail cleanly
        let overwrite_err = register_skill_in_root(
            &skills_root,
            "mg-builtin-demo",
            None,
            None,
            Some("# Hijack"),
            None,
            None,
            None,
            None,
        );
        assert!(overwrite_err.is_err());
        let del_builtin = delete_skill_in_root(&skills_root, "mg-builtin-demo");
        assert!(matches!(del_builtin, Err(DeleteSkillError::ProtectedBuiltin(_))));
        assert!(skills_root.join("mg-builtin-demo").is_dir());

        // 4. Deleting custom reference skill succeeds cleanly
        let deleted = delete_skill_in_root(&skills_root, "cobalt-ref")
            .expect("custom skill deletion must succeed");
        assert_eq!(deleted, "cobalt-ref");
        assert!(!skills_root.join("cobalt-ref").exists());

        // 5. Deleting again returns NotFound
        assert!(matches!(
            delete_skill_in_root(&skills_root, "cobalt-ref"),
            Err(DeleteSkillError::NotFound(_))
        ));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_register_markdown_writes_clean_skill_md_without_remotion_artifacts() {
        let tmp = temp_test_dir("clean_md");
        let skills_root = tmp.join("skills");
        let dummy_md = "# Test Custom Skill\n\nA dynamic user motion skill with custom rules.\n\n**Fonts:** Inter.\n";
        let reg = register_skill_in_root(
            &skills_root,
            "test-custom-skill",
            None,
            None,
            Some(dummy_md),
            Some("A dynamic test motion skill"),
            None,
            None,
            None,
        )
        .expect("Registration must succeed");

        assert_eq!(reg.id, "test-custom-skill");
        assert_eq!(reg.command, "/test-custom-skill");
        assert!(reg.deletable);
        assert!(!reg.builtin);

        let skill_dir = skills_root.join("test-custom-skill");
        assert!(skill_dir.join("SKILL.md").exists());
        assert!(skill_dir.join(SKILL_META_FILE).exists());
        assert!(!skill_dir.join("REMOTION_BRIEF.md").exists());
        assert!(!skill_dir.join("tokens.json").exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
