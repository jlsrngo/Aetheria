//! Native Rust GPU video streamer with HTTP 206 Partial Content byte-range support.

use axum::{
    extract::Query,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

#[derive(Deserialize)]
pub struct StreamVideoQuery {
    pub path: Option<String>,
    pub file: Option<String>,
}

pub fn resolve_stream_video_target(
    workspace: Option<&Path>,
    path: Option<&str>,
    file: Option<&str>,
) -> Result<PathBuf, (StatusCode, &'static str)> {
    let ws = workspace.ok_or((
        StatusCode::FORBIDDEN,
        "No active project workspace is open",
    ))?;

    if let Some(p) = path.map(str::trim).filter(|s| !s.is_empty()) {
        let candidate = Path::new(p);
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            ws.join(candidate)
        };
        if !crate::paths::contains_path(ws, &joined) {
            return Err((
                StatusCode::FORBIDDEN,
                "Access denied: path escapes active project workspace",
            ));
        }
        return Ok(joined);
    }

    if let Some(f) = file.map(str::trim).filter(|s| !s.is_empty()) {
        let output_dir = ws.join("output");
        let candidate = Path::new(f);
        if candidate.is_absolute() {
            return Err((
                StatusCode::FORBIDDEN,
                "Access denied: file query cannot be an absolute path",
            ));
        }
        let joined = output_dir.join(candidate);
        if !crate::paths::contains_path(&output_dir, &joined) {
            return Err((
                StatusCode::FORBIDDEN,
                "Access denied: file escapes workspace output folder",
            ));
        }
        return Ok(joined);
    }

    Err((StatusCode::BAD_REQUEST, "Missing file or path query parameter"))
}

/// GET /api/studio/stream-video?file=linus-torvalds-preview.mp4
pub async fn handle_stream_video(
    headers: HeaderMap,
    Query(query): Query<StreamVideoQuery>,
) -> Response {
    let active_ws = crate::desktop::get_active_workspace_root()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);

    let target_path = match resolve_stream_video_target(
        active_ws.as_deref(),
        query.path.as_deref(),
        query.file.as_deref(),
    ) {
        Ok(p) => p,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    if !target_path.exists() || !target_path.is_file() {
        return (StatusCode::NOT_FOUND, "Video file not found").into_response();
    }

    serve_ranged_file(&headers, &target_path).await
}

/// Streams any static or media file with HTTP 206 Partial Content byte-range support.
pub(crate) async fn serve_ranged_file(
    headers: &HeaderMap,
    target_path: &std::path::Path,
) -> Response {
    let mut file = match tokio::fs::File::open(target_path).await {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to open video file",
            )
                .into_response()
        }
    };

    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to read file metadata",
            )
                .into_response()
        }
    };

    let file_size = metadata.len();
    let content_type = mime_guess::from_path(target_path)
        .first_or_octet_stream()
        .to_string();

    const MAX_STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
    let range_header = headers.get(header::RANGE).and_then(|h| h.to_str().ok());

    if let Some(range) = range_header {
        match parse_http_byte_range(range, file_size) {
            Ok((start, raw_end)) => {
                let end = raw_end.min(start.saturating_add(MAX_STREAM_CHUNK_BYTES - 1)).min(file_size.saturating_sub(1));
                let length = end - start + 1;
                if file.seek(std::io::SeekFrom::Start(start)).await.is_ok() {
                    let mut chunk = vec![0u8; length as usize];
                    if file.read_exact(&mut chunk).await.is_ok() {
                        return Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header(header::CONTENT_TYPE, content_type)
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(
                                header::CONTENT_RANGE,
                                format!("bytes {}-{}/{}", start, end, file_size),
                            )
                            .header(header::CONTENT_LENGTH, length.to_string())
                            .body(axum::body::Body::from(chunk))
                            .unwrap_or_else(|_| {
                                (StatusCode::INTERNAL_SERVER_ERROR, "Body error").into_response()
                            });
                    }
                }
            }
            Err(()) => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", file_size))
                    .body(axum::body::Body::empty())
                    .unwrap_or_else(|_| {
                        (StatusCode::RANGE_NOT_SATISFIABLE, "Range Not Satisfiable").into_response()
                    });
            }
        }
    }

    let mut all_bytes = Vec::with_capacity(file_size.min(16 * 1024 * 1024) as usize);
    if file.read_to_end(&mut all_bytes).await.is_ok() {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, file_size.to_string())
            .body(axum::body::Body::from(all_bytes))
            .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Body error").into_response())
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response()
    }
}

fn parse_http_byte_range(range_header: &str, file_size: u64) -> Result<(u64, u64), ()> {
    if file_size == 0 {
        return Err(());
    }
    let spec = range_header
        .trim()
        .strip_prefix("bytes=")
        .ok_or(())?
        .split(',')
        .next()
        .ok_or(())?
        .trim();
    let (raw_start, raw_end) = spec.split_once('-').ok_or(())?;
    let s_str = raw_start.trim();
    let e_str = raw_end.trim();
    if s_str.is_empty() {
        if e_str.is_empty() {
            return Err(());
        }
        let suffix_len: u64 = e_str.parse().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }
        let clamped = suffix_len.min(file_size);
        return Ok((file_size - clamped, file_size - 1));
    }
    let start: u64 = s_str.parse().map_err(|_| ())?;
    if start >= file_size {
        return Err(());
    }
    let end: u64 = if e_str.is_empty() {
        file_size - 1
    } else {
        e_str.parse::<u64>().map_err(|_| ())?.min(file_size - 1)
    };
    if start > end {
        return Err(());
    }
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::{parse_http_byte_range, resolve_stream_video_target};
    use axum::http::StatusCode;
    use std::path::Path;

    #[test]
    fn test_stream_video_requires_active_workspace() {
        let err = resolve_stream_video_target(None, None, Some("clip.mp4")).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_stream_video_blocks_traversal_and_outside_paths() {
        let ws = std::env::temp_dir().join("aetheria_stream_test_ws");
        let _ = std::fs::create_dir_all(ws.join("output"));

        let err_rel = resolve_stream_video_target(Some(&ws), Some("../../secret.mp4"), None).unwrap_err();
        assert_eq!(err_rel.0, StatusCode::FORBIDDEN);

        #[cfg(windows)]
        let outside_abs = "C:\\Windows\\win.ini";
        #[cfg(not(windows))]
        let outside_abs = "/etc/passwd";
        let err_abs = resolve_stream_video_target(Some(&ws), Some(outside_abs), None).unwrap_err();
        assert_eq!(err_abs.0, StatusCode::FORBIDDEN);

        let err_file = resolve_stream_video_target(Some(&ws), None, Some("../secret.mp4")).unwrap_err();
        assert_eq!(err_file.0, StatusCode::FORBIDDEN);

        let ok_rel = resolve_stream_video_target(Some(&ws), None, Some("demo.mp4")).unwrap();
        assert_eq!(ok_rel, ws.join("output").join("demo.mp4"));

        let inside_abs = ws.join("output").join("demo.mp4");
        let ok_abs = resolve_stream_video_target(
            Some(&ws),
            Some(inside_abs.to_string_lossy().as_ref()),
            None,
        )
        .unwrap();
        assert_eq!(Path::new(&ok_abs), inside_abs.as_path());

        let _ = std::fs::remove_dir_all(&ws);
    }

    #[test]
    fn test_parse_http_byte_range_handles_suffix_and_bounds() {
        assert_eq!(parse_http_byte_range("bytes=-500", 1000), Ok((500, 999)));
        assert_eq!(parse_http_byte_range("bytes=-2000", 1000), Ok((0, 999)));
        assert_eq!(parse_http_byte_range("bytes=100-199", 1000), Ok((100, 199)));
        assert_eq!(parse_http_byte_range("bytes=900-", 1000), Ok((900, 999)));
        assert!(parse_http_byte_range("bytes=1000-", 1000).is_err());
        assert!(parse_http_byte_range("bytes=500-400", 1000).is_err());
    }
}

