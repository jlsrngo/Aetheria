//! Pre-render gates, source code scanners, license checks, and Adobe Stock metadata/CSV validators.

use super::adobe_profile::{
    AdobeProfile, RuleSeverity, URL_BEST_PRACTICES, URL_CSV, URL_GEN_AI_CONTENT, URL_LEGAL,
    URL_REFUSAL, URL_SUBMIT_VIDEOS, URL_TECHNICAL, URL_TITLES_KEYWORDS,
};
use super::manifest::{MicrostockLicenseEntry, MicrostockManifest, MicrostockMetadata, PreflightItem};
use crate::studio::builtin_runtime::is_vendor_script_name;
use crate::studio::film_inspector::inspect_workspace_film;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct PreRenderRequest {
    pub preset_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: u32,
    pub codec: String,
    pub duration_sec: f64,
    pub output_filename: Option<String>,
    pub reference_url: Option<String>,
}

/// Generates a deterministic Adobe-compliant filename `<= 30` chars including extension.
pub fn build_compliant_filename(slug: &str, preset_id: &str, codec: &str) -> String {
    let ext = if codec.eq_ignore_ascii_case("prores") {
        "mov"
    } else {
        "mp4"
    };
    let clean_preset: String = preset_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(9)
        .collect();
    let suffix = format!("-{}.{}", clean_preset.to_ascii_lowercase(), ext);
    let max_slug_len = 30usize.saturating_sub(suffix.len()).max(4);
    let mut clean_slug: String = slug
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while clean_slug.contains("--") {
        clean_slug = clean_slug.replace("--", "-");
    }
    let clean_slug = clean_slug.trim_matches('-');
    let base = if clean_slug.is_empty() {
        "stock"
    } else if clean_slug.len() > max_slug_len {
        clean_slug[..max_slug_len].trim_end_matches('-')
    } else {
        clean_slug
    };
    format!("{}{}", base, suffix)
}

/// Rough pre-render file size estimate in MB to guard the 3900 MB Adobe Stock cap.
pub fn estimate_render_size_mb(width: u32, height: u32, fps: u32, duration_sec: f64, codec: &str) -> f64 {
    let pixels_per_sec = (width as f64) * (height as f64) * (fps.max(1) as f64);
    // Approximate bits per pixel: ProRes 422 HQ ~1.1 bpp, H.264 CRF 15 ~0.14 bpp
    let bpp = if codec.eq_ignore_ascii_case("prores") {
        1.10
    } else {
        0.14
    };
    let total_bytes = (pixels_per_sec * duration_sec.max(0.0) * bpp) / 8.0;
    total_bytes / (1024.0 * 1024.0)
}

pub fn evaluate_pre_render_gates(
    profile: &AdobeProfile,
    project_dir: &Path,
    manifest: &MicrostockManifest,
    req: &PreRenderRequest,
) -> Vec<PreflightItem> {
    let mut items = Vec::new();

    // 1. Duration (5..=60s)
    let (min_dur, max_dur) = profile.duration_sec_range.value;
    if !req.duration_sec.is_finite()
        || req.duration_sec < (min_dur as f64)
        || req.duration_sec > (max_dur as f64)
    {
        items.push(PreflightItem {
            code: "DURATION_OUT_OF_RANGE".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Duration {:.2}s is outside Adobe Stock allowed range ({}-{}s).",
                req.duration_sec, min_dur, max_dur
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    // 2. FPS whitelist
    if !profile.allowed_fps.value.contains(&req.fps) {
        items.push(PreflightItem {
            code: "FPS_NOT_ALLOWED".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "FPS {} is not in Adobe Stock integer preset whitelist {:?}.",
                req.fps, profile.allowed_fps.value
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    // 3. Codec whitelist
    let codec_norm = req.codec.trim().to_ascii_lowercase();
    if !profile.codecs.value.iter().any(|c| c == &codec_norm) {
        items.push(PreflightItem {
            code: "CODEC_NOT_ALLOWED".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Codec '{}' is not allowed in Adobe Stock mode (allowed: h264, prores).",
                req.codec
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    // 4. Resolution / Preset check
    let resolved_dims = if let (Some(w), Some(h)) = (req.width, req.height) {
        if profile.is_whitelisted_resolution(w, h) {
            Some((w, h))
        } else {
            None
        }
    } else {
        profile.find_preset(&req.preset_id).map(|p| (p.width, p.height))
    };

    let (target_w, target_h) = match resolved_dims {
        Some(dims) => dims,
        None => {
            items.push(PreflightItem {
                code: "RESOLUTION_NOT_ALLOWED".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Preset/resolution '{}' ({:?}x{:?}) is not in the Adobe Stock resolution whitelist.",
                    req.preset_id, req.width, req.height
                ),
                source: URL_TECHNICAL.to_string(),
            });
            (1920, 1080)
        }
    };

    // 5. Filename length & container check
    if let Some(ref custom_name) = req.output_filename {
        let trimmed = custom_name.trim();
        if trimmed.len() > profile.max_filename_chars.value
            || trimmed.contains("..")
            || trimmed.contains('/')
            || trimmed.contains('\\')
        {
            items.push(PreflightItem {
                code: "FILENAME_TOO_LONG".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Filename '{}' exceeds {} characters or contains invalid path characters.",
                    trimmed, profile.max_filename_chars.value
                ),
                source: URL_CSV.to_string(),
            });
        }
        let lower = trimmed.to_ascii_lowercase();
        if !(lower.ends_with(".mp4") || lower.ends_with(".mov")) {
            items.push(PreflightItem {
                code: "CONTAINER_NOT_ALLOWED".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Filename '{}' must use .mp4 or .mov container.",
                    trimmed
                ),
                source: URL_TECHNICAL.to_string(),
            });
        }
    }

    // 6. Rough file size estimate (> 3900 MB)
    let est_mb = estimate_render_size_mb(target_w, target_h, req.fps, req.duration_sec, &codec_norm);
    if est_mb > (profile.max_file_size_mb.value as f64) {
        items.push(PreflightItem {
            code: "FILE_TOO_LARGE".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Estimated file size {:.0} MB exceeds Adobe Stock {} MB limit (exact size checked in post-render preflight).",
                est_mb, profile.max_file_size_mb.value
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }

    // 7. AI Declaration & Checklist
    match manifest.provenance.ai_declared {
        None => {
            items.push(PreflightItem {
                code: "AI_DECLARATION_MISSING".to_string(),
                severity: RuleSeverity::Fail,
                message: "Generative AI declaration (aiDeclared: true/false) must be explicitly set by the user before rendering.".to_string(),
                source: URL_GEN_AI_CONTENT.to_string(),
            });
        }
        Some(true) => {
            items.push(PreflightItem {
                code: "AI_LABEL_REQUIRED".to_string(),
                severity: RuleSeverity::Info,
                message: format!(
                    "Check '{}' in Adobe Stock Contributor Portal when uploading.",
                    profile.ai_portal_checkbox_label.value
                ),
                source: URL_GEN_AI_CONTENT.to_string(),
            });
        }
        Some(false) => {}
    }

    if !manifest.checklist.is_complete() {
        items.push(PreflightItem {
            code: "CHECKLIST_INCOMPLETE".to_string(),
            severity: RuleSeverity::Fail,
            message: "All 4 Adobe Stock legal/content checklist items must be confirmed before rendering.".to_string(),
            source: URL_LEGAL.to_string(),
        });
    }

    // 8. Reference usage check
    if req
        .reference_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some()
        || has_reference_artifacts(&project_dir.join("ref"))
    {
        items.push(PreflightItem {
            code: "REFERENCE_USED".to_string(),
            severity: RuleSeverity::Fail,
            message: "External reference videos/keyframes (ref/ or referenceUrl) are not permitted in Adobe Stock mode.".to_string(),
            source: URL_LEGAL.to_string(),
        });
    }

    // 9. Source code inspection (motion_linter, external URLs, text overlays, unlicensed fonts/assets)
    let html_path = project_dir.join("index.html");
    if html_path.is_file() {
        let meta = inspect_workspace_film(&html_path);
        if !meta.lint.issues.is_empty() {
            items.push(PreflightItem {
                code: "MOTION_LINT_ERRORS".to_string(),
                severity: RuleSeverity::Fail,
                message: format!(
                    "Determinism linter found {} issue(s): {}",
                    meta.lint.issues.len(),
                    meta.lint.issues[0].message
                ),
                source: URL_TECHNICAL.to_string(),
            });
        }
        if meta.scenes.iter().any(|s| s.audio.is_some() || s.sfx.is_some())
            || has_files_in_dir(&project_dir.join("audio"))
        {
            items.push(PreflightItem {
                code: "HAS_AUDIO".to_string(),
                severity: RuleSeverity::Fail,
                message: "Scene audio/sfx tracks detected in project; Adobe Stock requires removing redundant audio.".to_string(),
                source: URL_SUBMIT_VIDEOS.to_string(),
            });
        }
    }

    let source_scan = scan_project_sources(project_dir, &manifest.licenses);
    if let Some(url_found) = source_scan.external_url {
        items.push(PreflightItem {
            code: "EXTERNAL_URL_IN_PROJECT".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "External URL '{}' detected in project source; all runtime assets must be local.",
                url_found
            ),
            source: URL_TECHNICAL.to_string(),
        });
    }
    if let Some(text_reason) = source_scan.text_detected {
        items.push(PreflightItem {
            code: "TEXT_IN_COMPOSITION".to_string(),
            severity: profile.no_text_overlays.severity,
            message: format!(
                "Text element detected ({}) — Adobe Stock best practices forbid visible text overlays or titles.",
                text_reason
            ),
            source: URL_BEST_PRACTICES.to_string(),
        });
    }
    if !source_scan.unlicensed_items.is_empty() {
        items.push(PreflightItem {
            code: "LICENSE_MISSING".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Third-party font/asset without license proof in manifest: {}",
                source_scan.unlicensed_items.join(", ")
            ),
            source: URL_REFUSAL.to_string(),
        });
    }

    items
}

struct SourceScanSummary {
    external_url: Option<String>,
    text_detected: Option<String>,
    unlicensed_items: Vec<String>,
}

fn scan_project_sources(
    project_dir: &Path,
    licenses: &[MicrostockLicenseEntry],
) -> SourceScanSummary {
    let mut external_url = None;
    let mut text_detected = None;
    let mut required_licenses: Vec<String> = Vec::new();

    let licensed_names: HashSet<String> = licenses
        .iter()
        .filter(|l| {
            !l.name.trim().is_empty()
                && !l.source.trim().is_empty()
                && !l.license.trim().is_empty()
                && !l.proof_url.trim().is_empty()
        })
        .map(|l| l.name.trim().to_ascii_lowercase())
        .collect();

    let mut files_to_scan = Vec::new();
    let html_path = project_dir.join("index.html");
    if html_path.is_file() {
        files_to_scan.push(html_path);
    }
    let script_dir = project_dir.join("script");
    if let Ok(entries) = std::fs::read_dir(&script_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !is_vendor_script_name(fname) {
                    files_to_scan.push(p);
                }
            }
        }
    }

    for file_path in files_to_scan {
        let Ok(content) = std::fs::read_to_string(&file_path) else {
            continue;
        };
        let is_html = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("html"))
            .unwrap_or(false);

        if external_url.is_none() {
            external_url = find_external_http_url(&content);
        }

        if text_detected.is_none() {
            if content.contains(".fillText(") || content.contains(".strokeText(") {
                text_detected = Some("Canvas fillText/strokeText call".to_string());
            } else if content.contains("<text") || content.contains("<tspan") {
                text_detected = Some("SVG <text>/<tspan> element".to_string());
            } else if is_html && has_visible_html_body_text(&content) {
                text_detected = Some("Visible HTML DOM text node".to_string());
            }
        }

        for font_name in detect_custom_fonts(&content) {
            if !licensed_names.contains(&font_name.to_ascii_lowercase()) {
                required_licenses.push(format!("font:{font_name}"));
            }
        }
    }

    // Check img/ and fonts/ directories for asset files needing license records
    for subdir in ["img", "fonts"] {
        let dir = project_dir.join(subdir);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        if !name.starts_with('.')
                            && !licensed_names.contains(&name.to_ascii_lowercase())
                        {
                            required_licenses.push(format!("{subdir}/{name}"));
                        }
                    }
                }
            }
        }
    }

    required_licenses.sort();
    required_licenses.dedup();

    SourceScanSummary {
        external_url,
        text_detected,
        unlicensed_items: required_licenses,
    }
}

fn find_external_http_url(content: &str) -> Option<String> {
    for prefix in ["https://", "http://"] {
        let mut search_from = 0;
        while let Some(idx) = content[search_from..].find(prefix) {
            let abs_idx = search_from + idx;
            let rest = &content[abs_idx..];
            let end_idx = rest
                .find(|c: char| {
                    c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>' | ';' | '`')
                })
                .unwrap_or(rest.len());
            let candidate = &rest[..end_idx];
            // Ignore XML/SVG namespace URIs like http://www.w3.org/2000/svg
            if !candidate.starts_with("http://www.w3.org/")
                && !candidate.starts_with("https://www.w3.org/")
                && !candidate.starts_with("http://127.0.0.1")
                && !candidate.starts_with("http://localhost")
            {
                return Some(candidate.to_string());
            }
            search_from = abs_idx + prefix.len();
        }
    }
    None
}

fn has_visible_html_body_text(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let body_start = match lower.find("<body") {
        Some(pos) => match lower[pos..].find('>') {
            Some(gt) => pos + gt + 1,
            None => return false,
        },
        None => return false,
    };
    let body_end = lower.rfind("</body>").unwrap_or(html.len());
    if body_start >= body_end {
        return false;
    }
    let mut body = html[body_start..body_end].to_string();

    // Strip <script>...</script>, <style>...</style>, and <!--...-->
    for (open, close) in [("<script", "</script>"), ("<style", "</style>"), ("<!--", "-->")] {
        loop {
            let low = body.to_ascii_lowercase();
            let Some(s) = low.find(open) else { break };
            let Some(e_rel) = low[s..].find(close) else {
                body.truncate(s);
                break;
            };
            let e = s + e_rel + close.len();
            body.replace_range(s..e, " ");
        }
    }

    // Strip remaining HTML tags
    let mut in_tag = false;
    let mut visible = String::new();
    for ch in body.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            visible.push(ch);
        }
    }
    !visible.trim().is_empty()
}

fn detect_custom_fonts(content: &str) -> Vec<String> {
    let mut fonts = Vec::new();
    let lower = content.to_ascii_lowercase();
    if lower.contains("@font-face") {
        fonts.push("@font-face".to_string());
    }
    let generic = [
        "sans-serif",
        "serif",
        "monospace",
        "system-ui",
        "cursive",
        "fantasy",
        "inherit",
        "initial",
        "unset",
    ];
    let mut cursor = 0;
    while let Some(pos) = lower[cursor..].find("font-family") {
        let abs = cursor + pos + "font-family".len();
        let rest = &content[abs..];
        if let Some(colon) = rest.find(':') {
            let after_colon = &rest[colon + 1..];
            let end = after_colon
                .find(|c: char| matches!(c, ';' | '}' | '"' | '\'' | '\n'))
                .unwrap_or(after_colon.len().min(48));
            let raw_val = after_colon[..end].trim();
            for part in raw_val.split(',') {
                let clean = part.trim().trim_matches(|c: char| c == '"' || c == '\'');
                if !clean.is_empty()
                    && !generic.iter().any(|g| g.eq_ignore_ascii_case(clean))
                    && !clean.starts_with("var(")
                {
                    fonts.push(clean.to_string());
                }
            }
        }
        cursor = abs;
    }
    fonts
}

fn has_reference_artifacts(ref_dir: &Path) -> bool {
    if !ref_dir.is_dir() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(ref_dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        if p.is_file() {
            return true;
        }
        if p.is_dir() && has_files_in_dir(&p) {
            return true;
        }
    }
    false
}

fn has_files_in_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.starts_with('.') {
                return true;
            }
        } else if p.is_dir() && has_files_in_dir(&p) {
            return true;
        }
    }
    false
}

/// Validates Adobe Stock metadata + filename deterministically against `AdobeProfile`.
pub fn validate_metadata_and_filename(
    profile: &AdobeProfile,
    metadata: &MicrostockMetadata,
    filename: &str,
) -> Vec<PreflightItem> {
    let mut items = Vec::new();
    let fname = filename.trim();

    if fname.is_empty() || fname.len() > profile.max_filename_chars.value {
        items.push(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Filename '{}' length ({}) must be 1..={} characters including extension.",
                fname,
                fname.len(),
                profile.max_filename_chars.value
            ),
            source: URL_CSV.to_string(),
        });
    }

    let title = metadata.title.trim();
    if title.is_empty() || title.chars().count() > profile.max_title_chars.value {
        items.push(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Title length ({}) must be 1..={} characters.",
                title.chars().count(),
                profile.max_title_chars.value
            ),
            source: URL_TITLES_KEYWORDS.to_string(),
        });
    }
    if title.contains(',')
        || title
            .chars()
            .any(|c| !(c.is_alphanumeric() || c == ' ' || c == '-'))
    {
        items.push(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: "Title must be plain text without commas or special characters.".to_string(),
            source: URL_CSV.to_string(),
        });
    }

    let banned_set: HashSet<String> = profile
        .banned_brand_terms
        .value
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();

    for word in title.split_whitespace() {
        let w = word
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase();
        if banned_set.contains(&w) {
            items.push(PreflightItem {
                code: "METADATA_INVALID".to_string(),
                severity: RuleSeverity::Fail,
                message: format!("Title contains banned brand/IP term '{}'.", w),
                source: URL_LEGAL.to_string(),
            });
        }
    }

    let (min_kw, max_kw) = profile.keyword_count_range.value;
    let kw_len = metadata.keywords.len();
    if kw_len < min_kw || kw_len > max_kw {
        items.push(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "Keywords count ({}) must be between {} and {}.",
                kw_len, min_kw, max_kw
            ),
            source: URL_TITLES_KEYWORDS.to_string(),
        });
    }

    let mut seen_kw = HashSet::new();
    for kw in &metadata.keywords {
        let clean = kw.trim();
        let norm = clean.to_ascii_lowercase();
        if clean.is_empty() || clean.contains(',') {
            items.push(PreflightItem {
                code: "METADATA_INVALID".to_string(),
                severity: RuleSeverity::Fail,
                message: format!("Invalid empty or comma-containing keyword '{}'.", clean),
                source: URL_TITLES_KEYWORDS.to_string(),
            });
        }
        if !seen_kw.insert(norm.clone()) {
            items.push(PreflightItem {
                code: "METADATA_INVALID".to_string(),
                severity: RuleSeverity::Fail,
                message: format!("Duplicate keyword '{}' is not allowed.", clean),
                source: URL_TITLES_KEYWORDS.to_string(),
            });
        }
        for token in norm.split_whitespace() {
            if banned_set.contains(token) {
                items.push(PreflightItem {
                    code: "METADATA_INVALID".to_string(),
                    severity: RuleSeverity::Fail,
                    message: format!("Keyword '{}' contains banned brand/IP term.", clean),
                    source: URL_LEGAL.to_string(),
                });
            }
        }
    }

    items
}

fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Generates a UTF-8 Adobe Stock CSV string with exact header `Filename,Title,Keywords`.
pub fn build_adobe_csv(
    profile: &AdobeProfile,
    rows: &[(String, MicrostockMetadata)],
) -> Result<String, PreflightItem> {
    if rows.is_empty() || rows.len() > profile.csv_max_rows.value {
        return Err(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "CSV row count ({}) must be 1..={}.",
                rows.len(),
                profile.csv_max_rows.value
            ),
            source: URL_CSV.to_string(),
        });
    }

    let mut out = String::from("Filename,Title,Keywords\n");
    for (filename, meta) in rows {
        let errs = validate_metadata_and_filename(profile, meta, filename);
        if let Some(first_err) = errs.into_iter().next() {
            return Err(first_err);
        }
        let keywords_joined = meta
            .keywords
            .iter()
            .map(|k| k.trim())
            .collect::<Vec<_>>()
            .join(", ");
        let line = format!(
            "{},{},{}\n",
            csv_escape(filename.trim()),
            csv_escape(meta.title.trim()),
            csv_escape(&keywords_joined)
        );
        out.push_str(&line);
    }

    if (out.as_bytes().len() as u64) > profile.csv_max_size_bytes.value {
        return Err(PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: "Generated CSV exceeds 1 MB Adobe Stock limit.".to_string(),
            source: URL_CSV.to_string(),
        });
    }

    Ok(out)
}

pub fn build_metadata_txt(
    profile: &AdobeProfile,
    filename: &str,
    manifest: &MicrostockManifest,
) -> String {
    let ai_note = match manifest.provenance.ai_declared {
        Some(true) => format!(
            "REQUIRED — Check '{}' in Adobe Stock Contributor Portal",
            profile.ai_portal_checkbox_label.value
        ),
        Some(false) => "Not declared as Generative AI (user responsibility)".to_string(),
        None => "UNSET (must be declared before upload)".to_string(),
    };
    format!(
        "=== Adobe Stock Upload Copy Sheet ===\n\
         Filename: {}\n\
         Title ({}/70): {}\n\
         Keywords ({}): {}\n\
         Category (select in portal): {}\n\
         Generative AI Portal Checkbox: {}\n\
         Notice: CSV belum terkonfirmasi untuk video; label AI diatur di portal.\n\
         Notice: {}\n",
        filename,
        manifest.metadata.title.chars().count(),
        manifest.metadata.title.trim(),
        manifest.metadata.keywords.len(),
        manifest.metadata.keywords.join(", "),
        if manifest.metadata.category.trim().is_empty() {
            "Graphic resources"
        } else {
            manifest.metadata.category.trim()
        },
        ai_note,
        profile.motion_graphics_notice
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_metadata_limits_and_builds_exact_csv_header() {
        let profile = AdobeProfile::default_profile();
        let valid = MicrostockMetadata {
            title: "Abstract Golden Flowing Waves Seamless Background".to_string(),
            keywords: vec![
                "abstract".into(),
                "background".into(),
                "motion".into(),
                "gradient".into(),
                "seamless".into(),
            ],
            category: "Graphic resources".into(),
        };
        assert!(validate_metadata_and_filename(&profile, &valid, "golden-1080p.mp4").is_empty());

        let csv = build_adobe_csv(&profile, &[("golden-1080p.mp4".to_string(), valid.clone())])
            .expect("valid csv");
        let first_line = csv.lines().next().unwrap_or("");
        assert_eq!(first_line, "Filename,Title,Keywords");

        // 71-char title -> METADATA_INVALID
        let mut long_title = valid.clone();
        long_title.title = "A".repeat(71);
        let errs = validate_metadata_and_filename(&profile, &long_title, "golden-1080p.mp4");
        assert!(errs.iter().any(|e| e.code == "METADATA_INVALID"));

        // 4 keywords & 50 keywords -> METADATA_INVALID
        let mut four_kw = valid.clone();
        four_kw.keywords = vec!["a".into(), "b".into(), "c".into(), "d".into()];
        assert!(!validate_metadata_and_filename(&profile, &four_kw, "golden-1080p.mp4").is_empty());

        let mut fifty_kw = valid.clone();
        fifty_kw.keywords = (0..50).map(|i| format!("kw{i}")).collect();
        assert!(!validate_metadata_and_filename(&profile, &fifty_kw, "golden-1080p.mp4").is_empty());

        // Duplicate keyword -> METADATA_INVALID
        let mut dup_kw = valid.clone();
        dup_kw.keywords = vec![
            "abstract".into(),
            "Abstract".into(),
            "motion".into(),
            "flow".into(),
            "wave".into(),
        ];
        assert!(!validate_metadata_and_filename(&profile, &dup_kw, "golden-1080p.mp4").is_empty());

        // 31-char filename -> METADATA_INVALID
        let long_fname = format!("{}.mp4", "a".repeat(27));
        assert_eq!(long_fname.len(), 31);
        assert!(!validate_metadata_and_filename(&profile, &valid, &long_fname).is_empty());
    }
}
