//! Parallel CDP page tab provisioning and ordered frame assembly for headless HTML rendering.

use super::cdp_ws::CdpWebSocket;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn compute_worker_count_from_hints(
    frames_to_render: u32,
    env_override: Option<&str>,
    hw_threads: usize,
) -> usize {
    let target_frames = frames_to_render.max(1) as usize;
    if let Some(raw) = env_override {
        if let Ok(parsed) = raw.trim().parse::<usize>() {
            if parsed >= 1 {
                return parsed.clamp(1, 8).min(target_frames);
            }
        }
    }
    if frames_to_render < 24 {
        return 1;
    }
    (hw_threads / 2).clamp(2, 4).min(target_frames)
}

/// Computes how many parallel headless browser tabs should render `frames_to_render`.
/// Uses `AETHERIA_RENDER_WORKERS` when set (`1..=8`), `1` for short (< 24 frame) renders,
/// and `2..=4` workers otherwise.
pub(super) fn compute_render_worker_count(frames_to_render: u32) -> usize {
    let env_val = std::env::var("AETHERIA_RENDER_WORKERS").ok();
    let hw = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    compute_worker_count_from_hints(frames_to_render, env_val.as_deref(), hw)
}

/// Accumulates out-of-order frames from parallel workers and yields contiguous chunks
/// starting at index `0` for sequential FFmpeg stdin writes.
pub(super) struct OrderedFrameBuffer {
    next_expected: usize,
    pending: BTreeMap<usize, Vec<u8>>,
}

impl OrderedFrameBuffer {
    pub(super) fn new() -> Self {
        Self {
            next_expected: 0,
            pending: BTreeMap::new(),
        }
    }

    pub(super) fn push_and_drain(&mut self, idx: usize, bytes: Vec<u8>) -> Vec<(usize, Vec<u8>)> {
        self.pending.insert(idx, bytes);
        let mut ready = Vec::new();
        while let Some(frame_bytes) = self.pending.remove(&self.next_expected) {
            ready.push((self.next_expected, frame_bytes));
            self.next_expected += 1;
        }
        ready
    }
}

/// Opens `extra_count` additional isolated page targets in the running Chromium browser
/// and connects a dedicated `CdpWebSocket` to each. Returns only successfully opened tabs
/// so callers gracefully degrade to fewer workers if tab creation fails.
pub(super) async fn open_additional_cdp_tabs(cdp_port: u16, extra_count: usize) -> Vec<CdpWebSocket> {
    if extra_count == 0 {
        return Vec::new();
    }
    let Ok(client) = reqwest::Client::builder().no_proxy().build() else {
        return Vec::new();
    };
    let version_url = format!("http://127.0.0.1:{}/json/version", cdp_port);
    let Ok(resp) = client.get(&version_url).send().await else {
        return Vec::new();
    };
    let Ok(info) = resp.json::<Value>().await else {
        return Vec::new();
    };
    let Some(browser_ws) = info.get("webSocketDebuggerUrl").and_then(Value::as_str) else {
        return Vec::new();
    };
    let Ok(mut browser_cdp) = CdpWebSocket::connect(browser_ws).await else {
        return Vec::new();
    };

    let mut tabs = Vec::with_capacity(extra_count);
    for _ in 0..extra_count {
        // Each worker needs its own top-level window so Chromium never throttles
        // requestAnimationFrame() in background tabs sharing one window.
        let Ok(created) = browser_cdp
            .call("Target.createTarget", json!({ "url": "about:blank", "newWindow": true }))
            .await
        else {
            break;
        };
        let Some(target_id) = created.get("targetId").and_then(Value::as_str) else {
            continue;
        };
        let page_ws = format!("ws://127.0.0.1:{}/devtools/page/{}", cdp_port, target_id);
        match CdpWebSocket::connect(&page_ws).await {
            Ok(ws) => tabs.push(ws),
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_millis(35)).await;
                if let Ok(ws) = CdpWebSocket::connect(&page_ws).await {
                    tabs.push(ws);
                }
            }
        }
    }
    tabs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_count_respects_short_renders_cores_and_env_override() {
        assert_eq!(compute_worker_count_from_hints(12, None, 16), 1);
        assert_eq!(compute_worker_count_from_hints(24, None, 2), 2);
        assert_eq!(compute_worker_count_from_hints(450, None, 16), 4);
        assert_eq!(compute_worker_count_from_hints(450, Some("6"), 16), 6);
        assert_eq!(compute_worker_count_from_hints(450, Some("99"), 16), 8);
        assert_eq!(compute_worker_count_from_hints(3, Some("6"), 16), 3);
    }

    #[test]
    fn ordered_frame_buffer_drains_out_of_order_frames_strictly_sequentially() {
        let mut buf = OrderedFrameBuffer::new();
        assert!(buf.push_and_drain(2, vec![2]).is_empty());
        assert!(buf.push_and_drain(1, vec![1]).is_empty());
        assert_eq!(buf.next_expected, 0);

        let drained = buf.push_and_drain(0, vec![0]);
        assert_eq!(drained, vec![(0, vec![0]), (1, vec![1]), (2, vec![2])]);
        assert_eq!(buf.next_expected, 3);
    }
}
