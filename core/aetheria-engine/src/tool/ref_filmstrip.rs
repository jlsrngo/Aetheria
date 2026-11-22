//! Deterministic 1/1 Filmstrip Window Reader Tool (`read_filmstrip`).
//!
//! Lets any authoring agent inspect 1/1 per-frame filmstrip sheets (10 frames/sheet)
//! scene-by-scene or sheet-range-by-range without exceeding multimodal active image caps.

use base64::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::resolve_isolated_path;

pub fn read_filmstrip_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "read_filmstrip",
            "description": "Load deterministic 1/1 reference filmstrip sheets (10 consecutive frames per sheet) for a scene or sheet/time range from `ref/extracted/filmstrip_index.json`. Attaches up to `maxSheets` (default 8) sheets directly to vision context and replaces older filmstrip batches so you can inspect every micro-movement 1/1 across long videos.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sceneIndex": {
                        "type": "integer",
                        "description": "Optional 1-based scene number from `filmstrip_index.json` / `ref_report.md`."
                    },
                    "startSheet": {
                        "type": "integer",
                        "description": "Optional 1-based starting sheet index (inclusive)."
                    },
                    "endSheet": {
                        "type": "integer",
                        "description": "Optional 1-based ending sheet index (inclusive)."
                    },
                    "startSec": {
                        "type": "number",
                        "description": "Optional start time in seconds to select overlapping filmstrip sheets."
                    },
                    "endSec": {
                        "type": "number",
                        "description": "Optional end time in seconds to select overlapping filmstrip sheets."
                    },
                    "maxSheets": {
                        "type": "integer",
                        "description": "Maximum sheets to attach per call (`1..10`, default `8`)."
                    }
                }
            }
        }
    })
}

fn locate_filmstrip_index(workspace_dir: &str) -> Option<(PathBuf, PathBuf)> {
    let ws_root = Path::new(workspace_dir);
    if let Ok(resolved) = resolve_isolated_path(workspace_dir, "ref/extracted/filmstrip_index.json") {
        if resolved.is_file() {
            if let Some(extracted_dir) = resolved.parent().map(Path::to_path_buf) {
                return Some((resolved, extracted_dir));
            }
        }
    }
    if let Some(html_path) = crate::studio::motion::resolve_active_html_film_path(Some(workspace_dir)) {
        if let Some(film_root) = html_path.parent() {
            let cand = film_root.join("ref").join("extracted").join("filmstrip_index.json");
            if cand.is_file() && crate::paths::contains_path(ws_root, &cand) {
                return Some((cand, film_root.join("ref").join("extracted")));
            }
        }
    }
    None
}

pub(crate) fn select_filmstrip_sheets<'a>(
    index_val: &'a Value,
    arguments: &Value,
) -> (Vec<&'a Value>, Option<&'a Value>, usize, Option<u64>) {
    let all_sheets = index_val
        .get("sheets")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let scenes = index_val
        .get("scenes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let scene_idx_arg = arguments.get("sceneIndex").and_then(Value::as_u64);
    let start_sheet_arg = arguments.get("startSheet").and_then(Value::as_u64);
    let end_sheet_arg = arguments.get("endSheet").and_then(Value::as_u64);
    let start_sec_arg = arguments.get("startSec").and_then(Value::as_f64);
    let end_sec_arg = arguments.get("endSec").and_then(Value::as_f64);
    let max_sheets = arguments
        .get("maxSheets")
        .and_then(Value::as_u64)
        .unwrap_or(8)
        .clamp(1, 10) as usize;

    let scene_info = scene_idx_arg.and_then(|s_num| {
        scenes
            .iter()
            .find(|s| s.get("index").and_then(Value::as_u64) == Some(s_num))
    });

    let mut matching: Vec<&'a Value> = if start_sheet_arg.is_some() || end_sheet_arg.is_some() {
        let lo = start_sheet_arg.unwrap_or(1);
        let hi = end_sheet_arg.unwrap_or(u64::MAX);
        all_sheets
            .iter()
            .filter(|sh| {
                let si = sh.get("sheetIndex").and_then(Value::as_u64).unwrap_or(0);
                si >= lo && si <= hi
            })
            .collect()
    } else if let Some(sc) = scene_info {
        let wanted: std::collections::HashSet<u64> = sc
            .get("sheetIndices")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(Value::as_u64).collect())
            .unwrap_or_default();
        if wanted.is_empty() {
            let st = sc.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let en = sc.get("end").and_then(Value::as_f64).unwrap_or(st + 0.5);
            all_sheets
                .iter()
                .filter(|sh| {
                    let s0 = sh.get("tStart").and_then(Value::as_f64).unwrap_or(0.0);
                    let s1 = sh.get("tEnd").and_then(Value::as_f64).unwrap_or(s0);
                    s1 >= st && s0 <= en
                })
                .collect()
        } else {
            all_sheets
                .iter()
                .filter(|sh| {
                    sh.get("sheetIndex")
                        .and_then(Value::as_u64)
                        .is_some_and(|idx| wanted.contains(&idx))
                })
                .collect()
        }
    } else if start_sec_arg.is_some() || end_sec_arg.is_some() {
        let lo = start_sec_arg.unwrap_or(0.0);
        let hi = end_sec_arg.unwrap_or(lo + 3.0).max(lo);
        all_sheets
            .iter()
            .filter(|sh| {
                let s0 = sh.get("tStart").and_then(Value::as_f64).unwrap_or(0.0);
                let s1 = sh.get("tEnd").and_then(Value::as_f64).unwrap_or(s0);
                s1 >= lo && s0 <= hi
            })
            .collect()
    } else {
        all_sheets.iter().collect()
    };

    if scene_idx_arg.is_some() && start_sheet_arg.is_some() {
        let lo = start_sheet_arg.unwrap_or(1);
        matching.retain(|sh| sh.get("sheetIndex").and_then(Value::as_u64).unwrap_or(0) >= lo);
    }

    let total_matching = matching.len();
    let next_start = if total_matching > max_sheets {
        matching
            .get(max_sheets)
            .and_then(|sh| sh.get("sheetIndex").and_then(Value::as_u64))
    } else {
        None
    };
    let sliced: Vec<&'a Value> = matching.into_iter().take(max_sheets).collect();
    (sliced, scene_info, total_matching, next_start)
}

pub fn execute_read_filmstrip(workspace_dir: &str, arguments: &Value) -> Value {
    let Some((index_path, extracted_dir)) = locate_filmstrip_index(workspace_dir) else {
        return json!({
            "ok": false,
            "error": "No `ref/extracted/filmstrip_index.json` found. Call `extract_video_reference` first."
        });
    };

    let Ok(raw) = std::fs::read_to_string(&index_path) else {
        return json!({
            "ok": false,
            "error": format!("Failed to read filmstrip index at {}", index_path.display())
        });
    };
    let Ok(index_val) = serde_json::from_str::<Value>(&raw) else {
        return json!({
            "ok": false,
            "error": format!("Invalid JSON in filmstrip index at {}", index_path.display())
        });
    };

    let (selected, scene_info, total_matching, next_start) =
        select_filmstrip_sheets(&index_val, arguments);
    if selected.is_empty() {
        return json!({
            "ok": false,
            "error": "No filmstrip sheets matched the requested scene/sheet/time filter.",
            "sheetCount": index_val.get("sheetCount").and_then(Value::as_u64).unwrap_or(0)
        });
    }

    let ws_root = Path::new(workspace_dir);
    let mut vision_images: Vec<Value> = Vec::with_capacity(selected.len());
    let mut vision_labels: Vec<Value> = Vec::with_capacity(selected.len());
    let mut returned_meta: Vec<Value> = Vec::with_capacity(selected.len());

    let first_idx = selected
        .first()
        .and_then(|s| s.get("sheetIndex").and_then(Value::as_u64))
        .unwrap_or(1);
    let last_idx = selected
        .last()
        .and_then(|s| s.get("sheetIndex").and_then(Value::as_u64))
        .unwrap_or(first_idx);
    let scene_tag = arguments
        .get("sceneIndex")
        .and_then(Value::as_u64)
        .map(|s| format!(" scene={s}"))
        .unwrap_or_default();

    for sh in &selected {
        let rel_vis = sh.get("visionRelPath").and_then(Value::as_str).unwrap_or("");
        let rel_raw = sh.get("relPath").and_then(Value::as_str).unwrap_or("");
        let vis_path = extracted_dir.join(rel_vis);
        let raw_path = extracted_dir.join(rel_raw);
        let chosen = if !rel_vis.is_empty()
            && vis_path.is_file()
            && crate::paths::contains_path(ws_root, &vis_path)
        {
            Some(vis_path)
        } else if !rel_raw.is_empty()
            && raw_path.is_file()
            && crate::paths::contains_path(ws_root, &raw_path)
        {
            Some(raw_path)
        } else {
            None
        };
        let Some(img_path) = chosen else {
            continue;
        };
        let Ok(bytes) = std::fs::read(&img_path) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }
        let s_idx = sh.get("sheetIndex").and_then(Value::as_u64).unwrap_or(0);
        let f0 = sh.get("frameStart").and_then(Value::as_u64).unwrap_or(0);
        let f1 = sh.get("frameEnd").and_then(Value::as_u64).unwrap_or(0);
        let t0 = sh.get("tStart").and_then(Value::as_f64).unwrap_or(0.0);
        let t1 = sh.get("tEnd").and_then(Value::as_f64).unwrap_or(0.0);
        let d_mean = sh.get("meanDelta").and_then(Value::as_f64).unwrap_or(0.0);

        vision_images.push(Value::String(format!(
            "data:image/jpeg;base64,{}",
            BASE64_STANDARD.encode(&bytes)
        )));
        vision_labels.push(json!(format!(
            "[FILMSTRIP_BATCH{scene_tag} sheets={first_idx}..{last_idx}] {rel_raw} (t={t0:.2}..{t1:.2}s, f{f0:04}..f{f1:04}, dMean={d_mean:.1})"
        )));
        returned_meta.push(json!({
            "sheetIndex": s_idx,
            "relPath": rel_raw,
            "frameStart": f0,
            "frameEnd": f1,
            "tStart": t0,
            "tEnd": t1,
            "tileCount": sh.get("tileCount").and_then(Value::as_u64).unwrap_or(0),
            "meanDelta": d_mean,
            "hasHold": sh.get("hasHold").and_then(Value::as_bool).unwrap_or(false),
        }));
    }

    let next_hint = next_start
        .map(|ns| format!(" More sheets remain — call `read_filmstrip({{ startSheet: {} }})` to view the rest.", ns))
        .unwrap_or_default();
    let mode = index_val
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("smart");

    json!({
        "ok": !vision_images.is_empty(),
        "mode": mode,
        "framesPerSheet": index_val.get("framesPerSheet").and_then(Value::as_u64).unwrap_or(10),
        "totalVideoFrames": index_val.get("totalFrames").and_then(Value::as_u64).unwrap_or(0),
        "sceneInfo": scene_info,
        "returnedSheets": returned_meta,
        "totalMatchingSheets": total_matching,
        "nextStartSheet": next_start,
        "output": format!(
            "Attached {} 1/1 filmstrip sheet(s) (sheets {}..{} of {} matching, mode={}). Inspect every frame tile top-left -> bottom-right!{}",
            vision_images.len(),
            first_idx,
            last_idx,
            total_matching,
            mode,
            next_hint
        ),
        "_vision_images": vision_images,
        "_vision_image_labels": vision_labels
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_filmstrip_selects_scene_sheets_paginates_and_tags_batch() {
        let dir = std::env::temp_dir().join(format!(
            "aetheria_read_fs_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ext = dir.join("ref").join("extracted");
        let fs_vis = ext.join("vision").join("filmstrips");
        std::fs::create_dir_all(&fs_vis).unwrap();

        let mut sheets = Vec::new();
        for idx in 1..=10u64 {
            let rel = format!("filmstrips/sheet_{idx:03}.jpg");
            let v_rel = format!("vision/filmstrips/sheet_{idx:03}.jpg");
            std::fs::write(ext.join(&v_rel), b"JPEGBYTES").unwrap();
            sheets.push(json!({
                "sheetIndex": idx,
                "relPath": rel,
                "visionRelPath": v_rel,
                "frameStart": (idx - 1) * 10,
                "frameEnd": idx * 10 - 1,
                "tStart": ((idx - 1) as f64) * 0.33,
                "tEnd": (idx as f64) * 0.33,
                "tileCount": 10,
                "meanDelta": 3.2,
                "hasHold": false,
                "sceneIndices": [1]
            }));
        }
        let idx_doc = json!({
            "version": 1,
            "mode": "smart",
            "framesPerSheet": 10,
            "totalFrames": 100,
            "sheetCount": 10,
            "sheets": sheets,
            "scenes": [{
                "index": 1,
                "id": "scene1_hook",
                "start": 0.0,
                "end": 3.3,
                "sheetIndices": [1,2,3,4,5,6,7,8,9,10],
                "meanDelta": 3.2,
                "staticPct": 5.0
            }]
        });
        std::fs::write(ext.join("filmstrip_index.json"), idx_doc.to_string()).unwrap();

        let ws_str = dir.to_string_lossy().to_string();
        let page1 = execute_read_filmstrip(&ws_str, &json!({ "sceneIndex": 1, "maxSheets": 6 }));
        assert_eq!(page1["ok"], true);
        assert_eq!(page1["totalMatchingSheets"], 10);
        assert_eq!(page1["nextStartSheet"], 7);
        let imgs1 = page1["_vision_images"].as_array().unwrap();
        let lbls1 = page1["_vision_image_labels"].as_array().unwrap();
        assert_eq!(imgs1.len(), 6);
        assert!(lbls1[0].as_str().unwrap().contains("[FILMSTRIP_BATCH scene=1 sheets=1..6]"));

        let page2 = execute_read_filmstrip(&ws_str, &json!({ "startSheet": 7, "endSheet": 10 }));
        assert_eq!(page2["ok"], true);
        assert_eq!(page2["nextStartSheet"], Value::Null);
        assert_eq!(page2["_vision_images"].as_array().unwrap().len(), 4);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
