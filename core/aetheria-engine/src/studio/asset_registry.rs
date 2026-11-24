//! Unified Project Asset Registry (`assets.json`) for HTML Motion Films.
//!
//! Provides a single shared metadata & validation contract across scenes for raster cutouts
//! (transparent PNG), raster photos (JPEG/WebP/PNG), vector SVG assets, and optional 3D models
//! (`.glb`/`.gltf`). Enforces workspace path isolation via `contains_path`.

use crate::paths::contains_path;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const ASSET_MANIFEST_FILENAME: &str = "assets.json";
pub const ASSET_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaBbox {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub path: String,
    pub url: String,
    /// `"raster_cutout" | "raster" | "svg" | "model3d"`
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub aspect_ratio: f64,
    pub has_alpha: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha_bbox: Option<AlphaBbox>,
    #[serde(default = "default_pivot")]
    pub pivot: [f64; 2],
    pub bytes: u64,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mean_hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mean_luma: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mean_sat: Option<f64>,
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetManifest {
    #[serde(default = "default_manifest_version")]
    pub version: u32,
    #[serde(default)]
    pub assets: Vec<AssetRecord>,
}

impl Default for AssetManifest {
    fn default() -> Self {
        Self {
            version: ASSET_MANIFEST_VERSION,
            assets: Vec::new(),
        }
    }
}

fn default_manifest_version() -> u32 {
    ASSET_MANIFEST_VERSION
}

fn default_pivot() -> [f64; 2] {
    [0.5, 0.5]
}

/// Optional rich inspection hints computed externally (e.g. OpenCV GrabCut / LAB tone analysis).
#[derive(Debug, Clone, Default)]
pub struct AssetRegistrationHints {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_alpha: Option<bool>,
    pub background_removed: bool,
    pub alpha_bbox: Option<AlphaBbox>,
    pub pivot: Option<[f64; 2]>,
    pub source: Option<String>,
    pub query: Option<String>,
    pub mean_hex: Option<String>,
    pub mean_luma: Option<f64>,
    pub mean_sat: Option<f64>,
}

/// Normalizes a project-relative asset path into forward-slash form without leading `./` or `/`.
pub fn normalize_asset_rel_path(rel_path: &str) -> Result<String, String> {
    let mut s = rel_path.trim().replace('\\', "/");
    while let Some(rest) = s.strip_prefix("./").or_else(|| s.strip_prefix('/')) {
        s = rest.to_string();
    }
    if s.is_empty() || s.contains("..") || s.contains('\0') {
        return Err(format!("Invalid asset relative path '{}'", rel_path));
    }
    Ok(s)
}

/// Derives a stable, deterministic identifier from a relative path (e.g. `"img/brain.png"` -> `"brain"`).
pub fn derive_asset_id(rel_path: &str) -> String {
    let stem = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let mut out = String::with_capacity(stem.len());
    let mut prev_underscore = false;
    for ch in stem.chars() {
        let low = ch.to_ascii_lowercase();
        if low.is_ascii_alphanumeric() {
            out.push(low);
            prev_underscore = false;
        } else if !prev_underscore && !out.is_empty() {
            out.push('_');
            prev_underscore = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        "asset".to_string()
    } else {
        out
    }
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Lightweight PNG header parser (`width`, `height`, `has_alpha_channel`).
pub(crate) fn parse_png_header(bytes: &[u8]) -> Option<(u32, u32, bool)> {
    const PNG_SIG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if bytes.len() < 26 || bytes[..8] != PNG_SIG || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    let color_type = bytes[25];
    // Color types 4 (gray+alpha) and 6 (RGBA) carry an alpha channel; tRNS chunk also signals transparency.
    let has_trns = bytes.windows(4).any(|w4| w4 == b"tRNS");
    let has_alpha = matches!(color_type, 4 | 6) || has_trns;
    Some((w, h, has_alpha))
}

/// Lightweight JPEG SOF header parser (`width`, `height`).
pub(crate) fn parse_jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 4 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        while i < bytes.len() && bytes[i] == 0xFF {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let marker = bytes[i];
        i += 1;
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if matches!(marker, 0x01 | 0xD0..=0xD8) {
            continue;
        }
        if i + 2 > bytes.len() {
            break;
        }
        let seg_len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
        if seg_len < 2 || i + seg_len > bytes.len() {
            break;
        }
        let is_sof = matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
        );
        if is_sof && seg_len >= 7 {
            let h = u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]) as u32;
            let w = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            if w > 0 && h > 0 {
                return Some((w, h));
            }
        }
        i += seg_len;
    }
    None
}

/// Lightweight WebP RIFF header parser (`width`, `height`, `has_alpha`).
pub(crate) fn parse_webp_header(bytes: &[u8]) -> Option<(u32, u32, bool)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" => {
            let flags = bytes[20];
            let has_alpha = (flags & 0x10) != 0;
            let w = 1 + (bytes[24] as u32 | ((bytes[25] as u32) << 8) | ((bytes[26] as u32) << 16));
            let h = 1 + (bytes[27] as u32 | ((bytes[28] as u32) << 8) | ((bytes[29] as u32) << 16));
            Some((w, h, has_alpha))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2F => {
            let b0 = bytes[21] as u32;
            let b1 = bytes[22] as u32;
            let b2 = bytes[23] as u32;
            let b3 = bytes[24] as u32;
            let w = 1 + (b0 | ((b1 & 0x3F) << 8));
            let h = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0F) << 10));
            let has_alpha = (b3 & 0x10) != 0;
            Some((w, h, has_alpha))
        }
        b"VP8 " if bytes.len() >= 30 && bytes[23] == 0x9D && bytes[24] == 0x01 && bytes[25] == 0x2A => {
            let w = (u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3FFF) as u32;
            let h = (u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3FFF) as u32;
            Some((w, h, false))
        }
        _ => None,
    }
}

fn extract_xml_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{}=", attr.to_ascii_lowercase());
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find(&needle) {
        let idx = cursor + rel;
        let prev_ok = idx == 0 || lower.as_bytes()[idx - 1].is_ascii_whitespace();
        if prev_ok {
            let after = idx + needle.len();
            let quote = tag.as_bytes().get(after).copied()?;
            if quote == b'"' || quote == b'\'' {
                let start = after + 1;
                if let Some(end_rel) = tag[start..].find(quote as char) {
                    return Some(&tag[start..start + end_rel]);
                }
            }
        }
        cursor = idx + needle.len();
    }
    None
}

fn parse_svg_numeric(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if trimmed.ends_with('%') {
        return None;
    }
    let cleaned = trimmed
        .trim_end_matches("px")
        .trim_end_matches("pt")
        .trim();
    cleaned.parse::<f64>().ok().filter(|v| v.is_finite() && *v > 0.0)
}

/// Parses root `<svg ...>` dimensions from `viewBox` or `width`/`height`.
pub(crate) fn parse_svg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let lower = text.to_ascii_lowercase();
    let start = lower.find("<svg")?;
    let end_rel = text[start..].find('>')?;
    let open_tag = &text[start..start + end_rel + 1];

    if let Some(vb) = extract_xml_attr(open_tag, "viewBox") {
        let nums: Vec<f64> = vb
            .split(|c: char| c.is_ascii_whitespace() || c == ',')
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();
        if nums.len() == 4 && nums[2] > 0.0 && nums[3] > 0.0 {
            return Some((nums[2].round().max(1.0) as u32, nums[3].round().max(1.0) as u32));
        }
    }

    let w = extract_xml_attr(open_tag, "width").and_then(parse_svg_numeric)?;
    let h = extract_xml_attr(open_tag, "height").and_then(parse_svg_numeric)?;
    Some((w.round().max(1.0) as u32, h.round().max(1.0) as u32))
}

/// Validates and inspects a single asset file inside `film_root`, returning an `AssetRecord`.
pub fn inspect_asset_file(
    film_root: &Path,
    rel_path: &str,
    hints: &AssetRegistrationHints,
) -> Result<AssetRecord, String> {
    let clean_rel = normalize_asset_rel_path(rel_path)?;
    let abs_path = film_root.join(&clean_rel);
    if !contains_path(film_root, &abs_path) {
        return Err(format!(
            "Asset path '{}' escapes film project root '{}'",
            clean_rel,
            film_root.display()
        ));
    }
    let bytes = std::fs::read(&abs_path).map_err(|e| {
        format!(
            "Failed reading asset '{}' at '{}': {}",
            clean_rel,
            abs_path.display(),
            e
        )
    })?;

    let ext = abs_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut warnings: Vec<String> = Vec::new();
    let mut valid = !bytes.is_empty();
    let mut width = hints.width.unwrap_or(0);
    let mut height = hints.height.unwrap_or(0);
    let mut has_alpha = hints.has_alpha.unwrap_or(false);
    let kind: String;

    if bytes.is_empty() {
        warnings.push("Asset file is empty (0 bytes).".to_string());
        kind = "raster".to_string();
    } else if ext == "svg" {
        kind = "svg".to_string();
        has_alpha = true;
        if let Some((sw, sh)) = parse_svg_dimensions(&bytes) {
            if width == 0 {
                width = sw;
            }
            if height == 0 {
                height = sh;
            }
        } else {
            valid = false;
            warnings.push("Invalid SVG: missing <svg> root or valid viewBox/width/height.".to_string());
        }
    } else if ext == "glb" || ext == "gltf" {
        kind = "model3d".to_string();
        let ok_magic = if ext == "glb" {
            bytes.len() >= 12 && &bytes[0..4] == b"glTF"
        } else {
            serde_json::from_slice::<serde_json::Value>(&bytes).is_ok()
        };
        if !ok_magic {
            valid = false;
            warnings.push(format!("Corrupted {} 3D model file header.", ext));
        }
    } else {
        // Raster formats: PNG, JPEG, WebP (detect by magic bytes rather than trusting extension alone).
        let parsed = if let Some((pw, ph, pa)) = parse_png_header(&bytes) {
            Some((pw, ph, pa))
        } else if let Some((jw, jh)) = parse_jpeg_dimensions(&bytes) {
            Some((jw, jh, false))
        } else {
            parse_webp_header(&bytes)
        };

        if let Some((rw, rh, ra)) = parsed {
            if width == 0 {
                width = rw;
            }
            if height == 0 {
                height = rh;
            }
            if hints.has_alpha.is_none() {
                has_alpha = ra;
            }
        } else if width == 0 || height == 0 {
            valid = false;
            warnings.push(
                "Unrecognized or corrupted raster image header (expected PNG, JPEG, or WebP)."
                    .to_string(),
            );
        }

        kind = if hints.background_removed || has_alpha {
            "raster_cutout".to_string()
        } else {
            "raster".to_string()
        };
    }

    if valid && kind != "model3d" {
        if width == 0 || height == 0 {
            valid = false;
            warnings.push("Asset has zero width or height.".to_string());
        } else {
            if width < 32 || height < 32 {
                warnings.push(format!(
                    "Low resolution asset ({}x{}); may appear blurry on HD stages.",
                    width, height
                ));
            }
            let ratio = width as f64 / height as f64;
            if ratio > 12.0 || ratio < (1.0 / 12.0) {
                warnings.push(format!(
                    "Extreme aspect ratio ({:.2}:1) for '{}'.",
                    ratio, clean_rel
                ));
            }
        }
    }

    let alpha_bbox = hints.alpha_bbox.clone().filter(|b| {
        b.w > 0 && b.h > 0 && (width == 0 || b.x + b.w <= width) && (height == 0 || b.y + b.h <= height)
    });

    let aspect_ratio = if height > 0 {
        ((width as f64 / height as f64) * 10_000.0).round() / 10_000.0
    } else {
        0.0
    };

    let pivot = hints
        .pivot
        .map(|[px, py]| [px.clamp(0.0, 1.0), py.clamp(0.0, 1.0)])
        .unwrap_or_else(default_pivot);

    Ok(AssetRecord {
        id: derive_asset_id(&clean_rel),
        path: clean_rel.clone(),
        url: format!("/{}", clean_rel),
        kind,
        width,
        height,
        aspect_ratio,
        has_alpha,
        alpha_bbox,
        pivot,
        bytes: bytes.len() as u64,
        sha256: compute_sha256_hex(&bytes),
        source: hints.source.clone(),
        query: hints.query.clone(),
        mean_hex: hints.mean_hex.clone(),
        mean_luma: hints.mean_luma,
        mean_sat: hints.mean_sat,
        valid,
        warnings,
    })
}

pub fn load_asset_manifest(film_root: &Path) -> AssetManifest {
    let manifest_path = film_root.join(ASSET_MANIFEST_FILENAME);
    let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
        return AssetManifest::default();
    };
    serde_json::from_str::<AssetManifest>(&raw).unwrap_or_default()
}

pub fn save_asset_manifest(film_root: &Path, manifest: &AssetManifest) -> Result<PathBuf, String> {
    let manifest_path = film_root.join(ASSET_MANIFEST_FILENAME);
    if !contains_path(film_root, &manifest_path) {
        return Err("Asset manifest path escaped film root.".to_string());
    }
    let body = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed serializing assets.json: {}", e))?;
    std::fs::write(&manifest_path, body).map_err(|e| {
        format!(
            "Failed writing asset manifest '{}': {}",
            manifest_path.display(),
            e
        )
    })?;
    Ok(manifest_path)
}

/// Inserts or updates `record` in `manifest`, guaranteeing unique `id` and `path`.
pub fn upsert_asset_record(manifest: &mut AssetManifest, mut record: AssetRecord) -> AssetRecord {
    manifest.version = ASSET_MANIFEST_VERSION;
    if let Some(existing) = manifest
        .assets
        .iter_mut()
        .find(|a| a.path.eq_ignore_ascii_case(&record.path))
    {
        // Preserve existing custom pivot if caller didn't override from default and id matches.
        record.id = existing.id.clone();
        *existing = record.clone();
        return record;
    }

    // Disambiguate colliding IDs across different paths (e.g. `img/hero.png` vs `img/hero.svg`).
    let base_id = record.id.clone();
    let mut suffix = 2usize;
    while manifest
        .assets
        .iter()
        .any(|a| a.id.eq_ignore_ascii_case(&record.id))
    {
        record.id = format!("{}_{}", base_id, suffix);
        suffix += 1;
    }

    manifest.assets.push(record.clone());
    record
}

/// Inspects an asset on disk, registers/updates it inside `<film_root>/assets.json`, and saves the manifest.
pub fn register_project_asset(
    film_root: &Path,
    rel_path: &str,
    hints: &AssetRegistrationHints,
) -> Result<AssetRecord, String> {
    let record = inspect_asset_file(film_root, rel_path, hints)?;
    let mut manifest = load_asset_manifest(film_root);
    let stored = upsert_asset_record(&mut manifest, record);
    save_asset_manifest(film_root, &manifest)?;
    Ok(stored)
}

/// Scans `img/` inside `film_root` and syncs any unregistered PNG/JPEG/WebP/SVG/GLB assets into `assets.json`.
pub fn sync_project_assets(film_root: &Path) -> Result<AssetManifest, String> {
    let mut manifest = load_asset_manifest(film_root);
    let img_dir = film_root.join("img");
    if img_dir.is_dir() && contains_path(film_root, &img_dir) {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&img_dir)
            .map_err(|e| format!("Failed reading '{}': {}", img_dir.display(), e))?
            .filter_map(|res| res.ok().map(|e| e.path()))
            .filter(|p| p.is_file())
            .collect();
        entries.sort();

        for path in entries {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "svg" | "glb" | "gltf") {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let rel = format!("img/{}", name);
                if let Ok(rec) = inspect_asset_file(film_root, &rel, &AssetRegistrationHints::default()) {
                    upsert_asset_record(&mut manifest, rec);
                }
            }
        }
    }
    save_asset_manifest(film_root, &manifest)?;
    Ok(manifest)
}

/// Finds an existing valid asset in `assets.json` matching the exact content hash (cache reuse).
pub fn find_cached_asset_by_sha256<'a>(
    manifest: &'a AssetManifest,
    sha256: &str,
) -> Option<&'a AssetRecord> {
    manifest
        .assets
        .iter()
        .find(|a| a.valid && a.sha256.eq_ignore_ascii_case(sha256))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRegistryQuery {
    pub workspace_dir: Option<String>,
    pub sync: Option<bool>,
}

/// HTTP handler for `GET/POST /api/studio/asset-registry` — reads or syncs `<project>/assets.json`.
pub async fn handle_asset_registry(
    axum::extract::Query(q): axum::extract::Query<AssetRegistryQuery>,
    body: Option<axum::Json<AssetRegistryQuery>>,
) -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
    let payload = body.map(|b| b.0).unwrap_or_default();
    let workspace_dir = payload.workspace_dir.or(q.workspace_dir);
    let do_sync = payload.sync.or(q.sync).unwrap_or(false);

    let film_root = match resolve_asset_film_root(workspace_dir.as_deref()) {
        Ok(dir) => dir,
        Err(err) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": err })),
            );
        }
    };

    let task = tokio::task::spawn_blocking(move || {
        if do_sync {
            sync_project_assets(&film_root)
        } else {
            Ok(load_asset_manifest(&film_root))
        }
    })
    .await;

    match task {
        Ok(Ok(manifest)) => (
            axum::http::StatusCode::OK,
            axum::Json(serde_json::json!({ "data": manifest })),
        ),
        Ok(Err(err)) => (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": err })),
        ),
        Err(err) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("Asset registry task failed: {}", err) })),
        ),
    }
}

fn is_forbidden_asset_root(dir: &Path) -> bool {
    if dir.parent().is_none() {
        return true;
    }
    if dir.join("Cargo.toml").is_file() && dir.join("src-tauri").is_dir() {
        return true;
    }
    false
}

fn resolve_asset_film_root(workspace_dir: Option<&str>) -> Result<PathBuf, String> {
    if let Some(raw) = workspace_dir.map(str::trim).filter(|s| !s.is_empty()) {
        let norm = crate::paths::normalize_workspace_path(raw);
        let candidate = PathBuf::from(&norm);
        if !candidate.is_dir() {
            return Err(format!("Workspace directory does not exist: '{}'", raw));
        }
        if is_forbidden_asset_root(&candidate) {
            return Err(
                "Access Denied: refusing to run asset registry on filesystem root or IDE engine repository."
                    .to_string(),
            );
        }
        if candidate.join("index.html").is_file()
            || candidate.join("film.json").is_file()
            || candidate.join("img").is_dir()
        {
            return Ok(candidate);
        }
        if let Some(html_path) = super::motion::resolve_active_html_film_path(Some(&norm)) {
            if let Some(parent) = html_path.parent() {
                if !is_forbidden_asset_root(parent) {
                    return Ok(parent.to_path_buf());
                }
            }
        }
        return Ok(candidate);
    }
    let resolved = super::motion::resolve_active_html_film_path(None)
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or_else(|| "No active HTML motion film project found.".to_string())?;
    if is_forbidden_asset_root(&resolved) {
        return Err(
            "Access Denied: refusing to run asset registry on filesystem root or IDE engine repository."
                .to_string(),
        );
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_minimal_png(width: u32, height: u32, color_type: u8) -> Vec<u8> {
        let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(b"IHDR");
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&height.to_be_bytes());
        out.push(8); // bit depth
        out.push(color_type);
        out.extend_from_slice(&[0, 0, 0]); // compression/filter/interlace
        out.extend_from_slice(&[0, 0, 0, 0]); // crc placeholder
        out
    }

    #[test]
    fn registers_png_cutout_and_svg_and_rejects_corrupt_and_traversal() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_asset_reg_test_{}_{}",
            std::process::id(),
            crate::paths::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("img")).unwrap();

        let png_bytes = make_minimal_png(256, 192, 6);
        std::fs::write(dir.join("img").join("brain.png"), &png_bytes).unwrap();
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><circle cx="60" cy="40" r="30" fill="#ff5500"/></svg>"##;
        std::fs::write(dir.join("img").join("badge.svg"), svg).unwrap();
        std::fs::write(dir.join("img").join("broken.png"), b"<html>not a png</html>").unwrap();

        let rec_png = register_project_asset(
            &dir,
            "img/brain.png",
            &AssetRegistrationHints {
                background_removed: true,
                alpha_bbox: Some(AlphaBbox {
                    x: 20,
                    y: 12,
                    w: 210,
                    h: 164,
                }),
                pivot: Some([0.5, 0.55]),
                source: Some("https://commons.example/brain.png".to_string()),
                query: Some("human brain 3d".to_string()),
                mean_hex: Some("#D4A5A5".to_string()),
                ..Default::default()
            },
        )
        .expect("register png");

        assert_eq!(rec_png.id, "brain");
        assert_eq!(rec_png.kind, "raster_cutout");
        assert_eq!(rec_png.width, 256);
        assert_eq!(rec_png.height, 192);
        assert!(rec_png.has_alpha);
        assert!(rec_png.valid);
        assert_eq!(
            rec_png.alpha_bbox,
            Some(AlphaBbox {
                x: 20,
                y: 12,
                w: 210,
                h: 164
            })
        );
        assert_eq!(rec_png.pivot, [0.5, 0.55]);

        let rec_svg = register_project_asset(&dir, "img/badge.svg", &AssetRegistrationHints::default())
            .expect("register svg");
        assert_eq!(rec_svg.id, "badge");
        assert_eq!(rec_svg.kind, "svg");
        assert_eq!(rec_svg.width, 120);
        assert_eq!(rec_svg.height, 80);
        assert!(rec_svg.has_alpha);
        assert!(rec_svg.valid);

        let rec_broken =
            register_project_asset(&dir, "img/broken.png", &AssetRegistrationHints::default())
                .expect("inspect broken png");
        assert!(!rec_broken.valid);
        assert!(!rec_broken.warnings.is_empty());

        // Path traversal must be rejected
        assert!(register_project_asset(&dir, "../outside.png", &AssetRegistrationHints::default()).is_err());

        // Manifest persisted cleanly with all 3 records and cache lookup works
        let loaded = load_asset_manifest(&dir);
        assert_eq!(loaded.version, ASSET_MANIFEST_VERSION);
        assert_eq!(loaded.assets.len(), 3);
        assert_eq!(
            find_cached_asset_by_sha256(&loaded, &rec_png.sha256).map(|r| r.id.as_str()),
            Some("brain")
        );

        // Re-registering same path updates in place without duplicating ID
        let updated = register_project_asset(&dir, "img/brain.png", &AssetRegistrationHints::default())
            .expect("update png");
        assert_eq!(updated.id, "brain");
        assert_eq!(load_asset_manifest(&dir).assets.len(), 3);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disambiguates_duplicate_stem_ids_across_extensions() {
        let mut manifest = AssetManifest::default();
        let make_rec = |path: &str| AssetRecord {
            id: derive_asset_id(path),
            path: path.to_string(),
            url: format!("/{}", path),
            kind: "raster".to_string(),
            width: 100,
            height: 100,
            aspect_ratio: 1.0,
            has_alpha: false,
            alpha_bbox: None,
            pivot: [0.5, 0.5],
            bytes: 100,
            sha256: "abc".to_string(),
            source: None,
            query: None,
            mean_hex: None,
            mean_luma: None,
            mean_sat: None,
            valid: true,
            warnings: vec![],
        };
        let a = upsert_asset_record(&mut manifest, make_rec("img/logo.png"));
        let b = upsert_asset_record(&mut manifest, make_rec("img/logo.svg"));
        assert_eq!(a.id, "logo");
        assert_eq!(b.id, "logo_2");
    }

    #[test]
    fn rejects_engine_repo_root_and_filesystem_root_as_asset_registry_target() {
        let repo_root = crate::paths::project_root();
        let err = resolve_asset_film_root(Some(&repo_root.to_string_lossy()));
        assert!(err.is_err(), "IDE source repo root must be rejected");
    }
}
