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
#[serde(rename_all = "camelCase")]
pub struct MicrostockProvenance {
    pub ai_declared: Option<bool>,
    pub declared_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

pub fn load_manifest(ws_root: &Path, project_dir: &Path) -> Result<MicrostockManifest, String> {
    let path = manifest_file_path(ws_root, project_dir)?;
    if !path.is_file() {
        return Ok(MicrostockManifest::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed reading manifest {}: {}", path.display(), e))?;
    serde_json::from_str::<MicrostockManifest>(&raw)
        .map_err(|e| format!("Invalid manifest JSON in {}: {}", path.display(), e))
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
}
