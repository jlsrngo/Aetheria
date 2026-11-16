//! Deterministic 1:1 Stage Extractor for Standalone HTML/SVG/Canvas Animations.
//!
//! Moves the visual stage (`<svg>`, `<canvas>`, `.paper-texture`, `<style>`, Google Fonts `<link>`,
//! and inline `<script>`) from an uploaded standalone HTML demo directly into `<project>/index.html`
//! and `<project>/script/scene1.js` without recreating or simplifying the artwork.

use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ExtractedStage {
    pub title: String,
    pub index_html: String,
    pub scene1_js: String,
}

fn extract_tag_blocks_ci(html: &str, tag: &str) -> Vec<(String, String, String)> {
    let mut results = Vec::new();
    let open_pat = format!("<{}", tag.to_ascii_lowercase());
    let close_pat = format!("</{}>", tag.to_ascii_lowercase());
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;

    while let Some(rel_start) = lower[cursor..].find(&open_pat) {
        let start = cursor + rel_start;
        let after_open_name = start + open_pat.len();
        if let Some(next_ch) = lower[after_open_name..].chars().next() {
            if next_ch.is_ascii_alphanumeric() || next_ch == '-' {
                cursor = after_open_name;
                continue;
            }
        }
        let Some(rel_gt) = lower[after_open_name..].find('>') else {
            break;
        };
        let gt_pos = after_open_name + rel_gt;
        let attrs = html[after_open_name..gt_pos].to_string();
        let inner_start = gt_pos + 1;
        let Some(rel_close) = lower[inner_start..].find(&close_pat) else {
            break;
        };
        let close_start = inner_start + rel_close;
        let close_end = close_start + close_pat.len();
        let inner = html[inner_start..close_start].to_string();
        let full = html[start..close_end].to_string();
        results.push((attrs, inner, full));
        cursor = close_end;
    }
    results
}

fn extract_attr_value(attrs: &str, attr_name: &str) -> Option<String> {
    let lower = attrs.to_ascii_lowercase();
    let needle = format!("{}=", attr_name.to_ascii_lowercase());
    let idx = lower.find(&needle)?;
    let rest = attrs[idx + needle.len()..].trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let after_q = &rest[quote.len_utf8()..];
        let end_q = after_q.find(quote)?;
        Some(after_q[..end_q].to_string())
    } else {
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .unwrap_or(rest.len());
        Some(rest[..end].to_string())
    }
}

fn extract_input_defaults(html: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<input") {
        let start = cursor + rel;
        let Some(rel_gt) = lower[start..].find('>') else {
            break;
        };
        let tag_str = &html[start..start + rel_gt + 1];
        if let (Some(id), Some(val)) = (
            extract_attr_value(tag_str, "id"),
            extract_attr_value(tag_str, "value"),
        ) {
            if !id.trim().is_empty() {
                map.insert(id, val);
            }
        }
        cursor = start + rel_gt + 1;
    }
    map
}

fn extract_google_font_links(html: &str) -> Vec<String> {
    let mut links = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<link") {
        let start = cursor + rel;
        let Some(rel_gt) = lower[start..].find('>') else {
            break;
        };
        let tag_str = &html[start..start + rel_gt + 1];
        let tag_low = tag_str.to_ascii_lowercase();
        if tag_low.contains("fonts.googleapis.com") || tag_low.contains("fonts.gstatic.com") {
            links.push(tag_str.to_string());
        }
        cursor = start + rel_gt + 1;
    }
    links
}

fn extract_paper_texture_divs(body_html: &str) -> Vec<String> {
    let mut divs = Vec::new();
    let lower = body_html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<div") {
        let start = cursor + rel;
        let Some(rel_gt) = lower[start..].find('>') else {
            break;
        };
        let open_tag = &body_html[start..start + rel_gt + 1];
        if open_tag.to_ascii_lowercase().contains("paper-texture") {
            let after_open = start + rel_gt + 1;
            if let Some(rel_close) = lower[after_open..].find("</div>") {
                let end = after_open + rel_close + "</div>".len();
                divs.push(body_html[start..end].to_string());
                cursor = end;
                continue;
            }
        }
        cursor = start + rel_gt + 1;
    }
    divs
}

fn sanitize_title(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c == ',' || c == '\n' || c == '\r' { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Extracted Stage Animation".to_string()
    } else {
        trimmed.chars().take(70).collect()
    }
}

fn rewrite_js_for_deterministic_clock(raw_js: &str) -> String {
    raw_js
        .replace("document.readyState === \"loading\"", "false")
        .replace("document.readyState === 'loading'", "false")
        .replace("Math.random()", "window.__aetheriaRand()")
        .replace("performance.now()", "window.__aetheriaNowMs")
        .replace("Date.now()", "window.__aetheriaNowMs")
        .replace("requestAnimationFrame(", "window.__aetheriaRAF(")
        .replace("setTimeout(", "window.__aetheriaSetTimeout(")
        .replace("setInterval(", "window.__aetheriaSetInterval(")
}

/// Extracts the visual stage (`<svg>`, `<canvas>`, `.paper-texture`, styles, and scripts)
/// from a standalone HTML document into a deterministic Studio project (`index.html` + `script/scene1.js`).
pub fn extract_standalone_html_stage(
    raw_html: &str,
    width: u32,
    height: u32,
    fps: u32,
    duration_sec: u32,
) -> Option<ExtractedStage> {
    let lower = raw_html.to_ascii_lowercase();
    if !(lower.contains("<svg") || lower.contains("<canvas")) {
        return None;
    }

    let title = extract_tag_blocks_ci(raw_html, "title")
        .into_iter()
        .next()
        .map(|(_, inner, _)| sanitize_title(&inner))
        .unwrap_or_else(|| "Extracted Stage Animation".to_string());

    let font_links = extract_google_font_links(raw_html);
    let style_blocks: Vec<String> = extract_tag_blocks_ci(raw_html, "style")
        .into_iter()
        .map(|(_, inner, _)| inner)
        .collect();

    let script_blocks: Vec<String> = extract_tag_blocks_ci(raw_html, "script")
        .into_iter()
        .filter(|(attrs, inner, _)| {
            !attrs.to_ascii_lowercase().contains("src=") && !inner.trim().is_empty()
        })
        .map(|(_, inner, _)| inner)
        .collect();

    let body_inner = extract_tag_blocks_ci(raw_html, "body")
        .into_iter()
        .next()
        .map(|(_, inner, _)| inner)
        .unwrap_or_else(|| raw_html.to_string());

    let mut stage_parts = Vec::new();
    stage_parts.extend(extract_paper_texture_divs(&body_inner));
    for (_, _, full_svg) in extract_tag_blocks_ci(&body_inner, "svg") {
        // Skip tiny button icon SVGs (< 200 chars) if there is a main stage SVG
        if full_svg.len() >= 200 || !body_inner.to_ascii_lowercase().contains("<canvas") {
            stage_parts.push(full_svg);
        }
    }
    for (_, _, full_canvas) in extract_tag_blocks_ci(&body_inner, "canvas") {
        stage_parts.push(full_canvas);
    }

    if stage_parts.is_empty() {
        return None;
    }

    let input_defaults = extract_input_defaults(raw_html);
    let defaults_json = serde_json::to_string(&input_defaults).unwrap_or_else(|_| "{}".to_string());
    let transformed_js = rewrite_js_for_deterministic_clock(&script_blocks.join("\n\n"));

    let scene1_js = format!(
        r#"(function () {{
  var _seed = 1337;
  window.__aetheriaResetSeed = function (s) {{
    _seed = (s || 1337) >>> 0;
  }};
  window.__aetheriaRand = function () {{
    _seed = (_seed + 0x6D2B79F5) >>> 0;
    var t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }};

  window.__aetheriaNowMs = 0;
  window.__aetheriaRafCb = null;
  window.__aetheriaTimers = [];
  window.__aetheriaNextTimerId = 1;

  window.__aetheriaRAF = function (cb) {{
    window.__aetheriaRafCb = cb;
    return 1;
  }};
  window.__aetheriaSetTimeout = function (cb, delay) {{
    var id = window.__aetheriaNextTimerId++;
    window.__aetheriaTimers.push({{
      id: id,
      cb: cb,
      fireAt: window.__aetheriaNowMs + Math.max(0, Number(delay) || 0),
      interval: 0
    }});
    return id;
  }};
  window.__aetheriaSetInterval = function (cb, interval) {{
    var id = window.__aetheriaNextTimerId++;
    var iv = Math.max(16, Number(interval) || 16);
    window.__aetheriaTimers.push({{
      id: id,
      cb: cb,
      fireAt: window.__aetheriaNowMs + iv,
      interval: iv
    }});
    return id;
  }};

  var _dummyDefaults = {defaults_json};
  var _dummyCache = {{}};
  var _origGetById = document.getElementById.bind(document);
  document.getElementById = function (id) {{
    var found = _origGetById(id);
    if (found) return found;
    if (!_dummyCache[id]) {{
      _dummyCache[id] = {{
        id: id,
        style: {{}},
        classList: {{ add: function(){{}}, remove: function(){{}}, toggle: function(){{}}, contains: function(){{ return false; }} }},
        addEventListener: function(){{}},
        removeEventListener: function(){{}},
        setAttribute: function(){{}},
        getAttribute: function(){{ return ""; }},
        getBoundingClientRect: function(){{ return {{ left: 0, top: 0, width: {width}, height: {height} }}; }},
        appendChild: function(){{}},
        innerHTML: "",
        textContent: _dummyDefaults[id] || "",
        value: _dummyDefaults[id] || ""
      }};
    }}
    return _dummyCache[id];
  }};

  function runOriginalScript() {{
{transformed_js}
    if (typeof window.onload === "function") {{
      var fn = window.onload;
      window.onload = null;
      try {{ fn(); }} catch (_e) {{}}
    }}
  }}

  window.__aetheriaStep = 0;
  window.__aetheriaInitialized = false;
  window.__aetheriaInitStage = function () {{
    window.__aetheriaResetSeed(1337);
    window.__aetheriaNowMs = 0;
    window.__aetheriaRafCb = null;
    window.__aetheriaTimers = [];
    window.__aetheriaStep = 0;
    runOriginalScript();
  }};

  window.__aetheriaAdvanceTo = function (tSec) {{
    var targetStep = Math.max(0, Math.round(tSec * 60));
    if (!window.__aetheriaInitialized || targetStep < window.__aetheriaStep) {{
      window.__aetheriaInitialized = true;
      window.__aetheriaInitStage();
    }}
    while (window.__aetheriaStep < targetStep) {{
      window.__aetheriaStep++;
      window.__aetheriaNowMs = (window.__aetheriaStep / 60) * 1000;
      for (var i = 0; i < window.__aetheriaTimers.length; i++) {{
        var tm = window.__aetheriaTimers[i];
        if (tm && tm.fireAt <= window.__aetheriaNowMs) {{
          var fn = tm.cb;
          if (tm.interval > 0) {{
            tm.fireAt += tm.interval;
          }} else {{
            window.__aetheriaTimers.splice(i, 1);
            i--;
          }}
          try {{ fn(); }} catch (_e) {{}}
        }}
      }}
      if (window.__aetheriaRafCb) {{
        var cb = window.__aetheriaRafCb;
        window.__aetheriaRafCb = null;
        try {{ cb(window.__aetheriaNowMs); }} catch (_e) {{}}
      }}
    }}
    if (document.getAnimations) {{
      var anims = document.getAnimations({{ subtree: true }});
      for (var k = 0; k < anims.length; k++) {{
        try {{
          anims[k].pause();
          anims[k].currentTime = tSec * 1000;
        }} catch (_e) {{}}
      }}
    }}
  }};

  if (window.AM && window.AM.registerScene) {{
    window.AM.registerScene("scene1", function (_ctx, localTime) {{
      window.__aetheriaAdvanceTo(localTime);
    }});
  }}
}})();
"#
    );

    let total_frames = duration_sec * fps;
    let title_json = serde_json::to_string(&title).unwrap_or_else(|_| "\"Stage\"".to_string());
    let index_html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width={width}, height={height}, initial-scale=1.0" />
  <title>{title}</title>
  {fonts}
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html, body {{
      width: {width}px;
      height: {height}px;
      overflow: hidden;
      user-select: none;
    }}
    #stageWrapper, #stage-wrapper, #canvas-frame {{
      position: relative;
      width: {width}px !important;
      height: {height}px !important;
      max-width: {width}px !important;
      max-height: {height}px !important;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .w-full {{ width: 100%; }}
    .h-full {{ height: 100%; }}
    .block {{ display: block; }}
    .absolute {{ position: absolute; }}
    .inset-0 {{ top: 0; right: 0; bottom: 0; left: 0; }}
    .pointer-events-none {{ pointer-events: none; }}
{styles}
    #mainSvg, #main-svg {{
      width: 100% !important;
      height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      display: block;
    }}
    #fireworksCanvas {{
      position: absolute;
      top: 0;
      left: 0;
      width: {width}px;
      height: {height}px;
      pointer-events: none;
    }}
  </style>
</head>
<body>
  <div id="stageWrapper">
    <div id="canvas-frame" style="width:{width}px;height:{height}px;position:relative;">
{stage_dom}
    </div>
  </div>
  <script src="/script/aetheria-motion.js"></script>
  <script src="/script/scene1.js"></script>
  <script>
    var SCENES = [
      {{ id: "scene1", title: "Main Stage", start: 0, duration: {duration_sec} }}
    ];
    window.__filmMeta = {{
      title: {title_json},
      width: {width},
      height: {height},
      fps: {fps},
      duration: {duration_sec},
      durationInFrames: {total_frames},
      scenes: SCENES
    }};
    window.renderAt = function (t) {{
      if (window.__aetheriaAdvanceTo) {{
        window.__aetheriaAdvanceTo(t);
      }}
    }};
    window.renderAt(0);
    window.__ready = true;
  </script>
</body>
</html>
"#,
        fonts = font_links.join("\n  "),
        styles = style_blocks.join("\n"),
        stage_dom = stage_parts.join("\n"),
    );

    Some(ExtractedStage {
        title,
        index_html,
        scene1_js,
    })
}

/// Extracts a standalone HTML stage and writes `index.html`, `script/scene1.js`, and (if Microstock
/// Mode `'M'` is enabled) initializes `microstock/manifest.json` inside `target_project_dir`.
pub fn extract_and_write_uploaded_stage(
    workspace_dir: &str,
    target_project_dir: &Path,
    raw_html: &str,
) -> Option<ExtractedStage> {
    let lock = crate::studio::microstock::active_microstock_lock(workspace_dir);
    let (width, height, fps) = match lock.as_ref() {
        Some(l) => (l.width, l.height, l.fps),
        None => (1920, 1080, 30),
    };
    let extracted = extract_standalone_html_stage(raw_html, width, height, fps, 10)?;

    let script_dir = target_project_dir.join("script");
    let _ = std::fs::create_dir_all(&script_dir);
    std::fs::write(target_project_dir.join("index.html"), &extracted.index_html).ok()?;
    std::fs::write(script_dir.join("scene1.js"), &extracted.scene1_js).ok()?;

    let ws_root = Path::new(workspace_dir);
    let slug = target_project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("motion-project");
    let mut manifest =
        crate::studio::microstock::manifest::load_manifest(ws_root, target_project_dir)
            .unwrap_or_default();
    if let Some(l) = lock {
        manifest.enabled = true;
        manifest.preset = l.preset_id;
        manifest.fps = l.fps;
        manifest.codec = l.codec;
    }
    if manifest.provenance.ai_declared.is_none() {
        manifest.provenance.ai_declared = Some(false);
        manifest.provenance.declared_at = Some(crate::paths::now_iso());
    }
    manifest.checklist.no_logos_or_brands = true;
    manifest.checklist.no_artist_or_ip_names = true;
    manifest.checklist.no_identifiable_people_or_property = true;
    manifest.checklist.no_third_party_fonts_or_graphics_without_license = true;
    if manifest.metadata.title.trim().is_empty() {
        manifest.metadata.title = extracted.title.clone();
    }
    if manifest.metadata.category.trim().is_empty() {
        manifest.metadata.category = "Graphic resources".to_string();
    }
    if manifest.metadata.keywords.len() < 5 {
        manifest.metadata.keywords =
            crate::studio::microstock::manifest::derive_keywords_from_title_and_slug(
                &manifest.metadata.title,
                slug,
            );
    }
    let _ = crate::studio::microstock::manifest::save_manifest(
        ws_root,
        target_project_dir,
        &manifest,
    );

    crate::session::message::emit_event(
        workspace_dir,
        "file.edited",
        serde_json::json!({ "file": "index.html" }),
    );
    crate::session::message::emit_event(
        workspace_dir,
        "file.edited",
        serde_json::json!({ "file": "script/scene1.js" }),
    );
    crate::session::message::emit_event(
        workspace_dir,
        "file.edited",
        serde_json::json!({ "file": "microstock/manifest.json" }),
    );

    Some(extracted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_standalone_html_stage_preserving_svg_canvas_and_rewriting_rng() {
        let sample = r##"<!DOCTYPE html>
<html>
<head>
  <title>Happy New Year 2027, City Skyline</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@900&display=swap" rel="stylesheet">
  <style>.title-float { animation: float 4s infinite; }</style>
</head>
<body>
  <div id="control-panel">
    <input id="input-subtitle" value="DECEMBER" />
    <button id="btnPlayPause">Play</button>
  </div>
  <div id="stageWrapper">
    <svg id="mainSvg" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
      <rect width="1920" height="1080" fill="#020b26" />
      <g id="layer-city-skyline"><polygon points="100,800 120,750 140,800" fill="#040814" /></g>
      <text id="svgTitleYear" x="960" y="455">2027</text>
    </svg>
    <canvas id="fireworksCanvas" width="1920" height="1080"></canvas>
  </div>
  <script>
    function launchRocket() {
      var x = Math.random() * 1920;
      return x;
    }
    function animate() {
      var now = performance.now();
      requestAnimationFrame(animate);
    }
    setTimeout(launchRocket, 240);
    animate();
  </script>
</body>
</html>"##;

        let out = extract_standalone_html_stage(sample, 1920, 1080, 30, 10).expect("extracted");
        assert_eq!(out.title, "Happy New Year 2027 City Skyline");
        assert!(out.index_html.contains("<svg id=\"mainSvg\""));
        assert!(out.index_html.contains("<canvas id=\"fireworksCanvas\""));
        assert!(!out.index_html.contains("cdn.tailwindcss.com"));
        assert!(!out.index_html.contains("btnPlayPause"));
        assert!(out.index_html.contains("fonts.googleapis.com"));
        assert!(out.scene1_js.contains("window.__aetheriaRand()"));
        assert!(!out.scene1_js.contains("Math.random()"));
        assert!(!out.scene1_js.contains("performance.now()"));
        assert!(out.scene1_js.contains("\"input-subtitle\":\"DECEMBER\""));
    }
}
