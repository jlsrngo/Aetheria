//! Web Image Fetch Tool — searches Wikipedia / Wikimedia Commons or direct URLs
//! and downloads editorial photos or fallback illustrations into the project's `img/` subfolder.

use serde_json::{json, Value};
use std::path::PathBuf;

use super::path_guard::resolve_isolated_path;
use super::websearch::encode_query;

pub fn fetch_web_image_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "fetch_web_image",
            "description": "Searches the internet (Wikimedia Commons, Wikipedia, or direct URL) and downloads a real photo, 3D illustration, icon, or portrait into `img/<filename>` inside the active project folder so you can preload it via `AM.loadImage('/img/<filename>')` and draw it via `AM.drawImageFit(...)`. Set `removeBackground: true` to automatically cut out solid white/uniform corners into a transparent PNG.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for the image/photo/3D object on the internet (e.g. 'human brain anatomy 3D', 'archery target bullseye png', 'Rami Malek portrait')."
                    },
                    "outputPath": {
                        "type": "string",
                        "description": "Destination path inside the active project's img/ subfolder (e.g. 'img/brain.png' or 'img/target.png')."
                    },
                    "url": {
                        "type": "string",
                        "description": "Optional direct image URL (https://...) if known."
                    },
                    "removeBackground": {
                        "type": "boolean",
                        "description": "Optional. Set true to automatically cut out studio/uniform/solid backgrounds into a clean auto-trimmed transparent PNG using GrabCut."
                    },
                    "candidateIndex": {
                        "type": "integer",
                        "description": "Optional 0-based index (default 0) to pick an alternate candidate from the ranked search results if candidate 0 did not visually match."
                    },
                    "targetLuma": {
                        "type": "number",
                        "description": "Optional target foreground brightness (0-255, LAB L-channel mean) to smoothly tone-grade the downloaded asset to match the reference object brightness."
                    },
                    "targetSat": {
                        "type": "number",
                        "description": "Optional target foreground saturation (0-255, HSV S-channel mean) to smoothly tone-grade the downloaded asset (e.g. lower value for matte/muted subjects, higher for vivid subjects)."
                    }
                },
                "required": ["query", "outputPath"]
            }
        }
    })
}

/// Normalizes an LLM-provided image output path so assets land cleanly inside `img/`
/// without leaking legacy `workspace/` or `public/` prefixes.
fn normalize_image_rel_path(raw_out: &str) -> String {
    let mut s = raw_out.trim().replace('\\', "/");
    while let Some(rest) = s.strip_prefix("./").or_else(|| s.strip_prefix('/')) {
        s = rest.to_string();
    }
    if let Some(rest) = s.strip_prefix("workspace/") {
        s = rest.to_string();
    }
    if let Some(rest) = s.strip_prefix("public/") {
        s = if rest.starts_with("img/") {
            rest.to_string()
        } else {
            format!("img/{}", rest)
        };
    }
    if s.is_empty() {
        return "img/web_image.jpg".to_string();
    }
    if !s.contains('/') {
        return format!("img/{}", s);
    }
    s
}

fn is_search_noise_token(token: &str) -> bool {
    matches!(
        token,
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "svg"
            | "transparent"
            | "isolated"
            | "background"
            | "white"
            | "black"
            | "cutout"
            | "cut"
            | "out"
            | "clipart"
            | "stock"
            | "photo"
            | "picture"
            | "image"
            | "icon"
            | "render"
            | "hd"
            | "4k"
            | "free"
            | "no"
            | "without"
            | "on"
            | "with"
            | "of"
            | "the"
            | "a"
            | "an"
    )
}

fn is_view_style_modifier(token: &str) -> bool {
    matches!(
        token,
        "side"
            | "view"
            | "front"
            | "top"
            | "angle"
            | "profile"
            | "shot"
            | "closeup"
            | "close"
            | "up"
            | "3d"
            | "realistic"
            | "illustration"
            | "drawing"
            | "art"
            | "vector"
    )
}

/// Builds up to 3 progressively broader search queries for Wikimedia Commons / Wikipedia so
/// overly specific asset hints (e.g. "isolated transparent png", truncated tokens) still find hits.
pub(crate) fn build_image_search_queries(raw_query: &str) -> Vec<String> {
    let cleaned: Vec<String> = raw_query
        .to_ascii_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 2 && !is_search_noise_token(w))
        .map(str::to_string)
        .collect();

    let mut out: Vec<String> = Vec::new();
    let mut push_unique = |cand: String| {
        let trimmed = cand.trim();
        if !trimmed.is_empty() && !out.iter().any(|existing| existing == trimmed) && out.len() < 3 {
            out.push(trimmed.to_string());
        }
    };

    if !cleaned.is_empty() {
        push_unique(cleaned.join(" "));
        let core: Vec<String> = cleaned
            .iter()
            .filter(|w| !is_view_style_modifier(w.as_str()))
            .cloned()
            .collect();
        if !core.is_empty() {
            push_unique(core.join(" "));
            if core.len() > 2 {
                push_unique(core[..2].join(" "));
            }
        }
        if cleaned.len() > 2 {
            push_unique(cleaned[..2].join(" "));
        }
    }

    if out.is_empty() {
        let trimmed = raw_query.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }
    out
}

pub(crate) fn is_labeled_or_diagram_title(title_lower: &str) -> bool {
    const LABELED_OR_DIAGRAM_TOKENS: &[&str] = &[
        "diagram",
        "chart",
        "map",
        "scan",
        "mri",
        "xray",
        "x-ray",
        "slice",
        "histology",
        "description",
        "cut-line",
        "cut_line",
        "lateralization",
        "dissected",
        "autopsy",
        "printed",
        "printing",
        "support",
        "vat",
        "patent",
        "wellcome",
        "labeled",
        "labelled",
        "labels",
        "infographic",
        "schematic",
        "numbered",
        "bioart",
        "clipart",
        "sketch",
        "outline",
        "black and white",
        "black_and_white",
        "line art",
        "line_art",
    ];
    LABELED_OR_DIAGRAM_TOKENS
        .iter()
        .any(|tok| title_lower.contains(tok))
}

pub(crate) fn merge_commons_and_openverse_candidates(
    mut commons_scored: Vec<(i32, String, String)>,
    openverse_hits: Vec<(String, String)>,
    wants_realistic: bool,
) -> Vec<(String, String)> {
    commons_scored.sort_by(|a, b| b.0.cmp(&a.0));
    let mut clean_commons: Vec<(String, String)> = Vec::new();
    let mut noisy_commons: Vec<(String, String)> = Vec::new();
    for (score, title, url) in commons_scored {
        let low = title.to_ascii_lowercase();
        let is_noisy = wants_realistic && (score <= 0 || is_labeled_or_diagram_title(&low));
        if is_noisy {
            noisy_commons.push((title, url));
        } else {
            clean_commons.push((title, url));
        }
    }

    let mut clean_ov: Vec<(String, String)> = Vec::new();
    let mut noisy_ov: Vec<(String, String)> = Vec::new();
    for (title, url) in openverse_hits {
        let low = title.to_ascii_lowercase();
        if wants_realistic && is_labeled_or_diagram_title(&low) {
            noisy_ov.push((title, url));
        } else {
            clean_ov.push((title, url));
        }
    }

    let mut merged: Vec<(String, String)> = Vec::new();
    for bucket in [clean_commons, clean_ov, noisy_commons, noisy_ov] {
        for (title, url) in bucket {
            if !merged.iter().any(|(_, existing)| existing == &url) {
                merged.push((title, url));
            }
        }
    }
    merged
}

pub(crate) fn score_commons_filename(
    title_lower: &str,
    keywords: &[String],
    prefer_png: bool,
    wants_realistic: bool,
) -> i32 {
    let mut score: i32 = 0;
    for kw in keywords {
        if title_lower.contains(kw) {
            score += 10;
        }
    }
    if prefer_png && title_lower.ends_with(".png") {
        // When realistic photos/3D renders are desired, don't let line-art PNGs outweigh clean JPEGs.
        score += if wants_realistic { 2 } else { 6 };
    }
    if wants_realistic {
        for good in ["3d", "render", "model", "photo", "real", "lateral", "view", "isolated", "cutout"] {
            if title_lower.contains(good) {
                score += 6;
            }
        }
        for bad_style in [
            "bioart",
            "clipart",
            "line",
            "sketch",
            "icon",
            "cartoon",
            "outline",
            "black and white",
            "black_and_white",
            "drawing",
            "illustration",
        ] {
            if title_lower.contains(bad_style) {
                score -= 18;
            }
        }
    } else if title_lower.contains("3d") || title_lower.contains("render") || title_lower.contains("model") {
        score += 3;
    }
    for noise in [
        "diagram",
        "chart",
        "map",
        "scan",
        "mri",
        "xray",
        "x-ray",
        "slice",
        "histology",
        "description",
        "cut-line",
        "cut_line",
        "lateralization",
        "dissected",
        "autopsy",
        "printed",
        "printing",
        "support",
        "vat",
        "patent",
        "wellcome",
        "labeled",
        "labelled",
        "labels",
        "infographic",
        "schematic",
        "numbered",
    ] {
        if title_lower.contains(noise) {
            score -= 45;
        }
    }
    score
}

pub async fn execute_fetch_web_image(workspace_dir: &str, arguments: &Value) -> Value {
    let query = arguments
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let raw_out = arguments
        .get("outputPath")
        .or_else(|| arguments.get("output_path"))
        .or_else(|| arguments.get("filename"))
        .and_then(|v| v.as_str())
        .unwrap_or("img/web_image.jpg")
        .trim();
    let direct_url = arguments
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let remove_bg = arguments
        .get("removeBackground")
        .or_else(|| arguments.get("remove_background"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let candidate_index = arguments
        .get("candidateIndex")
        .or_else(|| arguments.get("candidate_index"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let target_luma = arguments
        .get("targetLuma")
        .or_else(|| arguments.get("target_luma"))
        .and_then(|v| v.as_f64())
        .map(|v| v.clamp(20.0, 245.0));
    let target_sat = arguments
        .get("targetSat")
        .or_else(|| arguments.get("target_sat"))
        .and_then(|v| v.as_f64())
        .map(|v| v.clamp(0.0, 240.0));

    if query.is_empty() && direct_url.is_empty() {
        return json!({ "error": "fetch_web_image requires 'query' or 'url'." });
    }

    let mut clean_rel = normalize_image_rel_path(raw_out);
    if remove_bg && !clean_rel.to_ascii_lowercase().ends_with(".png") {
        let stem = std::path::Path::new(&clean_rel)
            .with_extension("png")
            .to_string_lossy()
            .replace('\\', "/");
        clean_rel = stem;
    }
    let target_out: PathBuf = if std::path::Path::new(raw_out).is_absolute() {
        match resolve_isolated_path(workspace_dir, raw_out) {
            Ok(p) => p,
            Err(e) => return json!({ "error": e }),
        }
    } else {
        match resolve_isolated_path(workspace_dir, &clean_rel) {
            Ok(p) => p,
            Err(e) => return json!({ "error": e }),
        }
    };
    if let Some(parent) = target_out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let asset_name = target_out
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "web_image.jpg".to_string());
    let asset_rel = if clean_rel.starts_with("img/") {
        clean_rel.clone()
    } else {
        format!("img/{}", asset_name)
    };

    let client = reqwest::Client::builder()
        .user_agent("AetheriaNexus/1.0 (https://github.com/jlsrngo/AetheriaNexus; studio@aetheria.ai)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let mut candidates: Vec<(String, String)> = Vec::new();
    if !direct_url.is_empty() {
        candidates.push(("direct_url".to_string(), direct_url.to_string()));
    }

    if !query.is_empty() {
        let q_lower = query.to_ascii_lowercase();
        let prefer_commons = remove_bg
            || q_lower.contains("png")
            || q_lower.contains("transparent")
            || q_lower.contains("icon")
            || q_lower.contains("3d")
            || q_lower.contains("isolated");
        let wants_realistic = !q_lower.contains("icon")
            && !q_lower.contains("flat")
            && !q_lower.contains("diagram")
            && !q_lower.contains("outline")
            && !q_lower.contains("sketch")
            && !q_lower.contains("vector");

        let fetch_commons = |q: String, prefer_png: bool, wants_realistic: bool| {
            let client = client.clone();
            async move {
                let mut scored: Vec<(i32, String, String)> = Vec::new();
                let keywords: Vec<String> = q
                    .to_ascii_lowercase()
                    .split(|c: char| !c.is_ascii_alphanumeric())
                    .filter(|w| w.len() >= 3 && !matches!(*w, "png" | "jpg" | "transparent" | "isolated" | "icon" | "background" | "white"))
                    .map(str::to_string)
                    .collect();
                // CRITICAL: `gsrnamespace=6` restricts Wikimedia Commons search strictly to `File:` pages!
                let commons_api = format!(
                    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={}&gsrlimit=15&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=900&format=json",
                    encode_query(&format!("filetype:bitmap {}", q))
                );
                if let Ok(resp) = client.get(&commons_api).send().await {
                    if let Ok(data) = resp.json::<Value>().await {
                        if let Some(pages) = data.pointer("/query/pages").and_then(|v| v.as_object()) {
                            for (_id, page) in pages {
                                let raw_title = page
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("");
                                let title = raw_title.to_ascii_lowercase();
                                if title.ends_with(".svg")
                                    || title.ends_with(".tif")
                                    || title.ends_with(".tiff")
                                    || title.ends_with(".pdf")
                                    || title.ends_with(".djvu")
                                    || title.ends_with(".webm")
                                    || title.ends_with(".ogv")
                                    || title.ends_with(".gif")
                                {
                                    continue;
                                }
                                let score = score_commons_filename(&title, &keywords, prefer_png, wants_realistic);
                                if let Some(arr) = page.get("imageinfo").and_then(|v| v.as_array()) {
                                    for info in arr {
                                        let mime = info
                                            .get("mime")
                                            .and_then(Value::as_str)
                                            .unwrap_or("");
                                        if !mime.is_empty()
                                            && !mime.starts_with("image/png")
                                            && !mime.starts_with("image/jpeg")
                                            && !mime.starts_with("image/webp")
                                        {
                                            continue;
                                        }
                                        if let Some(u) = info
                                            .get("thumburl")
                                            .or_else(|| info.get("url"))
                                            .and_then(|v| v.as_str())
                                        {
                                            scored.push((score, raw_title.to_string(), u.to_string()));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                scored.sort_by(|a, b| b.0.cmp(&a.0));
                scored
            }
        };

        let fetch_wikipedia = |q: String| {
            let client = client.clone();
            async move {
                let mut urls = Vec::new();
                let wp_api = format!(
                    "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch={}&gsrlimit=5&prop=pageimages&piprop=thumbnail|original&pithumbsize=900&format=json",
                    encode_query(&q)
                );
                if let Ok(resp) = client.get(&wp_api).send().await {
                    if let Ok(data) = resp.json::<Value>().await {
                        if let Some(pages) = data.pointer("/query/pages").and_then(|v| v.as_object()) {
                            for (_id, page) in pages {
                                let title = page
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("wikipedia")
                                    .to_string();
                                if let Some(thumb) = page.pointer("/thumbnail/source").and_then(|v| v.as_str()) {
                                    urls.push((title.clone(), thumb.to_string()));
                                }
                                if let Some(orig) = page.pointer("/original/source").and_then(|v| v.as_str()) {
                                    if !orig.ends_with(".svg") && !orig.ends_with(".tif") && !orig.ends_with(".pdf") {
                                        urls.push((title, orig.to_string()));
                                    }
                                }
                            }
                        }
                    }
                }
                urls
            }
        };

        let fetch_openverse = |q: String| {
            let client = client.clone();
            async move {
                let mut urls = Vec::new();
                let ov_api = format!(
                    "https://api.openverse.org/v1/images/?q={}&page_size=8",
                    encode_query(&q)
                );
                if let Ok(resp) = client.get(&ov_api).send().await {
                    if let Ok(data) = resp.json::<Value>().await {
                        if let Some(results) = data.get("results").and_then(Value::as_array) {
                            for item in results {
                                let title = item
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("openverse")
                                    .to_string();
                                if let Some(u) = item
                                    .get("url")
                                    .or_else(|| item.get("thumbnail"))
                                    .and_then(Value::as_str)
                                {
                                    if u.starts_with("https://") {
                                        urls.push((title, u.to_string()));
                                    }
                                }
                            }
                        }
                    }
                }
                urls
            }
        };

        fn push_unique_cands(
            candidates: &mut Vec<(String, String)>,
            hits: Vec<(String, String)>,
        ) {
            for (t, u) in hits {
                if !candidates.iter().any(|(_, existing)| existing == &u) {
                    candidates.push((t, u));
                }
            }
        }

        let search_queries = build_image_search_queries(query);
        if prefer_commons {
            let mut commons_scored_all: Vec<(i32, String, String)> = Vec::new();
            for sq in &search_queries {
                let hits = fetch_commons(sq.clone(), true, wants_realistic).await;
                for item in hits {
                    if !commons_scored_all.iter().any(|(_, _, u)| u == &item.2) {
                        commons_scored_all.push(item);
                    }
                }
                let has_clean_commons = commons_scored_all
                    .iter()
                    .any(|(sc, t, _)| *sc > 0 && (!wants_realistic || !is_labeled_or_diagram_title(&t.to_ascii_lowercase())));
                if has_clean_commons && commons_scored_all.len() >= 6 {
                    break;
                }
            }
            let has_clean_commons = commons_scored_all
                .iter()
                .any(|(sc, t, _)| *sc > 0 && (!wants_realistic || !is_labeled_or_diagram_title(&t.to_ascii_lowercase())));
            let mut openverse_hits: Vec<(String, String)> = Vec::new();
            if !has_clean_commons {
                if let Some(sq) = search_queries.first() {
                    openverse_hits = fetch_openverse(sq.clone()).await;
                }
            }
            push_unique_cands(
                &mut candidates,
                merge_commons_and_openverse_candidates(commons_scored_all, openverse_hits, wants_realistic),
            );
            if candidates.is_empty() {
                for sq in &search_queries {
                    let hits = fetch_wikipedia(sq.clone()).await;
                    if !hits.is_empty() {
                        push_unique_cands(&mut candidates, hits);
                        break;
                    }
                }
            }
        } else {
            for sq in &search_queries {
                let hits = fetch_wikipedia(sq.clone()).await;
                if !hits.is_empty() {
                    push_unique_cands(&mut candidates, hits);
                    break;
                }
            }
            if candidates.is_empty() {
                let mut commons_scored_all: Vec<(i32, String, String)> = Vec::new();
                for sq in &search_queries {
                    let hits = fetch_commons(sq.clone(), false, wants_realistic).await;
                    if !hits.is_empty() {
                        commons_scored_all.extend(hits);
                        break;
                    }
                }
                let has_clean_commons = commons_scored_all
                    .iter()
                    .any(|(sc, t, _)| *sc > 0 && (!wants_realistic || !is_labeled_or_diagram_title(&t.to_ascii_lowercase())));
                let openverse_hits = if !has_clean_commons {
                    if let Some(sq) = search_queries.first() {
                        fetch_openverse(sq.clone()).await
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                };
                push_unique_cands(
                    &mut candidates,
                    merge_commons_and_openverse_candidates(commons_scored_all, openverse_hits, wants_realistic),
                );
            }
        }
        if candidates.is_empty() {
            if let Some(sq) = search_queries.first() {
                push_unique_cands(&mut candidates, fetch_openverse(sq.clone()).await);
            }
        }
    }

    let candidate_summary: Vec<Value> = candidates
        .iter()
        .take(5)
        .enumerate()
        .map(|(idx, (t, u))| json!({ "index": idx, "title": t, "url": u }))
        .collect();

    let ordered_indices: Vec<usize> = if candidates.is_empty() {
        Vec::new()
    } else {
        let start = candidate_index.min(candidates.len() - 1);
        (start..candidates.len()).chain(0..start).collect()
    };

    let mut fallback_download: Option<Value> = None;
    let mut tried_color_fallback = false;
    let q_lower_check = query.to_ascii_lowercase();
    let wants_realistic_img = !query.is_empty()
        && !q_lower_check.contains("icon")
        && !q_lower_check.contains("flat")
        && !q_lower_check.contains("diagram")
        && !q_lower_check.contains("outline")
        && !q_lower_check.contains("sketch")
        && !q_lower_check.contains("vector");

    for (attempt_pos, idx) in ordered_indices.iter().copied().enumerate() {
        let (title, img_url) = &candidates[idx];
        if let Ok((status, bytes)) = super::webfetch::fetch_bounded_public_url(
            img_url,
            "AetheriaNexus/1.0 (https://github.com/jlsrngo/AetheriaNexus; studio@aetheria.ai)",
            15 * 1024 * 1024,
            15,
        )
        .await
        {
            if (200..300).contains(&status) && bytes.len() > 1024 {
                if tokio::fs::write(&target_out, &bytes).await.is_ok() {
                    let meta = postprocess_downloaded_image(
                        &target_out,
                        remove_bg,
                        target_luma,
                        target_sat,
                    )
                    .await;
                    let is_valid_raster = meta.width.is_some_and(|w| w > 0) && meta.height.is_some_and(|h| h > 0);
                    if !is_valid_raster {
                        let _ = tokio::fs::remove_file(&target_out).await;
                        continue;
                    }
                    let final_bytes = tokio::fs::metadata(&target_out)
                        .await
                        .map(|m| m.len())
                        .unwrap_or(bytes.len() as u64);

                    // Persist normalized asset metadata into project `assets.json` registry.
                    let film_root_for_reg = target_out
                        .parent()
                        .and_then(|p| {
                            if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case("img")) {
                                p.parent().map(std::path::Path::to_path_buf)
                            } else {
                                Some(p.to_path_buf())
                            }
                        })
                        .unwrap_or_else(|| PathBuf::from(workspace_dir));
                    let reg_rel = asset_rel.clone();
                    let reg_hints = crate::studio::asset_registry::AssetRegistrationHints {
                        width: meta.width,
                        height: meta.height,
                        has_alpha: Some(meta.has_alpha),
                        background_removed: meta.background_removed,
                        alpha_bbox: meta.alpha_bbox.clone(),
                        pivot: None,
                        source: Some(img_url.clone()),
                        query: if query.is_empty() { None } else { Some(query.to_string()) },
                        mean_hex: meta.mean_hex.clone(),
                        mean_luma: meta.mean_luma,
                        mean_sat: meta.mean_sat,
                    };
                    let registered = tokio::task::spawn_blocking(move || {
                        crate::studio::asset_registry::register_project_asset(
                            &film_root_for_reg,
                            &reg_rel,
                            &reg_hints,
                        )
                    })
                    .await
                    .ok()
                    .and_then(|r| r.ok());

                    let asset_id = registered
                        .as_ref()
                        .map(|r| r.id.clone())
                        .unwrap_or_else(|| crate::studio::asset_registry::derive_asset_id(&asset_rel));
                    let asset_kind = registered
                        .as_ref()
                        .map(|r| r.kind.clone())
                        .unwrap_or_else(|| {
                            if meta.background_removed || meta.has_alpha {
                                "raster_cutout".to_string()
                            } else {
                                "raster".to_string()
                            }
                        });

                    let resp_val = json!({
                        "success": true,
                        "query": query,
                        "selectedIndex": idx,
                        "selectedTitle": title,
                        "sourceUrl": img_url,
                        "outputPath": target_out.to_string_lossy().to_string(),
                        "assetId": asset_id,
                        "assetKind": asset_kind,
                        "assetPath": asset_rel,
                        "assetUrl": format!("/{}", asset_rel),
                        "manifestPath": crate::studio::asset_registry::ASSET_MANIFEST_FILENAME,
                        "bytes": final_bytes,
                        "width": meta.width,
                        "height": meta.height,
                        "hasAlpha": meta.has_alpha,
                        "alphaBbox": meta.alpha_bbox,
                        "backgroundRemoved": meta.background_removed,
                        "satP90": meta.sat_p90,
                        "meanLuma": meta.mean_luma,
                        "meanSat": meta.mean_sat,
                        "meanHex": meta.mean_hex,
                        "toneAdjusted": meta.tone_adjusted,
                        "candidates": candidate_summary,
                        "message": format!("Downloaded internet image to {} (registered as '{}' in assets.json; draw via `AM.drawAsset(ctx, '{}', x, y, w, h)` or `AM.loadImage('/{}')`)", asset_rel, asset_id, asset_id, asset_rel)
                    });
                    // Auto-skip achromatic B&W line-art sketches on candidate 0 when realistic color photo/3D is wanted
                    let is_bw_sketch = wants_realistic_img
                        && direct_url.is_empty()
                        && candidate_index == 0
                        && !tried_color_fallback
                        && attempt_pos + 1 < ordered_indices.len()
                        && meta.sat_p90.is_some_and(|sat| sat < 18.0);
                    if is_bw_sketch {
                        tried_color_fallback = true;
                        fallback_download = Some(resp_val);
                        continue;
                    }
                    return resp_val;
                }
            }
        }
    }
    if let Some(prev) = fallback_download {
        return prev;
    }

    json!({
        "success": false,
        "error": format!("No matching raster image found on Wikimedia Commons, Wikipedia, or Openverse for query '{}'. Try a simpler 2-3 word English query (e.g. 'human brain lateral' or 'archery target') or draw procedurally.", query),
        "query": query,
        "assetPath": asset_rel
    })
}

#[derive(Debug, Default)]
struct DownloadedImageMeta {
    width: Option<u32>,
    height: Option<u32>,
    has_alpha: bool,
    alpha_bbox: Option<crate::studio::asset_registry::AlphaBbox>,
    background_removed: bool,
    sat_p90: Option<f64>,
    mean_luma: Option<f64>,
    mean_sat: Option<f64>,
    mean_hex: Option<String>,
    tone_adjusted: bool,
}

/// Inspects downloaded raster image dimensions/alpha, performs studio-grade multi-quantile LAB border
/// flood-fill + OpenCV GrabCut cutout when `remove_bg` is requested, optionally tone-grades
/// foreground LAB luma / HSV saturation toward reference targets, and auto-trims transparent margins.
async fn postprocess_downloaded_image(
    path: &std::path::Path,
    remove_bg: bool,
    target_luma: Option<f64>,
    target_sat: Option<f64>,
) -> DownloadedImageMeta {
    let python = crate::paths::locate_python_binary();
    let script = r##"
import json, sys, cv2, numpy as np
p = sys.argv[1]
do_rm = sys.argv[2] == "1"
t_luma = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "" else None
t_sat = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "" else None
img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
if img is None:
    print(json.dumps({"w": None, "h": None, "alpha": False, "rm": False, "satP90": None, "meanLuma": None, "meanSat": None, "meanHex": None, "toneAdjusted": False}))
    sys.exit(0)
h, w = img.shape[:2]
has_alpha = (img.ndim == 3 and img.shape[2] == 4 and int(np.min(img[:, :, 3])) < 245)
removed = False
tone_adjusted = False

def trim_bgra(bgra):
    ih, iw = bgra.shape[:2]
    ys, xs = np.where(bgra[:, :, 3] > 16)
    if ys.size < 16 or xs.size < 16:
        return bgra
    y0, y1 = max(0, int(ys.min()) - 6), min(ih, int(ys.max()) + 7)
    x0, x1 = max(0, int(xs.min()) - 6), min(iw, int(xs.max()) + 7)
    return bgra[y0:y1, x0:x1]

final_img = img
if has_alpha:
    trimmed = trim_bgra(img)
    if trimmed.shape[:2] != img.shape[:2]:
        cv2.imwrite(p, trimmed)
        h, w = trimmed.shape[:2]
        final_img = trimmed
elif do_rm and img.ndim >= 2:
    bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img[:, :, :3].copy()
    scale = min(1.0, 512.0 / max(h, w))
    sw, sh = max(32, int(round(w * scale))), max(32, int(round(h * scale)))
    small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)

    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    b_lab = np.concatenate([lab[0, :], lab[sh - 1, :], lab[:, 0], lab[:, sw - 1]], axis=0)
    q_labs = np.percentile(b_lab, [10, 50, 90], axis=0)
    d_min = np.min([np.linalg.norm(lab - ql, axis=2) for ql in q_labs], axis=0)
    # Require border to be reasonably coherent (studio/solid/gradient backdrop)
    b_dmin = np.concatenate([d_min[0, :], d_min[sh - 1, :], d_min[:, 0], d_min[:, sw - 1]], axis=0)
    if float((b_dmin < 30.0).mean()) >= 0.65:
        bg_cand = (d_min < 28.0).astype(np.uint8)
        ff = np.zeros((sh + 2, sw + 2), dtype=np.uint8)
        for x in range(sw):
            if bg_cand[0, x] == 1:
                cv2.floodFill(bg_cand, ff, (x, 0), 2)
            if bg_cand[sh - 1, x] == 1:
                cv2.floodFill(bg_cand, ff, (x, sh - 1), 2)
        for y in range(sh):
            if bg_cand[y, 0] == 1:
                cv2.floodFill(bg_cand, ff, (0, y), 2)
            if bg_cand[y, sw - 1] == 1:
                cv2.floodFill(bg_cand, ff, (sw - 1, y), 2)

        sure_bg = (bg_cand == 2)
        bg_frac = float(sure_bg.mean())
        if 0.04 <= bg_frac <= 0.92:
            gc_mask = np.full((sh, sw), cv2.GC_PR_FGD, dtype=np.uint8)
            sure_bg_er = cv2.erode(sure_bg.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=1) > 0
            gc_mask[sure_bg] = cv2.GC_PR_BGD
            gc_mask[sure_bg_er] = cv2.GC_BGD
            fg_core = cv2.erode((~sure_bg).astype(np.uint8), np.ones((15, 15), np.uint8), iterations=2) > 0
            if int(fg_core.sum()) >= 32 and int(sure_bg_er.sum()) >= 32:
                gc_mask[fg_core] = cv2.GC_FGD
                try:
                    bgd_m = np.zeros((1, 65), np.float64)
                    fgd_m = np.zeros((1, 65), np.float64)
                    cv2.grabCut(small, gc_mask, None, bgd_m, fgd_m, 4, cv2.GC_INIT_WITH_MASK)
                    fg_small = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
                except Exception:
                    fg_small = np.where(sure_bg, 0, 255).astype(np.uint8)
            else:
                fg_small = np.where(sure_bg, 0, 255).astype(np.uint8)

            num_lbl, lbls, stats, _ = cv2.connectedComponentsWithStats(fg_small, connectivity=8)
            if num_lbl > 1:
                largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
                if stats[largest, cv2.CC_STAT_AREA] >= 0.03 * sw * sh:
                    fg_small = np.where(lbls == largest, 255, 0).astype(np.uint8)

            fg_frac = float((fg_small > 128).mean())
            if 0.05 <= fg_frac <= 0.96:
                alpha = cv2.resize(fg_small, (w, h), interpolation=cv2.INTER_LINEAR)
                alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=1)
                alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
                bgra = trim_bgra(cv2.merge([bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2], alpha]))
                cv2.imwrite(p, bgra)
                h, w = bgra.shape[:2]
                has_alpha = True
                removed = True
                final_img = bgra

if (t_luma is not None or t_sat is not None) and final_img.ndim == 3 and final_img.shape[2] >= 3:
    bgr_work = final_img[:, :, :3].copy()
    alpha_ch = final_img[:, :, 3] if final_img.shape[2] == 4 else None
    fg_mask = (alpha_ch > 32) if (alpha_ch is not None and np.any(alpha_ch > 32)) else np.ones(bgr_work.shape[:2], dtype=bool)
    changed = False
    if t_luma is not None:
        lab_w = cv2.cvtColor(bgr_work, cv2.COLOR_BGR2LAB).astype(np.float32)
        cur_l = float(np.mean(lab_w[:, :, 0][fg_mask]))
        if cur_l > 1.0:
            gain_l = float(np.clip(t_luma / cur_l, 0.58, 1.55))
            if abs(gain_l - 1.0) > 0.02:
                lab_w[:, :, 0] = np.clip(lab_w[:, :, 0] * gain_l, 0.0, 255.0)
                bgr_work = cv2.cvtColor(lab_w.astype(np.uint8), cv2.COLOR_LAB2BGR)
                changed = True
    if t_sat is not None:
        hsv_w = cv2.cvtColor(bgr_work, cv2.COLOR_BGR2HSV).astype(np.float32)
        cur_s = float(np.mean(hsv_w[:, :, 1][fg_mask]))
        if cur_s > 1.0:
            gain_s = float(np.clip(t_sat / cur_s, 0.25, 1.65))
            if abs(gain_s - 1.0) > 0.02:
                hsv_w[:, :, 1] = np.clip(hsv_w[:, :, 1] * gain_s, 0.0, 255.0)
                bgr_work = cv2.cvtColor(hsv_w.astype(np.uint8), cv2.COLOR_HSV2BGR)
                changed = True
    if changed:
        if alpha_ch is not None:
            final_img = cv2.merge([bgr_work[:, :, 0], bgr_work[:, :, 1], bgr_work[:, :, 2], alpha_ch])
        else:
            final_img = bgr_work
        cv2.imwrite(p, final_img)
        tone_adjusted = True

sat_p90 = 0.0
mean_luma = None
mean_sat = None
mean_hex = None
if final_img.ndim == 3 and final_img.shape[2] >= 3:
    bgr_fin = final_img[:, :, :3]
    hsv = cv2.cvtColor(bgr_fin, cv2.COLOR_BGR2HSV)
    lab_fin = cv2.cvtColor(bgr_fin, cv2.COLOR_BGR2LAB)
    if final_img.shape[2] == 4 and np.any(final_img[:, :, 3] > 32):
        mask = final_img[:, :, 3] > 32
        s_vals = hsv[:, :, 1][mask]
        l_vals = lab_fin[:, :, 0][mask]
        bgr_vals = bgr_fin[mask]
    else:
        s_vals = hsv[:, :, 1].reshape(-1)
        l_vals = lab_fin[:, :, 0].reshape(-1)
        bgr_vals = bgr_fin.reshape(-1, 3)
    if s_vals.size > 0:
        sat_p90 = round(float(np.percentile(s_vals, 90)), 1)
        mean_sat = round(float(np.mean(s_vals)), 1)
    if l_vals.size > 0:
        mean_luma = round(float(np.mean(l_vals)), 1)
    if bgr_vals.size > 0:
        mb, mg, mr = [int(round(float(x))) for x in np.mean(bgr_vals, axis=0)]
        mean_hex = "#{:02X}{:02X}{:02X}".format(mr, mg, mb)

alpha_bbox = None
if final_img.ndim == 3 and final_img.shape[2] == 4:
    ys_a, xs_a = np.where(final_img[:, :, 3] > 16)
    if ys_a.size > 0 and xs_a.size > 0:
        ax0, ay0 = int(xs_a.min()), int(ys_a.min())
        ax1, ay1 = int(xs_a.max()) + 1, int(ys_a.max()) + 1
        alpha_bbox = {"x": ax0, "y": ay0, "w": max(1, ax1 - ax0), "h": max(1, ay1 - ay0)}

print(json.dumps({
    "w": int(w),
    "h": int(h),
    "alpha": bool(has_alpha),
    "alphaBbox": alpha_bbox,
    "rm": bool(removed),
    "satP90": sat_p90,
    "meanLuma": mean_luma,
    "meanSat": mean_sat,
    "meanHex": mean_hex,
    "toneAdjusted": bool(tone_adjusted),
}))
"##;
    let out = tokio::process::Command::new(python)
        .arg("-c")
        .arg(script)
        .arg(path)
        .arg(if remove_bg { "1" } else { "0" })
        .arg(target_luma.map(|v| format!("{:.1}", v)).unwrap_or_default())
        .arg(target_sat.map(|v| format!("{:.1}", v)).unwrap_or_default())
        .output()
        .await;
    if let Ok(o) = out {
        if o.status.success() {
            if let Ok(v) = serde_json::from_slice::<Value>(&o.stdout) {
                let parsed_bbox = v.get("alphaBbox").and_then(|b| {
                    let x = b.get("x").and_then(Value::as_u64)? as u32;
                    let y = b.get("y").and_then(Value::as_u64)? as u32;
                    let w = b.get("w").and_then(Value::as_u64)? as u32;
                    let h = b.get("h").and_then(Value::as_u64)? as u32;
                    if w > 0 && h > 0 {
                        Some(crate::studio::asset_registry::AlphaBbox { x, y, w, h })
                    } else {
                        None
                    }
                });
                return DownloadedImageMeta {
                    width: v.get("w").and_then(Value::as_u64).map(|x| x as u32),
                    height: v.get("h").and_then(Value::as_u64).map(|x| x as u32),
                    has_alpha: v.get("alpha").and_then(Value::as_bool).unwrap_or(false),
                    alpha_bbox: parsed_bbox,
                    background_removed: v.get("rm").and_then(Value::as_bool).unwrap_or(false),
                    sat_p90: v.get("satP90").and_then(Value::as_f64),
                    mean_luma: v.get("meanLuma").and_then(Value::as_f64),
                    mean_sat: v.get("meanSat").and_then(Value::as_f64),
                    mean_hex: v
                        .get("meanHex")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    tone_adjusted: v
                        .get("toneAdjusted")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                };
            }
        }
    }
    DownloadedImageMeta::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_image_search_queries_strips_noise_and_broadens() {
        let qs = build_image_search_queries("human brain side view isolated transparent p");
        assert_eq!(
            qs,
            vec![
                "human brain side view".to_string(),
                "human brain".to_string()
            ]
        );

        let target_qs = build_image_search_queries("archery target bullseye png transparent background");
        assert_eq!(target_qs[0], "archery target bullseye");
        assert_eq!(target_qs[1], "archery target");

        let person_qs = build_image_search_queries("Rami Malek portrait");
        assert_eq!(person_qs[0], "rami malek portrait");
        assert_eq!(person_qs[1], "rami malek");

        let single_qs = build_image_search_queries("rocket");
        assert_eq!(single_qs, vec!["rocket".to_string()]);
    }

    #[test]
    fn normalize_image_rel_path_places_plain_names_in_img() {
        assert_eq!(normalize_image_rel_path("brain.png"), "img/brain.png");
        assert_eq!(normalize_image_rel_path("./public/img/a.jpg"), "img/a.jpg");
        assert_eq!(normalize_image_rel_path("workspace/img/b.png"), "img/b.png");
    }

    #[test]
    fn score_commons_filename_prefers_realistic_over_flat_bioart() {
        let kws = vec!["human".to_string(), "brain".to_string()];
        let bioart = score_commons_filename("file:brain lateral (nih bioart 60).png", &kws, true, true);
        let real_3d = score_commons_filename("file:human brain lateral 3d model.png", &kws, true, true);
        assert!(real_3d > bioart, "expected real_3d ({real_3d}) > bioart ({bioart})");

        let clean_photo = score_commons_filename("file:human brain lateral view.jpg", &kws, true, true);
        let labeled_desc = score_commons_filename("file:human brain lateral view description.jpg", &kws, true, true);
        let printed_3d = score_commons_filename("file:3d printing brain with support.jpg", &kws, true, true);
        let bw_sketch = score_commons_filename("file:lateral view of human brain (black and white).jpg", &kws, true, true);
        let infographic = score_commons_filename("file:brain lateralization.png", &kws, true, true);
        assert!(clean_photo > labeled_desc, "clean_photo ({clean_photo}) must beat labeled_desc ({labeled_desc})");
        assert!(clean_photo > printed_3d, "clean_photo ({clean_photo}) must beat printed_3d ({printed_3d})");
        assert!(clean_photo > bw_sketch, "clean_photo ({clean_photo}) must beat bw_sketch ({bw_sketch})");
        assert!(clean_photo > infographic, "clean_photo ({clean_photo}) must beat infographic ({infographic})");
    }

    #[test]
    fn merge_commons_and_openverse_promotes_clean_openverse_over_labeled_commons() {
        let labeled_commons = vec![
            (
                -5,
                "File:Human brain lateral view description 2.JPG".to_string(),
                "https://commons.example/labeled.jpg".to_string(),
            ),
            (
                -20,
                "File:Brain schematic labeled.png".to_string(),
                "https://commons.example/schematic.png".to_string(),
            ),
        ];
        let openverse = vec![
            (
                "3D pink brain render studio".to_string(),
                "https://openverse.example/clean_3d.png".to_string(),
            ),
            (
                "Brain anatomy diagram with labels".to_string(),
                "https://openverse.example/ov_diagram.png".to_string(),
            ),
        ];
        let merged = merge_commons_and_openverse_candidates(labeled_commons, openverse, true);
        assert_eq!(
            merged[0].1, "https://openverse.example/clean_3d.png",
            "clean Openverse photo must outrank labeled Commons diagrams"
        );
        assert_eq!(merged.len(), 4);
    }

    #[tokio::test]
    async fn postprocess_grabcut_removes_solid_background_and_trims_margins() {
        let tmp = std::env::temp_dir().join(format!("aetheria_grabcut_{}.png", crate::paths::now_ms()));
        let python = crate::paths::locate_python_binary();
        let mk = tokio::process::Command::new(&python)
            .arg("-c")
            .arg(
                "import cv2, numpy as np, sys; \
                 img = np.full((240, 320, 3), (45, 42, 195), dtype=np.uint8); \
                 cv2.ellipse(img, (160, 120), (80, 58), 0, 0, 360, (195, 205, 225), -1); \
                 cv2.circle(img, (140, 110), 18, (140, 145, 160), -1); \
                 cv2.imwrite(sys.argv[1], img)",
            )
            .arg(&tmp)
            .output()
            .await
            .expect("create synthetic studio test image");
        assert!(mk.status.success(), "python failed creating synthetic image");

        let meta = postprocess_downloaded_image(&tmp, true, None, None).await;
        assert!(meta.has_alpha, "expected GrabCut cutout to produce alpha channel");
        assert!(meta.background_removed, "expected backgroundRemoved=true");
        assert!(meta.sat_p90.unwrap_or(0.0) >= 15.0, "expected colored synthetic object sat_p90 >= 15, got {:?}", meta.sat_p90);
        assert!(meta.mean_luma.unwrap_or(0.0) > 100.0, "expected mean_luma reported, got {:?}", meta.mean_luma);
        assert!(meta.mean_hex.as_deref().is_some_and(|h| h.starts_with('#')), "expected mean_hex, got {:?}", meta.mean_hex);
        let w = meta.width.expect("width");
        let h = meta.height.expect("height");
        assert!(w < 230 && w > 120, "expected auto-trimmed width around ~172px, got {w}");
        assert!(h < 190 && h > 90, "expected auto-trimmed height around ~128px, got {h}");

        // Now verify optional LAB luma / HSV sat tone grading shifts the cutout toward target tone
        let graded = postprocess_downloaded_image(&tmp, false, Some(135.0), Some(14.0)).await;
        let _ = std::fs::remove_file(&tmp);
        assert!(graded.tone_adjusted, "expected toneAdjusted=true when targets differ");
        assert!(
            graded.mean_luma.unwrap_or(255.0) < meta.mean_luma.unwrap_or(0.0) - 20.0,
            "expected toned luma ({:?}) noticeably darker than original ({:?})",
            graded.mean_luma,
            meta.mean_luma
        );
        assert!(
            graded.mean_sat.unwrap_or(255.0) <= 22.0,
            "expected toned saturation muted near targetSat=14, got {:?}",
            graded.mean_sat
        );
    }
}

