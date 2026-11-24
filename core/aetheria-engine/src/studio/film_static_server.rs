//! Ephemeral localhost HTTP server for serving an isolated project's HTML film assets to headless Chromium.

use crate::paths::{contains_path, project_root};
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::task::JoinHandle;

pub struct FilmServerGuard(Option<JoinHandle<()>>);

impl Drop for FilmServerGuard {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            handle.abort();
        }
    }
}

pub fn pick_ephemeral_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed allocating ephemeral port: {}", e))?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

async fn serve_static_film_file(film_root: &Path, _ws_root: &Path, rel_raw: &str) -> Response {
    let clean = rel_raw.trim().trim_start_matches('/').replace('\\', "/");
    let target_rel = if clean.is_empty() { "index.html" } else { clean.as_str() };
    if target_rel.contains("..") || target_rel.contains('\0') {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }

    if target_rel == "index.html" {
        let index_path = film_root.join("index.html");
        let raw_html = match tokio::fs::read_to_string(&index_path).await {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return (
                    StatusCode::NOT_FOUND,
                    format!("HTML film entry not found: {}", index_path.display()),
                )
                    .into_response();
            }
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed reading index.html '{}': {}", index_path.display(), err),
                )
                    .into_response();
            }
        };
        let mut html =
            super::builtin_runtime::rewrite_three_cdn_tags(&raw_html, Some("/script/three.min.js"));
        let mut injected = String::new();
        if !html.contains("aetheria-post.js") {
            injected.push_str("<script src=\"/script/aetheria-post.js\"></script>\n");
        }
        if !html.contains("aetheria-tracks.js") {
            injected.push_str("<script src=\"/script/aetheria-tracks.js\"></script>\n");
        }
        if !html.contains("aetheria-behaviors.js") {
            injected.push_str("<script src=\"/script/aetheria-behaviors.js\"></script>\n");
        }
        if !html.contains("aetheria-shapes-text.js") {
            injected.push_str("<script src=\"/script/aetheria-shapes-text.js\"></script>\n");
        }
        if !html.contains("aetheria-stage.js") {
            injected.push_str("<script src=\"/script/aetheria-stage.js\"></script>\n");
        }
        if !html.contains("aetheria-motion.js") {
            injected.push_str("<script src=\"/script/aetheria-motion.js\"></script>\n");
        }
        if !injected.is_empty() {
            if let Some(head_idx) = html.find("</head>") {
                html.insert_str(head_idx, &injected);
            } else {
                html = format!("{}{}", injected, html);
            }
        }
        return ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response();
    }

    let search_roots = [film_root.to_path_buf(), film_root.join("public")];

    for root in search_roots {
        let candidate = root.join(target_rel);
        if contains_path(&root, &candidate) && candidate.is_file() {
            if let Ok(bytes) = tokio::fs::read(&candidate).await {
                let mime = mime_guess::from_path(&candidate)
                    .first_or_octet_stream()
                    .to_string();
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime)
                    .body(axum::body::Body::from(bytes))
                    .unwrap_or_else(|_| {
                        (StatusCode::INTERNAL_SERVER_ERROR, "IO error").into_response()
                    });
            }
        }
    }

    // Built-in engine runtime helpers & bundled SFX fallback
    if super::builtin_runtime::is_builtin_three_path(target_rel) {
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            super::builtin_runtime::THREE_MIN_JS,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_motion_path(target_rel) {
        let code = super::builtin_runtime::resolve_motion_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_post_path(target_rel) {
        let code = super::builtin_runtime::resolve_post_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_stage_path(target_rel) {
        let code = super::builtin_runtime::resolve_stage_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_tracks_path(target_rel) {
        let code = super::builtin_runtime::resolve_tracks_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_behaviors_path(target_rel) {
        let code = super::builtin_runtime::resolve_behaviors_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_shapes_text_path(target_rel) {
        let code = super::builtin_runtime::resolve_shapes_text_runtime_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_story_core_path(target_rel) {
        let code = super::builtin_runtime::resolve_story_core_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if super::builtin_runtime::is_builtin_story_camera_path(target_rel) {
        let code = super::builtin_runtime::resolve_story_camera_code(&project_root());
        return (
            [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
            code,
        )
            .into_response();
    }

    if target_rel.starts_with("sfx/") {
        let engine_pub = project_root().join("apps").join("public");
        let fallback = engine_pub.join(target_rel);
        if contains_path(&engine_pub, &fallback) && fallback.is_file() {
            if let Ok(bytes) = tokio::fs::read(&fallback).await {
                let mime = mime_guess::from_path(&fallback)
                    .first_or_octet_stream()
                    .to_string();
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime)
                    .body(axum::body::Body::from(bytes))
                    .unwrap_or_else(|_| {
                        (StatusCode::INTERNAL_SERVER_ERROR, "IO error").into_response()
                    });
            }
        }
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

async fn handle_root_file(
    State((film_root, ws_root)): State<(Arc<PathBuf>, Arc<PathBuf>)>,
) -> Response {
    serve_static_film_file(&film_root, &ws_root, "index.html").await
}

async fn handle_sub_file(
    AxumPath(rel): AxumPath<String>,
    State((film_root, ws_root)): State<(Arc<PathBuf>, Arc<PathBuf>)>,
) -> Response {
    serve_static_film_file(&film_root, &ws_root, &rel).await
}

/// Binds an ephemeral localhost HTTP server serving `film_root` and returns `(port, guard)`.
pub async fn start_ephemeral_film_server(
    film_root: PathBuf,
    ws_root: PathBuf,
) -> Result<(u16, FilmServerGuard), String> {
    let http_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed binding temporary film HTTP server: {}", e))?;
    let http_port = http_listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = (Arc::new(film_root), Arc::new(ws_root));
    let app = Router::new()
        .route("/", get(handle_root_file))
        .route("/*path", get(handle_sub_file))
        .with_state(state);

    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(http_listener, app).await;
    });
    Ok((http_port, FilmServerGuard(Some(server_handle))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_index_html_returns_404_not_empty_200() {
        let dir = std::env::temp_dir().join(format!("aetheria_static_404_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let (port, _guard) = start_ephemeral_film_server(dir.clone(), dir.clone())
            .await
            .unwrap();
        let resp = reqwest::get(format!("http://127.0.0.1:{}/index.html", port))
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::NOT_FOUND);
        let body = resp.text().await.unwrap();
        assert!(body.contains("HTML film entry not found"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn existing_index_html_returns_200_with_runtime_tag() {
        let dir = std::env::temp_dir().join(format!("aetheria_static_200_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html><head></head><body>Hi</body></html>").unwrap();

        let (port, _guard) = start_ephemeral_film_server(dir.clone(), dir.clone())
            .await
            .unwrap();
        let resp = reqwest::get(format!("http://127.0.0.1:{}/index.html", port))
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::OK);
        let body = resp.text().await.unwrap();
        assert!(body.contains("aetheria-motion.js"));

        let cam_resp = reqwest::get(format!("http://127.0.0.1:{}/script/story-camera.js", port))
            .await
            .unwrap();
        assert_eq!(cam_resp.status(), reqwest::StatusCode::OK);
        let cam_body = cam_resp.text().await.unwrap();
        assert!(cam_body.contains("StoryCamera"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

