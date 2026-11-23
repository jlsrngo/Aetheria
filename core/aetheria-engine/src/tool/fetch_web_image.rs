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
                        "description": "Optional. Set true to automatically convert uniform white/solid corner backgrounds into smooth alpha transparency (saves PNG)."
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
        score += 6;
    }
    if wants_realistic {
        if title_lower.contains("3d")
            || title_lower.contains("render")
            || title_lower.contains("model")
            || title_lower.contains("photo")
            || title_lower.contains("real")
            || title_lower.contains("lateral")
        {
            score += 6;
        }
        if title_lower.contains("bioart")
            || title_lower.contains("clipart")
            || title_lower.contains("line")
            || title_lower.contains("sketch")
            || title_lower.contains("icon")
            || title_lower.contains("cartoon")
        {
            score -= 6;
        }
    } else if title_lower.contains("3d") || title_lower.contains("render") || title_lower.contains("model") {
        score += 3;
    }
    if title_lower.contains("diagram")
        || title_lower.contains("chart")
        || title_lower.contains("map")
        || title_lower.contains("scan")
        || title_lower.contains("mri")
        || title_lower.contains("xray")
        || title_lower.contains("x-ray")
        || title_lower.contains("slice")
        || title_lower.contains("histology")
        || title_lower.contains("drawing")
    {
        score -= 5;
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

    let mut candidate_urls: Vec<String> = Vec::new();
    if !direct_url.is_empty() {
        candidate_urls.push(direct_url.to_string());
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
                let mut scored: Vec<(i32, String)> = Vec::new();
                let keywords: Vec<String> = q
                    .to_ascii_lowercase()
                    .split(|c: char| !c.is_ascii_alphanumeric())
                    .filter(|w| w.len() >= 3 && !matches!(*w, "png" | "jpg" | "transparent" | "isolated" | "icon" | "background" | "white"))
                    .map(str::to_string)
                    .collect();
                // CRITICAL: `gsrnamespace=6` restricts Wikimedia Commons search strictly to `File:` pages!
                let commons_api = format!(
                    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch={}&gsrlimit=12&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=900&format=json",
                    encode_query(&format!("filetype:bitmap {}", q))
                );
                if let Ok(resp) = client.get(&commons_api).send().await {
                    if let Ok(data) = resp.json::<Value>().await {
                        if let Some(pages) = data.pointer("/query/pages").and_then(|v| v.as_object()) {
                            for (_id, page) in pages {
                                let title = page
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_ascii_lowercase();
                                if title.ends_with(".svg")
                                    || title.ends_with(".tif")
                                    || title.ends_with(".tiff")
                                    || title.ends_with(".pdf")
                                    || title.ends_with(".djvu")
                                    || title.ends_with(".webm")
                                    || title.ends_with(".ogv")
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
                                            scored.push((score, u.to_string()));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                scored.sort_by(|a, b| b.0.cmp(&a.0));
                scored.into_iter().map(|(_, u)| u).collect::<Vec<String>>()
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
                                if let Some(thumb) = page.pointer("/thumbnail/source").and_then(|v| v.as_str()) {
                                    urls.push(thumb.to_string());
                                }
                                if let Some(orig) = page.pointer("/original/source").and_then(|v| v.as_str()) {
                                    if !orig.ends_with(".svg") && !orig.ends_with(".tif") && !orig.ends_with(".pdf") {
                                        urls.push(orig.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                urls
            }
        };

        let search_queries = build_image_search_queries(query);
        if prefer_commons {
            for sq in &search_queries {
                let hits = fetch_commons(sq.clone(), true, wants_realistic).await;
                if !hits.is_empty() {
                    candidate_urls.extend(hits);
                    break;
                }
            }
            if candidate_urls.is_empty() {
                for sq in &search_queries {
                    let hits = fetch_wikipedia(sq.clone()).await;
                    if !hits.is_empty() {
                        candidate_urls.extend(hits);
                        break;
                    }
                }
            }
        } else {
            for sq in &search_queries {
                let hits = fetch_wikipedia(sq.clone()).await;
                if !hits.is_empty() {
                    candidate_urls.extend(hits);
                    break;
                }
            }
            if candidate_urls.is_empty() {
                for sq in &search_queries {
                    let hits = fetch_commons(sq.clone(), false, wants_realistic).await;
                    if !hits.is_empty() {
                        candidate_urls.extend(hits);
                        break;
                    }
                }
            }
        }
    }

    for img_url in &candidate_urls {
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
                    let meta = postprocess_downloaded_image(&target_out, remove_bg).await;
                    let final_bytes = tokio::fs::metadata(&target_out)
                        .await
                        .map(|m| m.len())
                        .unwrap_or(bytes.len() as u64);
                    return json!({
                        "success": true,
                        "query": query,
                        "sourceUrl": img_url,
                        "outputPath": target_out.to_string_lossy().to_string(),
                        "assetPath": asset_rel,
                        "assetUrl": format!("/{}", asset_rel),
                        "bytes": final_bytes,
                        "width": meta.0,
                        "height": meta.1,
                        "hasAlpha": meta.2,
                        "backgroundRemoved": meta.3,
                        "message": format!("Downloaded internet image to {} (preload via `AM.loadImage('/{}')` and draw via `AM.drawImageFit(...)`)", asset_rel, asset_rel)
                    });
                }
            }
        }
    }

    json!({
        "success": false,
        "error": format!("No matching raster image found on Wikimedia Commons or Wikipedia for query '{}'. Try a simpler 2-3 word English query (e.g. 'human brain lateral' or 'archery target') or draw procedurally.", query),
        "query": query,
        "assetPath": asset_rel
    })
}

/// Inspects downloaded raster image dimensions/alpha and, when `remove_bg` is requested on an
/// opaque-corner image, flood-fills uniform corner background into clean transparent PNG alpha.
async fn postprocess_downloaded_image(
    path: &std::path::Path,
    remove_bg: bool,
) -> (Option<u32>, Option<u32>, bool, bool) {
    let python = crate::paths::locate_python_binary();
    let script = r#"
import json, sys, cv2, numpy as np
p = sys.argv[1]
do_rm = sys.argv[2] == "1"
img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
if img is None:
    print(json.dumps({"w": None, "h": None, "alpha": False, "rm": False}))
    sys.exit(0)
h, w = img.shape[:2]
has_alpha = (img.ndim == 3 and img.shape[2] == 4 and int(np.min(img[:, :, 3])) < 245)
removed = False
if do_rm and not has_alpha and img.ndim == 3:
    bgr = img[:, :, :3].copy()
    corners = np.array([bgr[0, 0], bgr[0, w - 1], bgr[h - 1, 0], bgr[h - 1, w - 1]], dtype=np.float32)
    bg_med = np.median(corners, axis=0)
    corner_spread = float(np.max(np.linalg.norm(corners - bg_med, axis=1)))
    if corner_spread < 38.0:
        dist = np.linalg.norm(bgr.astype(np.float32) - bg_med, axis=2)
        bg_cand = (dist < 32.0).astype(np.uint8)
        ff = np.zeros((h + 2, w + 2), dtype=np.uint8)
        for sx, sy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            if bg_cand[sy, sx]:
                cv2.floodFill(bg_cand, ff, (sx, sy), 2)
        alpha = np.where(bg_cand == 2, 0, 255).astype(np.uint8)
        alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
        bgra = cv2.merge([bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2], alpha])
        cv2.imwrite(p, bgra)
        has_alpha = True
        removed = True
print(json.dumps({"w": int(w), "h": int(h), "alpha": bool(has_alpha), "rm": bool(removed)}))
"#;
    let out = tokio::process::Command::new(python)
        .arg("-c")
        .arg(script)
        .arg(path)
        .arg(if remove_bg { "1" } else { "0" })
        .output()
        .await;
    if let Ok(o) = out {
        if o.status.success() {
            if let Ok(v) = serde_json::from_slice::<Value>(&o.stdout) {
                return (
                    v.get("w").and_then(Value::as_u64).map(|x| x as u32),
                    v.get("h").and_then(Value::as_u64).map(|x| x as u32),
                    v.get("alpha").and_then(Value::as_bool).unwrap_or(false),
                    v.get("rm").and_then(Value::as_bool).unwrap_or(false),
                );
            }
        }
    }
    (None, None, false, false)
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
    }
}

