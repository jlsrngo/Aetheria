//! Automatic HTML/JS Motion Film & Workspace File Verification Feedback.
//! Gives the LLM immediate, actionable engine diagnostics inside `write`, `edit`,
//! `apply_patch`, and `lsp` results without failing progressive edits on disk.

use crate::paths::{configure_hidden_std_command, contains_path};
use crate::studio::film_inspector::{inspect_workspace_film, FilmMeta};
use crate::studio::motion_linter::lint_html_film;
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Default)]
pub struct FileFeedback {
    pub syntax_error: Option<String>,
    pub has_errors: bool,
    pub wiring_error: bool,
    pub diagnostics: Vec<String>,
    pub film_meta: Option<Value>,
}

fn load_film_json(film_dir: &Path) -> Option<super::film_scaffold::FilmManifestJson> {
    let raw = std::fs::read_to_string(film_dir.join("film.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Extracts literal scene IDs passed to `registerScene("id", ...)` and detects dynamic calls.
fn extract_registered_scene_ids(js_content: &str) -> (Vec<String>, bool) {
    let mut ids = Vec::new();
    let mut has_dynamic = false;
    let needle = "registerScene(";
    let mut offset = 0usize;
    while let Some(rel) = js_content[offset..].find(needle) {
        let pos = offset + rel + needle.len();
        let rest = js_content[pos..].trim_start();
        if let Some(first) = rest.chars().next() {
            if first == '"' || first == '\'' {
                if let Some(end) = rest[1..].find(first) {
                    let id = rest[1..1 + end].trim();
                    if !id.is_empty() {
                        ids.push(id.to_string());
                    }
                }
            } else {
                has_dynamic = true;
            }
        }
        offset = pos;
    }
    (ids, has_dynamic)
}

fn check_js_scene_wiring(
    target: &Path,
    file_name: &str,
    content: &str,
    feedback: &mut FileFeedback,
) {
    let script_dir = match target.parent() {
        Some(p)
            if p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("script"))
                .unwrap_or(false) =>
        {
            p
        }
        _ => return,
    };
    let film_dir = match script_dir.parent() {
        Some(d) => d,
        None => return,
    };
    let (registered_ids, has_dynamic) = extract_registered_scene_ids(content);
    let rel_script = format!("script/{}", file_name);
    let is_scene_file = file_name.to_ascii_lowercase().starts_with("scene");

    if let Some(manifest) = load_film_json(film_dir) {
        let valid_scripts: Vec<&str> = manifest.scenes.iter().map(|s| s.script.as_str()).collect();
        let valid_ids: Vec<&str> = manifest.scenes.iter().map(|s| s.id.as_str()).collect();

        if (is_scene_file || !registered_ids.is_empty())
            && !valid_scripts
                .iter()
                .any(|s| s.eq_ignore_ascii_case(&rel_script))
        {
            feedback.has_errors = true;
            feedback.wiring_error = true;
            feedback.diagnostics.push(format!(
                "ERROR (UNREGISTERED_SCENE_FILE): '{}' is not registered in film.json (registered scene scripts: [{}]). Add scenes via film_scaffold or edit one of the listed files.",
                rel_script,
                valid_scripts.join(", ")
            ));
            return;
        }

        if is_scene_file && !has_dynamic && registered_ids.is_empty() {
            let expected_ids: Vec<&str> = manifest
                .scenes
                .iter()
                .filter(|s| s.script.eq_ignore_ascii_case(&rel_script))
                .map(|s| s.id.as_str())
                .collect();
            let expected_label = if expected_ids.is_empty() {
                valid_ids.join(", ")
            } else {
                expected_ids.join(", ")
            };
            feedback.has_errors = true;
            feedback.wiring_error = true;
            feedback.diagnostics.push(format!(
                "ERROR (MISSING_REGISTER_SCENE): Scene script '{}' does not call AM.registerScene(\"<id>\", ...). Expected scene id: [{}].",
                rel_script,
                expected_label
            ));
            return;
        }

        let matched_manifest_ids: Vec<&str> = manifest
            .scenes
            .iter()
            .filter(|s| s.script.eq_ignore_ascii_case(&rel_script))
            .map(|s| s.id.as_str())
            .collect();
        for reg_id in &registered_ids {
            let allowed = if !matched_manifest_ids.is_empty() {
                matched_manifest_ids.iter().any(|id| id == reg_id)
            } else {
                valid_ids.iter().any(|id| id == reg_id)
            };
            if !allowed {
                feedback.has_errors = true;
                feedback.wiring_error = true;
                let expected = if !matched_manifest_ids.is_empty() {
                    matched_manifest_ids.join(", ")
                } else {
                    valid_ids.join(", ")
                };
                feedback.diagnostics.push(format!(
                    "ERROR (SCENE_ID_MISMATCH): AM.registerScene(\"{}\") in '{}' does not match scene id in film.json (expected: [{}]).",
                    reg_id,
                    rel_script,
                    expected
                ));
            }
        }
        return;
    }

    let index_path = film_dir.join("index.html");
    if index_path.is_file() {
        let html_raw = std::fs::read_to_string(&index_path).unwrap_or_default();
        if is_scene_file
            && !extract_local_script_srcs(&html_raw)
                .iter()
                .any(|s| s.eq_ignore_ascii_case(&rel_script))
        {
            feedback.diagnostics.push(format!(
                "WARNING (UNREFERENCED_SCENE_SCRIPT): '{}' exists in script/ but is not loaded in index.html. Add `<script src=\"{}\"></script>` before inline initialization.",
                rel_script, rel_script
            ));
        }
        if !has_dynamic && !registered_ids.is_empty() && html_raw.contains("SCENES") {
            let meta = inspect_workspace_film(&index_path);
            let valid_ids: Vec<&str> = meta.scenes.iter().map(|s| s.id.as_str()).collect();
            if !valid_ids.is_empty() {
                for reg_id in &registered_ids {
                    if !valid_ids.iter().any(|id| id == reg_id) {
                        feedback.has_errors = true;
                        feedback.wiring_error = true;
                        feedback.diagnostics.push(format!(
                            "ERROR (SCENE_ID_MISMATCH): AM.registerScene(\"{}\") in '{}' does not match any scene id in index.html SCENES (expected one of: [{}]).",
                            reg_id,
                            rel_script,
                            valid_ids.join(", ")
                        ));
                    }
                }
            }
        }
    }
}

fn check_html_scene_wiring(
    film_dir: &Path,
    ws_root: &Path,
    content: &str,
    meta: &FilmMeta,
    feedback: &mut FileFeedback,
) {
    let manifest_opt = load_film_json(film_dir);
    let is_managed = manifest_opt.as_ref().map(|m| m.manage_index_html).unwrap_or(false);
    if is_managed && !meta.lint.has_render_at {
        feedback.has_errors = true;
        feedback.wiring_error = true;
        feedback.diagnostics.push(
            "ERROR (MANAGED_INDEX_HTML_BROKEN): Do not remove window.renderAt from film_scaffold-managed index.html. Regenerate with film_scaffold or set manageIndexHtml: false.".to_string(),
        );
    }

    let explicit_scenes = content.contains("SCENES") || manifest_opt.is_some();
    if !explicit_scenes || meta.scenes.is_empty() {
        return;
    }

    let script_srcs: Vec<String> = extract_local_script_srcs(content)
        .into_iter()
        .filter(|rel| {
            !rel.eq_ignore_ascii_case("script/aetheria-motion.js")
                && !crate::studio::builtin_runtime::is_builtin_post_path(rel)
                && !crate::studio::builtin_runtime::is_builtin_stage_path(rel)
                && !crate::studio::builtin_runtime::is_builtin_tracks_path(rel)
                && !crate::studio::builtin_runtime::is_builtin_story_camera_path(rel)
                && !crate::studio::builtin_runtime::is_builtin_three_path(rel)
        })
        .collect();

    if script_srcs.is_empty() {
        return;
    }

    let mut all_present = true;
    let mut all_registered = Vec::new();
    let mut any_dynamic = false;
    for rel in &script_srcs {
        if let Some(full) = [film_dir.join(rel), ws_root.join(rel)]
            .into_iter()
            .find(|p| (contains_path(film_dir, p) || contains_path(ws_root, p)) && p.is_file())
        {
            if let Ok(js) = std::fs::read_to_string(full) {
                let (ids, dyn_call) = extract_registered_scene_ids(&js);
                all_registered.extend(ids);
                any_dynamic |= dyn_call;
            }
        } else {
            all_present = false;
        }
    }

    if all_present && !any_dynamic && !all_registered.is_empty() {
        for sc in &meta.scenes {
            if !all_registered.iter().any(|r| r == &sc.id) {
                feedback.has_errors = true;
                feedback.wiring_error = true;
                feedback.diagnostics.push(format!(
                    "ERROR (UNREGISTERED_SCENE_ID): Scene '{}' in SCENES has no matching AM.registerScene(\"{}\", ...) in the loaded scene scripts.",
                    sc.id, sc.id
                ));
            }
        }
    }
}

fn check_js_syntax(target: &Path) -> Option<String> {
    let mut cmd = Command::new("node");
    configure_hidden_std_command(&mut cmd);
    let out = cmd.arg("--check").arg(target).output().ok()?;
    if out.status.success() {
        return None;
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Some(if stderr.is_empty() {
        "JavaScript syntax check failed.".to_string()
    } else {
        stderr
    })
}

fn find_short_hex_mix_warnings(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
            continue;
        }
        if !line.contains("mixHex(") {
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0;
        while i + 3 < bytes.len() {
            if bytes[i] == b'#'
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit()
                && bytes[i + 3].is_ascii_hexdigit()
            {
                if !bytes.get(i + 4).is_some_and(|b| b.is_ascii_hexdigit()) {
                    let snippet = &line[i..=i + 3];
                    out.push(format!(
                        "WARNING (SHORT_HEX_COLOR at L{}): '{}' passed near mixHex(); use 6-digit hex (e.g. '#000000') so color interpolation never yields NaN.",
                        idx + 1,
                        snippet
                    ));
                    break;
                }
            }
            i += 1;
        }
    }
    out
}

fn count_audio_files_on_disk(film_dir: &Path, ws_root: &Path) -> usize {
    let mut count = 0usize;
    for dir in [
        film_dir.join("audio"),
        film_dir.join("public").join("audio"),
        ws_root.join("audio"),
    ] {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .unwrap_or_default();
                if matches!(ext.as_str(), "wav" | "mp3" | "m4a" | "ogg" | "aac" | "flac") {
                    count += 1;
                }
            }
        }
        if count > 0 {
            break;
        }
    }
    count
}

fn workspace_asset_exists(film_dir: &Path, ws_root: &Path, raw_rel: &str) -> bool {
    let clean = raw_rel.trim().trim_start_matches('/').replace('\\', "/");
    if clean.is_empty() || clean.contains("..") {
        return false;
    }
    for root in [film_dir, &film_dir.join("public"), ws_root] {
        let candidate = root.join(&clean);
        if contains_path(root, &candidate) && candidate.is_file() {
            return true;
        }
    }
    false
}

pub(crate) fn extract_local_script_srcs(html: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<script") {
        let start = cursor + rel;
        let Some(tag_end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..=start + tag_end_rel];
        cursor = start + tag_end_rel + 1;

        let tag_lower = tag.to_ascii_lowercase();
        let Some(src_pos) = tag_lower.find("src=") else {
            continue;
        };
        let rest = tag[src_pos + 4..].trim_start();
        let val = rest
            .strip_prefix('"')
            .and_then(|s| s.split('"').next())
            .or_else(|| rest.strip_prefix('\'').and_then(|s| s.split('\'').next()));
        if let Some(raw) = val {
            let clean = raw.trim().trim_start_matches("./").trim_start_matches('/');
            if clean.starts_with("script/") && clean.ends_with(".js") {
                refs.push(clean.to_string());
            }
        }
    }
    refs
}

fn summarize_film_meta(meta: &FilmMeta) -> Value {
    let audio_tracks_resolved = meta.scenes.iter().filter(|s| s.audio.is_some()).count();
    json!({
        "title": meta.title,
        "width": meta.width,
        "height": meta.height,
        "fps": meta.fps,
        "duration": (meta.duration * 100.0).round() / 100.0,
        "totalFrames": meta.total_frames,
        "scenesCount": meta.scenes.len(),
        "audioTracksResolved": audio_tracks_resolved
    })
}

fn has_forbidden_external_url(lower_html: &str) -> bool {
    for scheme in ["http://", "https://"] {
        let mut rest = lower_html;
        while let Some(idx) = rest.find(scheme) {
            let after_scheme = &rest[idx + scheme.len()..];
            let allowed = after_scheme.starts_with("www.w3.org/")
                || after_scheme.starts_with("w3.org/")
                || after_scheme.starts_with("fonts.googleapis.com")
                || after_scheme.starts_with("fonts.gstatic.com")
                || after_scheme.starts_with("127.0.0.1")
                || after_scheme.starts_with("localhost");
            if !allowed {
                return true;
            }
            rest = after_scheme;
        }
    }
    false
}

fn check_microstock_js_diagnostics(
    workspace_dir: &str,
    file_name: &str,
    content: &str,
    feedback: &mut FileFeedback,
) {
    let Some(lock) = crate::studio::microstock::active_microstock_lock(workspace_dir) else {
        return;
    };
    let lower_name = file_name.to_ascii_lowercase();
    if lower_name == "aetheria-motion.js"
        || lower_name == "aetheria-post.js"
        || lower_name == "aetheria-stage.js"
        || lower_name == "aetheria-tracks.js"
        || lower_name == "story-camera.js"
        || lower_name == "three.min.js"
    {
        return;
    }
    if content.contains("fillText(")
        || content.contains("strokeText(")
        || content.contains("drawSubtitles(")
    {
        feedback.has_errors = true;
        feedback.diagnostics.push(format!(
            "ERROR (MICROSTOCK_TEXT_FORBIDDEN): Adobe Stock Mode ('M') forbids text/subtitle rendering in '{}' (found fillText/strokeText/drawSubtitles). Remove all text overlays.",
            file_name
        ));
    }
    if lock.width > lock.height
        && (content.contains("1080 / 1920")
            || content.contains("1080/1920")
            || content.contains("1080, 1920"))
    {
        feedback.has_errors = true;
        feedback.diagnostics.push(format!(
            "ERROR (MICROSTOCK_RATIO_MISMATCH): Adobe Stock Mode ('M') is locked to {}x{} ({}), but '{}' still references Portrait 1080x1920 dimensions/aspect.",
            lock.width, lock.height, lock.ratio, file_name
        ));
    }
}

fn is_dark_or_empty_css_color(raw: &str) -> bool {
    let norm = raw.trim().trim_end_matches(';').trim().to_ascii_lowercase();
    norm.is_empty()
        || matches!(
            norm.as_str(),
            "#0f1115" | "#000" | "#000000" | "black" | "transparent" | "none"
        )
}

fn uses_webgl_alpha_true(content: &str) -> bool {
    let mut offset = 0usize;
    while let Some(rel) = content[offset..].find("WebGLRenderer(") {
        let start = offset + rel + "WebGLRenderer(".len();
        let rest = &content[start..];
        let max_len = rest
            .char_indices()
            .nth(400)
            .map(|(i, _)| i)
            .unwrap_or(rest.len());
        let end = rest[..max_len].find(')').unwrap_or(max_len);
        let opts = &rest[..end];
        let mut a_off = 0usize;
        while let Some(a_rel) = opts[a_off..].find("alpha") {
            let a_pos = a_off + a_rel;
            let prev_ok = a_pos == 0
                || !(opts.as_bytes()[a_pos - 1].is_ascii_alphanumeric()
                    || opts.as_bytes()[a_pos - 1] == b'_');
            let after_alpha = opts[a_pos + "alpha".len()..].trim_start();
            if prev_ok && after_alpha.starts_with(':') {
                let val = after_alpha[1..].trim_start();
                if val.starts_with("true")
                    && val["true".len()..]
                        .chars()
                        .next()
                        .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_')
                {
                    return true;
                }
            }
            a_off = a_pos + "alpha".len();
        }
        offset = start;
    }
    false
}

fn has_js_explicit_bg(src: &str) -> bool {
    if src.contains(".background =")
        || src.contains(".background=")
        || src.contains("linear-gradient(")
        || src.contains("radial-gradient(")
    {
        return true;
    }
    if let Some(idx) = src.find("setClearColor(") {
        let rest = &src[idx + "setClearColor(".len()..];
        let end = rest.find(')').unwrap_or_else(|| rest.len().min(60));
        let args = &rest[..end];
        if let Some((_, alpha_raw)) = args.split_once(',') {
            let a = alpha_raw.trim();
            if a == "0" || a == "0.0" {
                return false;
            }
        }
        return true;
    }
    false
}

fn html_has_non_dark_stage_bg(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    if lower.contains("linear-gradient(") || lower.contains("radial-gradient(") {
        return true;
    }
    let Some(stage_idx) = lower.find("#stage") else {
        return false;
    };
    let after = &lower[stage_idx..];
    let Some(open) = after.find('{') else {
        return false;
    };
    let body = &after[open + 1..];
    let close = body.find('}').unwrap_or(body.len());
    let rule = &body[..close];
    for key in ["background:", "background-color:"] {
        if let Some(k_idx) = rule.find(key) {
            let val_rest = &rule[k_idx + key.len()..];
            let val = val_rest.split([';', '}']).next().unwrap_or("");
            if !is_dark_or_empty_css_color(val) {
                return true;
            }
        }
    }
    false
}

fn has_explicit_webgl_background(target: &Path, content: &str) -> bool {
    if has_js_explicit_bg(content) || html_has_non_dark_stage_bg(content) {
        return true;
    }
    let film_root = if target
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("script"))
    {
        target.parent().and_then(|p| p.parent())
    } else {
        target.parent()
    };
    let Some(root) = film_root else {
        return false;
    };
    let index_path = root.join("index.html");
    if index_path.is_file() {
        if let Ok(html) = std::fs::read_to_string(&index_path) {
            if has_js_explicit_bg(&html) || html_has_non_dark_stage_bg(&html) {
                return true;
            }
        }
    }
    let film_json_path = root.join("film.json");
    if film_json_path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&film_json_path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                if let Some(bg) = parsed.get("background").and_then(Value::as_str) {
                    if !is_dark_or_empty_css_color(bg) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn check_webgl_diagnostics(
    target: &Path,
    content: &str,
    file_name: &str,
    feedback: &mut FileFeedback,
) {
    if crate::studio::builtin_runtime::is_vendor_script_name(file_name) {
        return;
    }
    if content.contains("WebGLRenderer(") && !content.contains("preserveDrawingBuffer") {
        feedback.has_errors = true;
        feedback.diagnostics.push(
            "ERROR (WEBGL_MISSING_PRESERVE_DRAWING_BUFFER): new THREE.WebGLRenderer(...) must include preserveDrawingBuffer: true so headless MP4 capture does not produce blank frames."
                .to_string(),
        );
    }
    if !file_name.eq_ignore_ascii_case("clay-kit.js")
        && uses_webgl_alpha_true(content)
        && !has_explicit_webgl_background(target, content)
    {
        feedback.has_errors = true;
        feedback.diagnostics.push(
            "ERROR (WEBGL_ALPHA_MISSING_BACKGROUND): new THREE.WebGLRenderer({ alpha: true }) leaves the stage transparent (exposing dark '#0f1115'). Set 'scene.background', 'renderer.setClearColor(...)', a CSS '#stage' gradient, or a non-dark 'background' in film_scaffold."
                .to_string(),
        );
    }
}

fn check_claykit_diagnostics(
    target: &Path,
    file_name: &str,
    content: &str,
    feedback: &mut FileFeedback,
) {
    if crate::studio::builtin_runtime::is_vendor_script_name(file_name)
        || file_name.eq_ignore_ascii_case("clay-kit.js")
    {
        return;
    }
    let has_claykit_sibling = target
        .parent()
        .is_some_and(|dir| dir.join("clay-kit.js").is_file());
    if !has_claykit_sibling {
        return;
    }
    if content.contains("drawTopHeader(") || content.contains("drawHeadlinePlaque(") {
        feedback.has_errors = true;
        feedback.diagnostics.push(
            "ERROR (CLAYKIT_DARK_OVERLAY_FORBIDDEN): Soft-Clay scenes with clay-kit.js forbid AM.drawTopHeader / AM.drawHeadlinePlaque dark bars over the 3D sky or sidewalk."
                .to_string(),
        );
    }
}

/// Inspects a newly written or edited project file and returns actionable engine diagnostics.
pub fn collect_file_feedback(workspace_dir: &str, target: &Path) -> FileFeedback {
    let mut feedback = FileFeedback::default();
    if !target.is_file() {
        return feedback;
    }

    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();

    let content = match std::fs::read_to_string(target) {
        Ok(s) => s,
        Err(_) => return feedback,
    };

    match ext.as_str() {
        "json" => {
            if let Err(e) = serde_json::from_str::<Value>(&content) {
                feedback.has_errors = true;
                let msg = format!("ERROR (JSON_SYNTAX): {}", e);
                feedback.syntax_error = Some(msg.clone());
                feedback.diagnostics.push(msg);
            }
        }
        "js" | "mjs" | "cjs" => {
            if let Some(err) = check_js_syntax(target) {
                feedback.has_errors = true;
                let msg = format!("ERROR (JS_SYNTAX): {}", err);
                feedback.syntax_error = Some(msg.clone());
                feedback.diagnostics.push(msg);
            }
            let lint = lint_html_film(&content);
            for issue in lint.issues {
                if issue.code == "MISSING_RENDER_AT" || issue.code == "MISSING_READY_FLAG" {
                    continue;
                }
                let loc = issue
                    .line
                    .map(|l| format!(" at L{}", l))
                    .unwrap_or_default();
                feedback.diagnostics.push(format!(
                    "{} ({}{}): {}",
                    issue.severity.to_ascii_uppercase(),
                    issue.code,
                    loc,
                    issue.message
                ));
            }
            feedback
                .diagnostics
                .extend(find_short_hex_mix_warnings(&content));
            check_webgl_diagnostics(target, &content, file_name, &mut feedback);
            check_claykit_diagnostics(target, file_name, &content, &mut feedback);
            check_microstock_js_diagnostics(workspace_dir, file_name, &content, &mut feedback);
            check_js_scene_wiring(target, file_name, &content, &mut feedback);
        }
        "html" | "htm" => {
            check_webgl_diagnostics(target, &content, file_name, &mut feedback);
            let meta = inspect_workspace_film(target);
            feedback.film_meta = Some(summarize_film_meta(&meta));
            let ws_root = Path::new(workspace_dir);
            let film_dir = target.parent().unwrap_or(ws_root);

            for issue in &meta.lint.issues {
                if issue.severity == "error" {
                    feedback.has_errors = true;
                }
                let loc = issue
                    .line
                    .map(|l| format!(" at L{}", l))
                    .unwrap_or_default();
                feedback.diagnostics.push(format!(
                    "{} ({}{}): {}",
                    issue.severity.to_ascii_uppercase(),
                    issue.code,
                    loc,
                    issue.message
                ));
            }

            if !meta.lint.has_film_meta {
                feedback.diagnostics.push(
                    "WARNING (MISSING_FILM_META): Declare window.__filmMeta = { title, width, height, fps, duration, scenes: SCENES } so Studio canvas dimensions and timeline parse reliably."
                        .to_string(),
                );
            }

            if meta.width < 320 || meta.height < 320 {
                feedback.has_errors = true;
                feedback.diagnostics.push(format!(
                    "ERROR (SUSPICIOUS_DIMENSIONS): Engine parsed film dimensions as {}x{}. Ensure window.__filmMeta specifies explicit integer width and height (e.g. 1080x1920).",
                    meta.width, meta.height
                ));
            }

            if let Some(lock) = crate::studio::microstock::active_microstock_lock(workspace_dir) {
                if meta.width != lock.width || meta.height != lock.height {
                    feedback.has_errors = true;
                    feedback.diagnostics.push(format!(
                        "ERROR (MICROSTOCK_RATIO_MISMATCH): Adobe Stock Mode ('M') is locked to {}x{} ({}), but {} declares {}x{}. Update <canvas> width/height, CSS stage dimensions, and window.__filmMeta to width={}, height={} immediately.",
                        lock.width, lock.height, lock.ratio, file_name, meta.width, meta.height, lock.width, lock.height
                    ));
                }
                if meta
                    .scenes
                    .iter()
                    .any(|s| s.audio.is_some() || s.sfx.is_some())
                {
                    feedback.has_errors = true;
                    feedback.diagnostics.push(
                        "ERROR (MICROSTOCK_AUDIO_FORBIDDEN): Adobe Stock Mode ('M') requires silent video (-an). Remove all `audio` and `sfx` entries from SCENES."
                            .to_string(),
                    );
                }
                let lower_html = content.to_ascii_lowercase();
                if lower_html.contains("<text") || lower_html.contains("<tspan") {
                    feedback.diagnostics.push(format!(
                        "WARNING (MICROSTOCK_TEXT_FORBIDDEN): Adobe Stock Mode ('M') recommends avoiding added SVG <text>/<tspan> elements in '{}' unless part of an uploaded greeting card stage.",
                        file_name
                    ));
                }
                if has_forbidden_external_url(&lower_html) {
                    feedback.has_errors = true;
                    feedback.diagnostics.push(format!(
                        "ERROR (MICROSTOCK_EXTERNAL_URL): Adobe Stock Mode ('M') forbids external http(s):// URLs (CDNs, Google Fonts) in '{}'. Remove external links and use inline CSS/offline scripts.",
                        file_name
                    ));
                }
            }

            let audio_files_on_disk = count_audio_files_on_disk(film_dir, ws_root);
            let scenes_with_audio = meta.scenes.iter().filter(|s| s.audio.is_some()).count();
            if audio_files_on_disk > 0 && scenes_with_audio == 0 {
                feedback.has_errors = true;
                feedback.diagnostics.push(format!(
                    "ERROR (UNLINKED_SCENE_AUDIO): Found {} audio file(s) in audio/, but parsed 0 audio links on film scenes. Put scene entries with audio: '/audio/<file>.wav' inside a literal SCENES = [...] array.",
                    audio_files_on_disk
                ));
            }

            for scene in &meta.scenes {
                if let Some(ref audio_rel) = scene.audio {
                    if !workspace_asset_exists(film_dir, ws_root, audio_rel) {
                        feedback.diagnostics.push(format!(
                            "WARNING (MISSING_AUDIO_FILE): Scene '{}' references audio '{}', which does not exist on disk.",
                            scene.id, audio_rel
                        ));
                    }
                }
                if let Some(ref words_rel) = scene.words {
                    if !workspace_asset_exists(film_dir, ws_root, words_rel) {
                        feedback.diagnostics.push(format!(
                            "WARNING (MISSING_WORDS_FILE): Scene '{}' references words '{}', which does not exist on disk.",
                            scene.id, words_rel
                        ));
                    }
                }
            }

            for script_rel in extract_local_script_srcs(&content) {
                if script_rel.eq_ignore_ascii_case("script/aetheria-motion.js")
                    || crate::studio::builtin_runtime::is_builtin_post_path(&script_rel)
                    || crate::studio::builtin_runtime::is_builtin_stage_path(&script_rel)
                    || crate::studio::builtin_runtime::is_builtin_tracks_path(&script_rel)
                    || crate::studio::builtin_runtime::is_builtin_story_camera_path(&script_rel)
                    || crate::studio::builtin_runtime::is_builtin_three_path(&script_rel)
                {
                    continue;
                }
                if !workspace_asset_exists(film_dir, ws_root, &script_rel) {
                    if load_film_json(film_dir).is_some() {
                        feedback.has_errors = true;
                        feedback.wiring_error = true;
                        feedback.diagnostics.push(format!(
                            "ERROR (MISSING_SCRIPT_FILE): Referenced script '{}' does not exist on disk.",
                            script_rel
                        ));
                    } else {
                        feedback.diagnostics.push(format!(
                            "WARNING (MISSING_SCRIPT_FILE): Referenced script '{}' does not exist on disk yet.",
                            script_rel
                        ));
                    }
                }
            }

            check_html_scene_wiring(film_dir, ws_root, &content, &meta, &mut feedback);

            if (content.contains("id=\"loading\"") || content.contains("id='loading'"))
                && !meta.lint.has_ready_flag
            {
                feedback.diagnostics.push(
                    "WARNING (LOADER_WITHOUT_READY_FLAG): Found #loading element without `window.__ready = true`. Set `window.__ready = true` cleanly after initial renderAt(0) for reliable headless MP4 export."
                        .to_string(),
                );
            }
        }
        _ => {}
    }

    feedback
}

/// Deterministically inserts missing `<script src="..."></script>` tags into `index.html`.
pub fn repair_missing_html_script_tags(html: &str, missing_scripts: &[String]) -> Option<String> {
    let existing = extract_local_script_srcs(html);
    let mut insertions = Vec::new();
    for raw_rel in missing_scripts {
        let norm = raw_rel.trim().trim_start_matches("./").trim_start_matches('/');
        if norm.is_empty()
            || !norm.starts_with("script/")
            || !norm.ends_with(".js")
            || existing.iter().any(|s| s.eq_ignore_ascii_case(norm))
            || insertions
                .iter()
                .any(|s: &String| s.eq_ignore_ascii_case(norm))
        {
            continue;
        }
        insertions.push(norm.to_string());
    }
    if insertions.is_empty() {
        return None;
    }

    let snippet: String = insertions
        .iter()
        .map(|s| format!("  <script src=\"{}\"></script>\n", s))
        .collect();
    let mut updated = html.to_string();
    let lower = updated.to_ascii_lowercase();
    if let Some(inline_idx) = lower.find("<script>") {
        updated.insert_str(inline_idx, &snippet);
    } else if let Some(body_end) = lower.rfind("</body>") {
        updated.insert_str(body_end, &snippet);
    } else {
        updated.push('\n');
        updated.push_str(&snippet);
    }
    Some(updated)
}

/// Attaches structured diagnostics and inspected film metadata to a write/edit/patch tool result.
pub fn attach_post_write_feedback(result: &mut Value, workspace_dir: &str, target: &Path) {
    let feedback = collect_file_feedback(workspace_dir, target);
    if let Some(obj) = result.as_object_mut() {
        if let Some(meta) = feedback.film_meta {
            obj.insert("filmMeta".to_string(), meta);
        }
        if !feedback.diagnostics.is_empty() {
            obj.insert("diagnostics".to_string(), json!(feedback.diagnostics));
            if feedback.wiring_error {
                obj.insert("ok".to_string(), json!(false));
            }
            if feedback.has_errors {
                obj.insert(
                    "actionRequired".to_string(),
                    json!("Fix the reported ERROR diagnostics before finishing."),
                );
            }
        }
        if let Some(film_dir) = super::film_state::resolve_film_dir_from_target(workspace_dir, target) {
            let is_hybrid_project = load_film_json(&film_dir)
                .and_then(|m| m.stage_mode)
                .is_some_and(|s| s.eq_ignore_ascii_case("hybrid"));
            let script_dir = film_dir.join("script");
            let index_path = film_dir.join("index.html");
            if !is_hybrid_project && index_path.is_file() && script_dir.is_dir() {
                if let (Ok(html_raw), Ok(entries)) =
                    (std::fs::read_to_string(&index_path), std::fs::read_dir(&script_dir))
                {
                    let mut scene_files: Vec<String> = entries
                        .flatten()
                        .filter_map(|e| {
                            let name = e.file_name().to_string_lossy().to_string();
                            if name.to_ascii_lowercase().starts_with("scene")
                                && name.to_ascii_lowercase().ends_with(".js")
                            {
                                Some(format!("script/{}", name))
                            } else {
                                None
                            }
                        })
                        .collect();
                    scene_files.sort();
                    if let Some(repaired) = repair_missing_html_script_tags(&html_raw, &scene_files) {
                        let existing = extract_local_script_srcs(&html_raw);
                        let missing: Vec<String> = scene_files
                            .into_iter()
                            .filter(|s| !existing.iter().any(|e| e.eq_ignore_ascii_case(s)))
                            .collect();
                        if !missing.is_empty() {
                            obj.insert(
                                "repairSuggestion".to_string(),
                                json!({
                                    "target": "index.html",
                                    "missingScripts": missing,
                                    "hint": "Insert these <script src=\"...\"></script> tags into index.html before inline initialization.",
                                    "patchedBytes": repaired.len()
                                }),
                            );
                        }
                    }
                }
            }
            if let Some(progress) = super::film_state::collect_film_scene_progress(&film_dir) {
                obj.insert("sceneProgress".to_string(), progress.to_json());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_feedback_catches_short_hex_and_math_random() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_js_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let scene_path = dir.join("scene2.js");
        std::fs::write(
            &scene_path,
            "function draw(AM) {\n  const c = AM.mixHex('#ff0000', '#000', 0.4);\n  const r = Math.random();\n  return c + r;\n}\n",
        )
        .unwrap();

        let fb = collect_file_feedback(&dir.to_string_lossy(), &scene_path);
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("SHORT_HEX_COLOR") && d.contains("L2")));
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("NONDETERMINISTIC_MATH_RANDOM") && d.contains("L3")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_html_feedback_flags_unlinked_audio_when_audio_files_exist() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_html_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("audio")).unwrap();
        std::fs::create_dir_all(dir.join("script")).unwrap();
        std::fs::write(dir.join("audio").join("scene1.wav"), b"RIFF0000WAVE").unwrap();
        std::fs::write(dir.join("script").join("scene1.js"), "function r1(){}").unwrap();

        let html = r#"<!DOCTYPE html><html><head><style>body{min-height:100vh}</style></head>
        <body><div id="loading"></div><canvas id="film" width="1080" height="1920"></canvas>
        <script>
        window.__filmMeta = { title: "Demo", width: 1080, height: 1920, fps: 30, duration: 20 };
        window.renderAt = function(t) {};
        </script></body></html>"#;
        let html_path = dir.join("index.html");
        std::fs::write(&html_path, html).unwrap();

        let fb = collect_file_feedback(&dir.to_string_lossy(), &html_path);
        assert!(fb.has_errors);
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("UNLINKED_SCENE_AUDIO")));
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("LOADER_WITHOUT_READY_FLAG")));
        let meta = fb.film_meta.unwrap();
        assert_eq!(meta["width"], 1080);
        assert_eq!(meta["height"], 1920);
        assert_eq!(meta["audioTracksResolved"], 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_webgl_renderer_requires_preserve_drawing_buffer_and_builtin_three_no_warning() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_webgl_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("script")).unwrap();

        let bad_kit = dir.join("script").join("clay-kit.js");
        std::fs::write(
            &bad_kit,
            "function initStage(c){ return new THREE.WebGLRenderer({ canvas: c, antialias: true }); }\n",
        )
        .unwrap();
        let fb_bad = collect_file_feedback(&dir.to_string_lossy(), &bad_kit);
        assert!(fb_bad.has_errors);
        assert!(fb_bad
            .diagnostics
            .iter()
            .any(|d| d.contains("WEBGL_MISSING_PRESERVE_DRAWING_BUFFER")));

        let html = r#"<!DOCTYPE html><html><head><style>body{margin:0}</style>
        <script src="/script/three.min.js"></script>
        <script src="/script/aetheria-motion.js"></script>
        <script src="/script/clay-kit.js"></script></head>
        <body><canvas id="c" width="1080" height="1920"></canvas>
        <script>
        window.__filmMeta = { title: "Clay", width: 1080, height: 1920, fps: 30, duration: 8 };
        window.renderAt = function(t) {};
        window.__ready = true;
        </script></body></html>"#;
        let html_path = dir.join("index.html");
        std::fs::write(&html_path, html).unwrap();

        let fb_html = collect_file_feedback(&dir.to_string_lossy(), &html_path);
        assert!(
            !fb_html
                .diagnostics
                .iter()
                .any(|d| d.contains("MISSING_SCRIPT_FILE") && d.contains("three.min.js")),
            "builtin /script/three.min.js should never report MISSING_SCRIPT_FILE: {:?}",
            fb_html.diagnostics
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn microstock_lock_flags_portrait_mismatch_audio_and_text() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_ms_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("script")).unwrap();
        crate::studio::microstock::manifest::save_workspace_mode(&dir, true, "1920x1080", 30)
            .unwrap();

        let js_path = dir.join("script").join("scene1.js");
        std::fs::write(
            &js_path,
            "function r(ctx,w){ AM.drawSubtitles(ctx, w, 0); }\n",
        )
        .unwrap();
        let fb_js = collect_file_feedback(&dir.to_string_lossy(), &js_path);
        assert!(fb_js.has_errors);
        assert!(fb_js
            .diagnostics
            .iter()
            .any(|d| d.contains("MICROSTOCK_TEXT_FORBIDDEN")));

        let html_path = dir.join("index.html");
        std::fs::write(
            &html_path,
            r#"<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><script src="/script/scene1.js"></script></head><body><svg xmlns="http://www.w3.org/2000/svg"><text>Merry</text></svg><canvas width="1080" height="1920"></canvas><script>
            var SCENES = [{ id: "scene1", duration: 6, audio: "audio/scene1.wav" }];
            window.__filmMeta = { title: "Bad", width: 1080, height: 1920, fps: 30, duration: 6, scenes: SCENES };
            window.renderAt = function(t){}; window.__ready = true;
            </script></body></html>"#,
        )
        .unwrap();
        let fb_html = collect_file_feedback(&dir.to_string_lossy(), &html_path);
        assert!(fb_html.has_errors);
        assert!(fb_html
            .diagnostics
            .iter()
            .any(|d| d.contains("MICROSTOCK_RATIO_MISMATCH")));
        assert!(fb_html
            .diagnostics
            .iter()
            .any(|d| d.contains("MICROSTOCK_AUDIO_FORBIDDEN")));
        assert!(fb_html
            .diagnostics
            .iter()
            .any(|d| d.contains("MICROSTOCK_TEXT_FORBIDDEN")));
        assert!(fb_html
            .diagnostics
            .iter()
            .any(|d| d.contains("MICROSTOCK_EXTERNAL_URL")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_wiring_flags_mismatched_scene_id_and_unregistered_scene_file() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_wiring_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ws = dir.to_string_lossy().to_string();

        let scaffold_res = super::super::film_scaffold::execute_film_scaffold(
            "ses_w",
            &ws,
            &json!({
                "title": "Wiring Test",
                "preset": "landscape",
                "scenes": [
                    { "id": "scene1_intro", "duration": 5.0 }
                ]
            }),
        );
        assert_eq!(scaffold_res["ok"], true);
        let film_root = dir.join(scaffold_res["filmRoot"].as_str().unwrap());

        // 1. Write unregistered script/scene9.js -> must fail wiring with UNREGISTERED_SCENE_FILE
        let s9 = film_root.join("script").join("scene9.js");
        std::fs::write(&s9, "AM.registerScene('scene9', function(){});").unwrap();
        let fb9 = collect_file_feedback(&ws, &s9);
        assert!(fb9.wiring_error);
        assert!(fb9
            .diagnostics
            .iter()
            .any(|d| d.contains("UNREGISTERED_SCENE_FILE") && d.contains("scene9.js")));

        // 2. Write script/scene1.js with wrong ID -> SCENE_ID_MISMATCH + ok: false via attach_post_write_feedback
        let s1 = film_root.join("script").join("scene1.js");
        std::fs::write(&s1, "AM.registerScene('wrong_id', function(){});").unwrap();
        let mut tool_res = json!({ "ok": true });
        attach_post_write_feedback(&mut tool_res, &ws, &s1);
        assert_eq!(tool_res["ok"], false);
        let diags_str = tool_res["diagnostics"].to_string();
        assert!(diags_str.contains("SCENE_ID_MISMATCH"));

        // 2b. Write script/scene1.js without any AM.registerScene call -> MISSING_REGISTER_SCENE + ok: false
        std::fs::write(&s1, "var broken = 1;").unwrap();
        let mut tool_res_missing = json!({ "ok": true });
        attach_post_write_feedback(&mut tool_res_missing, &ws, &s1);
        assert_eq!(tool_res_missing["ok"], false);
        assert!(tool_res_missing["diagnostics"]
            .to_string()
            .contains("MISSING_REGISTER_SCENE"));

        // 3. Fix scene1.js with matching ID -> no wiring error and disk sceneProgress reports drafted=1
        std::fs::write(&s1, "AM.registerScene('scene1_intro', function(ctx){ ctx.fillRect(0,0,10,10); });").unwrap();
        let mut tool_res_ok = json!({ "ok": true });
        attach_post_write_feedback(&mut tool_res_ok, &ws, &s1);
        assert_eq!(tool_res_ok["ok"], true, "unexpected wiring error: {:?}", tool_res_ok);
        assert_eq!(tool_res_ok["sceneProgress"]["drafted"], json!(1));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_claykit_scene_forbids_dark_top_header_overlays() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_claykit_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let script_dir = dir.join("script");
        std::fs::create_dir_all(&script_dir).unwrap();
        std::fs::write(script_dir.join("clay-kit.js"), "(function(){})();").unwrap();

        let s1 = script_dir.join("scene1.js");
        std::fs::write(
            &s1,
            "AM.registerScene('s1', function(ctx, t, dur, sc){ AM.drawTopHeader(ctx, sc, t); });",
        )
        .unwrap();
        let fb = collect_file_feedback(&dir.to_string_lossy(), &s1);
        assert!(fb.has_errors);
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("CLAYKIT_DARK_OVERLAY_FORBIDDEN")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_webgl_alpha_true_requires_explicit_background_or_gradient() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_webgl_alpha_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let script_dir = dir.join("script");
        std::fs::create_dir_all(&script_dir).unwrap();

        // Managed index.html with default dark #0f1115
        std::fs::write(
            dir.join("index.html"),
            "<style>#stage { background: #0f1115; }</style>",
        )
        .unwrap();

        let s1 = script_dir.join("scene1.js");
        std::fs::write(
            &s1,
            "var r = new THREE.WebGLRenderer({ canvas: c, alpha: true, preserveDrawingBuffer: true });",
        )
        .unwrap();
        let fb_fail = collect_file_feedback(&dir.to_string_lossy(), &s1);
        assert!(fb_fail.has_errors);
        assert!(fb_fail
            .diagnostics
            .iter()
            .any(|d| d.contains("WEBGL_ALPHA_MISSING_BACKGROUND")));

        // Setting scene.background in JS passes cleanly
        std::fs::write(
            &s1,
            "scene.background = new THREE.Color(0x93c5fd);\nvar r = new THREE.WebGLRenderer({ canvas: c, alpha: true, preserveDrawingBuffer: true });",
        )
        .unwrap();
        let fb_scene_bg = collect_file_feedback(&dir.to_string_lossy(), &s1);
        assert!(!fb_scene_bg
            .diagnostics
            .iter()
            .any(|d| d.contains("WEBGL_ALPHA_MISSING_BACKGROUND")));

        // Or setting CSS #stage linear-gradient in sibling index.html passes cleanly
        std::fs::write(
            dir.join("index.html"),
            "<style>#stage { background: linear-gradient(180deg, #93C5FD 0%, #E0F2FE 100%); }</style>",
        )
        .unwrap();
        std::fs::write(
            &s1,
            "var r = new THREE.WebGLRenderer({ canvas: c, alpha: true, preserveDrawingBuffer: true });",
        )
        .unwrap();
        let fb_grad = collect_file_feedback(&dir.to_string_lossy(), &s1);
        assert!(!fb_grad
            .diagnostics
            .iter()
            .any(|d| d.contains("WEBGL_ALPHA_MISSING_BACKGROUND")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_repair_missing_html_script_tags_and_unreferenced_scene_warning() {
        let dir = std::env::temp_dir().join(format!("aetheria_fb_repair_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("script")).unwrap();
        let html = "<!DOCTYPE html><html><body><canvas id=\"c\"></canvas><script src=\"script/scene1.js\"></script><script>window.renderAt=function(){};</script></body></html>";
        std::fs::write(dir.join("index.html"), html).unwrap();
        let s2 = dir.join("script").join("scene2.js");
        std::fs::write(&s2, "AM.registerScene('s2', function(){});").unwrap();

        let fb = collect_file_feedback(&dir.to_string_lossy(), &s2);
        assert!(fb
            .diagnostics
            .iter()
            .any(|d| d.contains("UNREFERENCED_SCENE_SCRIPT") && d.contains("script/scene2.js")));

        let repaired = repair_missing_html_script_tags(
            html,
            &["script/scene1.js".to_string(), "script/scene2.js".to_string()],
        )
        .expect("missing scene2.js should generate repaired HTML");
        assert!(repaired.contains("<script src=\"script/scene2.js\"></script>"));
        assert!(repaired.find("script/scene2.js").unwrap() < repaired.find("window.renderAt").unwrap());
        assert!(repair_missing_html_script_tags(&repaired, &["script/scene2.js".to_string()]).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
