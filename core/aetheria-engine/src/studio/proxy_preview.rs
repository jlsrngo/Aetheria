//! Hardware-decoded `<video>` Proxy MP4 Preview builder and status tracker.
//!
//! Pre-renders the active HTML/WebGL film into `<film_root>/.aetheria/proxy_preview.mp4`
//! using the `proxy` (`ultrafast`, half-resolution, keyframe-dense) FFmpeg preset so the
//! Studio canvas can play complex 3D animations at a locked 60fps via `<video>`.

use super::html_renderer::{render_active_html_film, HtmlRenderParams};
use super::motion::{resolve_active_dir_from_request, resolve_film_html_in_dir};
use crate::paths::{contains_path, now_ms};
use crate::tool::path_guard::resolve_isolated_path;
use axum::{
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const PROXY_MP4_REL: &str = ".aetheria/proxy_preview.mp4";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyPreviewStatus {
    pub state: String,
    pub progress: u32,
    pub message: String,
    pub stream_path: Option<String>,
    pub updated_at_ms: u64,
    pub stale: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyBuildPayload {
    pub directory: Option<String>,
}

static PROXY_JOBS: OnceLock<Mutex<HashMap<String, ProxyPreviewStatus>>> = OnceLock::new();

fn jobs_map() -> &'static Mutex<HashMap<String, ProxyPreviewStatus>> {
    PROXY_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn file_mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Returns the newest modification timestamp across `index.html` and `script/*.js` in `film_root`.
pub fn latest_source_mtime_ms(film_root: &Path) -> u64 {
    let mut newest = file_mtime_ms(&film_root.join("index.html"));
    let script_dir = film_root.join("script");
    if script_dir.is_dir() && contains_path(film_root, &script_dir) {
        if let Ok(entries) = std::fs::read_dir(&script_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && contains_path(&script_dir, &p) {
                    newest = newest.max(file_mtime_ms(&p));
                }
            }
        }
    }
    newest
}

/// Computes the current proxy preview status for `film_root`.
pub fn inspect_proxy_status(film_root: &Path) -> ProxyPreviewStatus {
    let key = film_root.to_string_lossy().to_string();
    if let Ok(guard) = jobs_map().lock() {
        if let Some(existing) = guard.get(&key) {
            if existing.state == "rendering" || existing.state == "error" {
                return existing.clone();
            }
        }
    }

    let Ok(mp4_path) = resolve_isolated_path(&key, PROXY_MP4_REL) else {
        return ProxyPreviewStatus {
            state: "idle".to_string(),
            progress: 0,
            message: "No proxy rendered".to_string(),
            stream_path: None,
            updated_at_ms: 0,
            stale: false,
        };
    };

    if mp4_path.is_file() {
        let mp4_mtime = file_mtime_ms(&mp4_path);
        let src_mtime = latest_source_mtime_ms(film_root);
        let stale = src_mtime > mp4_mtime.saturating_add(500);
        return ProxyPreviewStatus {
            state: "ready".to_string(),
            progress: 100,
            message: if stale {
                "Proxy ready (source updated — rebuild recommended)".to_string()
            } else {
                "Proxy MP4 ready".to_string()
            },
            stream_path: Some(PROXY_MP4_REL.to_string()),
            updated_at_ms: mp4_mtime,
            stale,
        };
    }

    ProxyPreviewStatus {
        state: "idle".to_string(),
        progress: 0,
        message: "No proxy rendered".to_string(),
        stream_path: None,
        updated_at_ms: 0,
        stale: false,
    }
}

fn set_job_status(key: &str, status: ProxyPreviewStatus) {
    if let Ok(mut guard) = jobs_map().lock() {
        guard.insert(key.to_string(), status);
    }
}

fn resolve_ws_and_film_root(
    explicit_dir: Option<&str>,
    q: &HashMap<String, String>,
    headers: &HeaderMap,
) -> Result<(PathBuf, PathBuf), String> {
    let ws_root = if let Some(dir) = explicit_dir.map(str::trim).filter(|s| !s.is_empty()) {
        let norm = crate::paths::normalize_workspace_path(dir);
        crate::desktop::set_active_workspace_root(&norm);
        PathBuf::from(norm)
    } else {
        resolve_active_dir_from_request(q, headers)
            .ok_or_else(|| "No active workspace directory".to_string())?
    };

    let html_path = resolve_film_html_in_dir(&ws_root)
        .ok_or_else(|| "No index.html found in active project folder".to_string())?;
    let film_root = html_path
        .parent()
        .ok_or_else(|| "Invalid index.html parent path".to_string())?
        .to_path_buf();

    if !contains_path(&ws_root, &film_root) {
        return Err("Active film root escapes workspace boundary".to_string());
    }

    Ok((ws_root, film_root))
}

/// GET /api/studio/proxy-preview
pub async fn handle_get_proxy_preview(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Ok((_, film_root)) = resolve_ws_and_film_root(None, &q, &headers) else {
        return Json(json!({
            "data": ProxyPreviewStatus {
                state: "idle".to_string(),
                progress: 0,
                message: "No active HTML film".to_string(),
                stream_path: None,
                updated_at_ms: 0,
                stale: false,
            }
        }))
        .into_response();
    };
    Json(json!({ "data": inspect_proxy_status(&film_root) })).into_response()
}

/// POST /api/studio/proxy-preview/build
pub async fn handle_build_proxy_preview(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    payload: Option<Json<ProxyBuildPayload>>,
) -> impl IntoResponse {
    let explicit_dir = payload.as_ref().and_then(|p| p.directory.as_deref());
    let (ws_root, film_root) = match resolve_ws_and_film_root(explicit_dir, &q, &headers) {
        Ok(pair) => pair,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
        }
    };

    let key = film_root.to_string_lossy().to_string();
    let output_path = match resolve_isolated_path(&key, PROXY_MP4_REL) {
        Ok(p) => p,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response();
        }
    };

    // If already rendering for this film_root, return current status immediately
    if let Ok(guard) = jobs_map().lock() {
        if let Some(curr) = guard.get(&key) {
            if curr.state == "rendering" {
                return Json(json!({ "data": curr.clone() })).into_response();
            }
        }
    }

    let initial = ProxyPreviewStatus {
        state: "rendering".to_string(),
        progress: 1,
        message: "Starting Rust proxy MP4 render...".to_string(),
        stream_path: None,
        updated_at_ms: now_ms(),
        stale: false,
    };
    set_job_status(&key, initial.clone());

    let ws_str = ws_root.to_string_lossy().to_string();
    let key_clone = key.clone();
    tokio::spawn(async move {
        let params = HtmlRenderParams {
            workspace_dir: Some(ws_str),
            output_path,
            codec: "proxy".to_string(),
            frame_range: None,
        };
        let k_status = key_clone.clone();
        let k_prog = key_clone.clone();
        let res = render_active_html_film(
            params,
            move |_total, msg| {
                set_job_status(
                    &k_status,
                    ProxyPreviewStatus {
                        state: "rendering".to_string(),
                        progress: 2,
                        message: msg,
                        stream_path: None,
                        updated_at_ms: now_ms(),
                        stale: false,
                    },
                );
            },
            move |done, total, pct| {
                set_job_status(
                    &k_prog,
                    ProxyPreviewStatus {
                        state: "rendering".to_string(),
                        progress: pct.clamp(1, 99),
                        message: format!("Rendering proxy ({}/{})", done, total),
                        stream_path: None,
                        updated_at_ms: now_ms(),
                        stale: false,
                    },
                );
            },
        )
        .await;

        match res {
            Ok(done) => {
                let mtime = file_mtime_ms(&done.output_path);
                set_job_status(
                    &key_clone,
                    ProxyPreviewStatus {
                        state: "ready".to_string(),
                        progress: 100,
                        message: "Proxy MP4 ready".to_string(),
                        stream_path: Some(PROXY_MP4_REL.to_string()),
                        updated_at_ms: mtime.max(now_ms()),
                        stale: false,
                    },
                );
            }
            Err(err) => {
                set_job_status(
                    &key_clone,
                    ProxyPreviewStatus {
                        state: "error".to_string(),
                        progress: 0,
                        message: err,
                        stream_path: None,
                        updated_at_ms: now_ms(),
                        stale: false,
                    },
                );
            }
        }
    });

    Json(json!({ "data": initial })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn make_temp_film_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("{}_{}", prefix, nanos));
        std::fs::create_dir_all(dir.join("script")).unwrap();
        std::fs::create_dir_all(dir.join(".aetheria")).unwrap();
        dir
    }

    #[test]
    fn detects_idle_ready_and_stale_proxy_mp4() {
        let dir = make_temp_film_dir("aetheria_proxy_test");
        std::fs::write(dir.join("index.html"), "<html></html>").unwrap();

        let idle = inspect_proxy_status(&dir);
        assert_eq!(idle.state, "idle");
        assert!(idle.stream_path.is_none());

        let mp4 = dir.join(".aetheria").join("proxy_preview.mp4");
        std::fs::write(&mp4, b"fake-mp4").unwrap();

        let ready = inspect_proxy_status(&dir);
        assert_eq!(ready.state, "ready");
        assert_eq!(ready.stream_path.as_deref(), Some(PROXY_MP4_REL));
        assert!(!ready.stale);

        std::thread::sleep(Duration::from_millis(650));
        std::fs::write(dir.join("script").join("scene1.js"), "// updated").unwrap();

        let stale = inspect_proxy_status(&dir);
        assert_eq!(stale.state, "ready");
        assert!(stale.stale);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
