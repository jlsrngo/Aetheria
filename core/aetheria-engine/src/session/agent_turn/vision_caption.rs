//! Automatic vision captioning pre-pass for text-only models using any signed-in vision bridge.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const MAX_CAPTION_IMAGES: usize = 4;
const CAPTION_TIMEOUT_SECS: u64 = 25;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VisionCaptionCandidate {
    pub source: &'static str,
    pub model_id: &'static str,
}

const VISION_CANDIDATE_ORDER: &[VisionCaptionCandidate] = &[
    VisionCaptionCandidate {
        source: "antigravity",
        model_id: "gemini-2.5-flash",
    },
    VisionCaptionCandidate {
        source: "kiro",
        model_id: "kiro/auto",
    },
    VisionCaptionCandidate {
        source: "codex",
        model_id: "gpt-4o",
    },
    VisionCaptionCandidate {
        source: "claude",
        model_id: "claude-sonnet-4-5",
    },
];

pub(crate) fn select_vision_caption_candidates(
    available_sources: &HashSet<String>,
) -> Vec<VisionCaptionCandidate> {
    VISION_CANDIDATE_ORDER
        .iter()
        .filter(|c| available_sources.contains(c.source))
        .cloned()
        .collect()
}

/// Calls an available signed-in vision model via the local CLI bridge to describe attached images
/// so text-only models can build accurate animations instead of guessing from hex palettes.
pub(crate) async fn describe_images_with_available_vision_model(
    image_urls: &[String],
) -> Option<(String, String)> {
    if image_urls.is_empty() {
        return None;
    }

    let creds = crate::cred_store::get_all_credentials();
    let available: HashSet<String> = creds
        .into_iter()
        .filter(|(_, entry)| !entry.access_token.trim().is_empty())
        .map(|(source, _)| source.to_ascii_lowercase())
        .collect();
    let candidates = select_vision_caption_candidates(&available);
    if candidates.is_empty() {
        return None;
    }

    let active_port = crate::bridge::ensure_bridge_running().await;
    let endpoint = format!("http://127.0.0.1:{}/v1/chat/completions", active_port);
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(CAPTION_TIMEOUT_SECS))
        .build()
        .ok()?;

    let mut content_parts = vec![json!({
        "type": "text",
        "text": "Inspect the attached reference image(s) for a motion-graphics engineer who cannot see images directly. Describe concretely in concise bullet points: (1) Main subject/objects and their exact recognizable shapes & silhouettes, (2) Spatial composition & perspective, (3) Any visible text verbatim, (4) Art style, outlines, shading, and which colors belong to which parts."
    })];
    for url in image_urls.iter().take(MAX_CAPTION_IMAGES) {
        content_parts.push(json!({
            "type": "image_url",
            "image_url": { "url": url }
        }));
    }

    for cand in candidates {
        let body = json!({
            "model": cand.model_id,
            "stream": false,
            "max_tokens": 512,
            "messages": [
                {
                    "role": "user",
                    "content": content_parts
                }
            ]
        });

        let resp = match client.post(&endpoint).json(&body).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let parsed: Value = match resp.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let caption = parsed
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if !caption.is_empty() {
            return Some((cand.model_id.to_string(), caption.to_string()));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_vision_caption_candidates_respects_priority() {
        let mut avail = HashSet::new();
        avail.insert("claude".to_string());
        avail.insert("kiro".to_string());
        let picked = select_vision_caption_candidates(&avail);
        assert_eq!(picked.len(), 2);
        assert_eq!(picked[0].source, "kiro");
        assert_eq!(picked[0].model_id, "kiro/auto");
        assert_eq!(picked[1].source, "claude");
    }
}
