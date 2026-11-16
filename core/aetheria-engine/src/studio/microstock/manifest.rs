//! Per-project Adobe Stock Microstock manifest (`<project>/microstock/manifest.json`).

use super::adobe_profile::RuleSeverity;
use crate::paths::{contains_path, now_iso};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightItem {
    pub code: String,
    pub severity: RuleSeverity,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub status: String, // "blocked" | "fail" | "warn" | "pass"
    pub checked_at: String,
    pub promoted_to_ready: bool,
    pub ready_path: Option<String>,
    pub items: Vec<PreflightItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct MicrostockProvenance {
    pub ai_declared: Option<bool>,
    pub declared_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct MicrostockChecklist {
    pub no_logos_or_brands: bool,
    pub no_artist_or_ip_names: bool,
    pub no_identifiable_people_or_property: bool,
    pub no_third_party_fonts_or_graphics_without_license: bool,
}

impl MicrostockChecklist {
    pub fn is_complete(&self) -> bool {
        self.no_logos_or_brands
            && self.no_artist_or_ip_names
            && self.no_identifiable_people_or_property
            && self.no_third_party_fonts_or_graphics_without_license
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct MicrostockMetadata {
    pub title: String,
    pub keywords: Vec<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockLicenseEntry {
    pub kind: String,
    pub name: String,
    pub source: String,
    pub license: String,
    pub proof_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockRenderRecord {
    pub file: String,
    pub sha256: String,
    pub preset: String,
    pub preflight: PreflightReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockManifest {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_codec")]
    pub codec: String,
    #[serde(default)]
    pub is_loop: bool,
    #[serde(default)]
    pub provenance: MicrostockProvenance,
    #[serde(default)]
    pub checklist: MicrostockChecklist,
    #[serde(default)]
    pub metadata: MicrostockMetadata,
    #[serde(default)]
    pub licenses: Vec<MicrostockLicenseEntry>,
    #[serde(default)]
    pub renders: Vec<MicrostockRenderRecord>,
}

fn default_schema_version() -> u32 {
    1
}
fn default_preset() -> String {
    "1920x1080".to_string()
}
fn default_fps() -> u32 {
    30
}
fn default_codec() -> String {
    "h264".to_string()
}

impl Default for MicrostockManifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            enabled: false,
            preset: default_preset(),
            fps: default_fps(),
            codec: default_codec(),
            is_loop: false,
            provenance: MicrostockProvenance {
                ai_declared: None,
                declared_at: None,
            },
            checklist: MicrostockChecklist::default(),
            metadata: MicrostockMetadata::default(),
            licenses: Vec::new(),
            renders: Vec::new(),
        }
    }
}

/// Resolves the isolated target project directory inside `ws_root`.
pub fn resolve_microstock_project_dir(
    ws_root: &Path,
    project: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(slug_raw) = project.map(str::trim).filter(|s| !s.is_empty()) {
        if slug_raw == "__root__" || slug_raw == "." {
            return Ok(ws_root.to_path_buf());
        }
        if slug_raw.contains("..") || slug_raw.contains('/') || slug_raw.contains('\\') {
            return Err("Invalid project slug: path traversal is not allowed".to_string());
        }
        let candidate = ws_root.join("projects").join(slug_raw);
        if !contains_path(ws_root, &candidate) {
            return Err("Access Denied: project folder escapes workspace".to_string());
        }
        return Ok(candidate);
    }

    // Check `.aetheria/active-project.json` marker when no explicit project slug was given.
    let marker_path = ws_root.join(".aetheria").join("active-project.json");
    if let Ok(raw) = std::fs::read_to_string(&marker_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(active) = val.get("project").and_then(|v| v.as_str()) {
                let clean = active.trim();
                if !clean.is_empty() && clean != "__root__" && !clean.contains("..") {
                    let candidate = ws_root.join("projects").join(clean);
                    if contains_path(ws_root, &candidate) && candidate.is_dir() {
                        return Ok(candidate);
                    }
                }
            }
        }
    }

    Ok(ws_root.to_path_buf())
}

pub fn manifest_file_path(ws_root: &Path, project_dir: &Path) -> Result<PathBuf, String> {
    let path = project_dir.join("microstock").join("manifest.json");
    if !contains_path(ws_root, &path) {
        return Err("Access Denied: manifest path escapes workspace".to_string());
    }
    Ok(path)
}

const WORKSPACE_MODE_REL: &str = ".aetheria/microstock-mode.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrostockWorkspaceMode {
    pub enabled: bool,
    pub preset: String,
    pub fps: u32,
}

fn workspace_mode_file_path(ws_root: &Path) -> Result<PathBuf, String> {
    let path = ws_root.join(".aetheria").join("microstock-mode.json");
    if !contains_path(ws_root, &path) {
        return Err("Access Denied: microstock mode path escapes workspace".to_string());
    }
    Ok(path)
}

pub fn load_workspace_mode(ws_root: &Path) -> Option<MicrostockWorkspaceMode> {
    let path = workspace_mode_file_path(ws_root).ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<MicrostockWorkspaceMode>(&raw).ok()
}

pub fn save_workspace_mode(
    ws_root: &Path,
    enabled: bool,
    preset: &str,
    fps: u32,
) -> Result<(), String> {
    let path = workspace_mode_file_path(ws_root)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed creating {}: {}", parent.display(), e))?;
    }
    let payload = MicrostockWorkspaceMode {
        enabled,
        preset: preset.to_string(),
        fps,
    };
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed serializing {}: {}", WORKSPACE_MODE_REL, e))?;
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed writing {}: {}", path.display(), e))?;
    Ok(())
}

pub fn derive_keywords_from_title_and_slug(title: &str, slug: &str) -> Vec<String> {
    let stop_words = [
        "and", "the", "for", "with", "from", "into", "microstock", "animasi", "buat", "render",
        "nanti", "video", "stage", "extracted", "file", "html",
    ];
    let mut out: Vec<String> = Vec::new();
    let combined = format!("{} {}", title, slug.replace('-', " ").replace('_', " "));
    for raw_tok in combined.split(|c: char| !c.is_ascii_alphanumeric()) {
        let tok = raw_tok.trim().to_ascii_lowercase();
        if tok.len() >= 3
            && !stop_words.contains(&tok.as_str())
            && !out.iter().any(|k| k == &tok)
        {
            out.push(tok);
        }
    }
    for fallback in [
        "animation",
        "background",
        "motion",
        "graphics",
        "illustration",
        "vector",
        "celebration",
        "holiday",
        "festive",
        "seamless",
        "loop",
    ] {
        if out.len() >= 15 {
            break;
        }
        if !out.iter().any(|k| k == fallback) {
            out.push(fallback.to_string());
        }
    }
    out.truncate(25);
    out
}

fn normalize_manifest_json_value(mut val: serde_json::Value) -> serde_json::Value {
    let Some(obj) = val.as_object_mut() else {
        return val;
    };

    // 1. Normalize `provenance` if LLM wrote a string/boolean instead of `{ aiDeclared, declaredAt }`
    if let Some(prov) = obj.get("provenance").cloned() {
        if !prov.is_object() {
            let ai_dec = match prov {
                serde_json::Value::Bool(b) => Some(b),
                serde_json::Value::String(_) => Some(false),
                _ => None,
            };
            obj.insert(
                "provenance".to_string(),
                serde_json::json!({
                    "aiDeclared": ai_dec,
                    "declaredAt": ai_dec.map(|_| now_iso())
                }),
            );
        }
    }

    // 2. Normalize `checklist` if LLM wrote custom keys like `ZERO_TEXT: true`
    if let Some(cl_val) = obj.get("checklist").cloned() {
        if let Some(cl_obj) = cl_val.as_object() {
            let has_standard = cl_obj.contains_key("noLogosOrBrands")
                || cl_obj.contains_key("noArtistOrIpNames");
            if !has_standard && cl_obj.values().any(|v| v.as_bool() == Some(true)) {
                obj.insert(
                    "checklist".to_string(),
                    serde_json::json!({
                        "noLogosOrBrands": true,
                        "noArtistOrIpNames": true,
                        "noIdentifiablePeopleOrProperty": true,
                        "noThirdPartyFontsOrGraphicsWithoutLicense": true
                    }),
                );
            }
        }
    }

    // 3. Lift top-level `title`, `keywords`/`tags`, `category` into `metadata` if `metadata` is missing/empty
    let top_title = obj
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let top_category = obj
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let top_keywords: Option<Vec<String>> = obj
        .get("keywords")
        .or_else(|| obj.get("tags"))
        .and_then(|v| {
            if let Some(arr) = v.as_array() {
                let list: Vec<String> = arr
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect();
                if list.is_empty() { None } else { Some(list) }
            } else if let Some(s) = v.as_str() {
                let list: Vec<String> = s
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                if list.is_empty() { None } else { Some(list) }
            } else {
                None
            }
        });

    let meta_entry = obj
        .entry("metadata".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !meta_entry.is_object() {
        *meta_entry = serde_json::json!({});
    }
    if let Some(meta_obj) = meta_entry.as_object_mut() {
        let cur_title_empty = meta_obj
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().is_empty())
            .unwrap_or(true);
        if cur_title_empty {
            if let Some(t) = top_title {
                meta_obj.insert("title".to_string(), serde_json::Value::String(t));
            }
        }
        let cur_kw_empty = meta_obj
            .get("keywords")
            .and_then(|v| v.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        if cur_kw_empty {
            if let Some(kws) = top_keywords {
                meta_obj.insert("keywords".to_string(), serde_json::json!(kws));
            }
        }
        let cur_cat_empty = meta_obj
            .get("category")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().is_empty())
            .unwrap_or(true);
        if cur_cat_empty {
            if let Some(cat) = top_category {
                meta_obj.insert("category".to_string(), serde_json::Value::String(cat));
            }
        }
    }

    val
}

fn auto_backfill_project_metadata_if_empty(
    ws_root: &Path,
    project_dir: &Path,
    manifest: &mut MicrostockManifest,
) {
    let is_named_project = project_dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        == Some("projects");
    if !is_named_project {
        return;
    }
    let index_path = project_dir.join("index.html");
    if !index_path.is_file() {
        return;
    }
    let needs_title = manifest.metadata.title.trim().is_empty();
    let needs_keywords = manifest.metadata.keywords.len() < 5;
    if !needs_title && !needs_keywords {
        return;
    }

    let slug = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("motion-graphic");
    let film = crate::studio::film_inspector::inspect_workspace_film(&index_path);
    let raw_title = if !film.title.trim().is_empty() {
        film.title
    } else {
        slug.replace('-', " ")
    };
    let clean_title: String = raw_title
        .replace(',', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(70)
        .collect();

    if needs_title && !clean_title.is_empty() {
        manifest.metadata.title = clean_title.clone();
    }
    if needs_keywords {
        manifest.metadata.keywords =
            derive_keywords_from_title_and_slug(&manifest.metadata.title, slug);
    }
    if manifest.metadata.category.trim().is_empty() {
        manifest.metadata.category = "Graphic resources".to_string();
    }
    let _ = save_manifest(ws_root, project_dir, manifest);
}

pub fn load_manifest(ws_root: &Path, project_dir: &Path) -> Result<MicrostockManifest, String> {
    let path = manifest_file_path(ws_root, project_dir)?;
    if !path.is_file() {
        let mut fallback = MicrostockManifest::default();
        if let Some(ws_mode) = load_workspace_mode(ws_root) {
            fallback.enabled = ws_mode.enabled;
            fallback.preset = ws_mode.preset;
            fallback.fps = ws_mode.fps;
        }
        auto_backfill_project_metadata_if_empty(ws_root, project_dir, &mut fallback);
        return Ok(fallback);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed reading manifest {}: {}", path.display(), e))?;
    let val: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid manifest JSON in {}: {}", path.display(), e))?;
    let normalized = normalize_manifest_json_value(val);
    let mut manifest: MicrostockManifest = serde_json::from_value(normalized)
        .map_err(|e| format!("Invalid manifest structure in {}: {}", path.display(), e))?;
    auto_backfill_project_metadata_if_empty(ws_root, project_dir, &mut manifest);
    Ok(manifest)
}

pub fn save_manifest(
    ws_root: &Path,
    project_dir: &Path,
    manifest: &MicrostockManifest,
) -> Result<PathBuf, String> {
    let path = manifest_file_path(ws_root, project_dir)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed creating {}: {}", parent.display(), e))?;
    }
    let serialized = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed serializing manifest: {}", e))?;
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed writing manifest {}: {}", path.display(), e))?;
    Ok(path)
}

pub fn set_ai_declaration(manifest: &mut MicrostockManifest, ai_declared: Option<bool>) {
    manifest.provenance.ai_declared = ai_declared;
    manifest.provenance.declared_at = ai_declared.map(|_| now_iso());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_manifest_requires_explicit_ai_declaration_and_checklist() {
        let m = MicrostockManifest::default();
        assert_eq!(m.provenance.ai_declared, None);
        assert_eq!(m.provenance.declared_at, None);
        assert!(!m.checklist.is_complete());
    }

    #[test]
    fn normalize_manifest_json_lifts_top_level_llm_metadata_and_repairs_provenance() {
        let raw = serde_json::json!({
            "title": "Happy New Year 2027 City Skyline & Fireworks",
            "keywords": ["new year", "2027", "city", "skyline", "fireworks"],
            "provenance": "adobe-stock-microstock-mode",
            "ai_generated": false
        });
        let normalized = normalize_manifest_json_value(raw);
        let m: MicrostockManifest = serde_json::from_value(normalized).unwrap();
        assert_eq!(
            m.metadata.title,
            "Happy New Year 2027 City Skyline & Fireworks"
        );
        assert_eq!(m.metadata.keywords.len(), 5);
        assert_eq!(m.provenance.ai_declared, Some(false));

        let derived = derive_keywords_from_title_and_slug(
            "Happy New Year 2027 City Skyline & Fireworks - Microstock",
            "animasi-happy-new-year-2027",
        );
        assert!(derived.len() >= 5);
        assert!(derived.contains(&"fireworks".to_string()));
    }
}
