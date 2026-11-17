//! Web Page Fetch & HTML-to-Text/Markdown Extractor — mirrors `packages/core/src/tool/webfetch.ts`.

use serde_json::{json, Value};
use std::net::IpAddr;

const MAX_WEBFETCH_BYTES: usize = 5 * 1024 * 1024;

pub(crate) fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_forbidden_ip(IpAddr::V4(mapped));
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xfe00) == 0xfc00
                || (seg0 & 0xffc0) == 0xfe80
        }
    }
}

pub(crate) async fn validate_public_http_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw_url).map_err(|e| format!("Invalid URL '{}': {}", raw_url, e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Forbidden URL scheme '{}': only http/https allowed", other)),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL must contain a valid hostname".to_string())?;
    let host_lower = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host_lower == "localhost"
        || host_lower.ends_with(".localhost")
        || host_lower.ends_with(".local")
        || host_lower.ends_with(".internal")
    {
        return Err(format!("Blocked private/local hostname '{}'", host));
    }
    if let Ok(ip) = host_lower.parse::<IpAddr>() {
        if is_forbidden_ip(ip) {
            return Err(format!("Blocked non-public IP address '{}'", ip));
        }
        return Ok(parsed);
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    if let Ok(addrs) = tokio::net::lookup_host((host_lower.as_str(), port)).await {
        let mut saw_any = false;
        for addr in addrs {
            saw_any = true;
            if is_forbidden_ip(addr.ip()) {
                return Err(format!(
                    "Blocked DNS resolution to non-public IP {} for host '{}'",
                    addr.ip(),
                    host
                ));
            }
        }
        if !saw_any {
            return Err(format!("Host '{}' did not resolve to any address", host));
        }
    }
    Ok(parsed)
}

pub(crate) async fn fetch_bounded_public_url(
    raw_url: &str,
    user_agent: &str,
    max_bytes: usize,
    timeout_secs: u64,
) -> Result<(u16, Vec<u8>), String> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("HTTP client build error: {}", e))?;

    let mut current_url = raw_url.to_string();
    for _hop in 0..=3 {
        let parsed = validate_public_http_url(&current_url).await?;
        let mut resp = client
            .get(parsed.clone())
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;
        let status = resp.status();
        if status.is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "Redirect response missing Location header".to_string())?;
            current_url = parsed
                .join(loc)
                .map_err(|e| format!("Invalid redirect target '{}': {}", loc, e))?
                .to_string();
            continue;
        }
        if let Some(len) = resp.content_length() {
            if len > max_bytes as u64 {
                return Err(format!(
                    "Response size {} bytes exceeds maximum limit of {} bytes",
                    len, max_bytes
                ));
            }
        }
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("Error reading response body: {}", e))?
        {
            if buf.len().saturating_add(chunk.len()) > max_bytes {
                return Err(format!(
                    "Response exceeded maximum limit of {} bytes",
                    max_bytes
                ));
            }
            buf.extend_from_slice(&chunk);
        }
        return Ok((status.as_u16(), buf));
    }
    Err("Too many HTTP redirects".to_string())
}

pub fn webfetch_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "webfetch",
            "description": include_str!("prompt/webfetch.txt"),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The HTTP/HTTPS URL to fetch."
                    },
                    "format": {
                        "type": "string",
                        "enum": ["markdown", "text", "html"],
                        "description": "Desired output format (default: markdown)."
                    }
                },
                "required": ["url"]
            }
        }
    })
}

pub async fn execute_webfetch(arguments: &Value) -> Value {
    let url = arguments
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let format = arguments
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("markdown");

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return json!({ "ok": false, "error": "URL must start with http:// or https://" });
    }

    match fetch_bounded_public_url(
        url,
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AetheriaNexus/1.0",
        MAX_WEBFETCH_BYTES,
        20,
    )
    .await
    {
        Ok((status, bytes)) => {
            let raw_body = String::from_utf8_lossy(&bytes).into_owned();
            let media = extract_html_media_urls(&raw_body);
            let cleaned = if format == "html" {
                raw_body
            } else {
                let text = strip_html_to_readable_text(&raw_body);
                if media.is_empty() {
                    text
                } else {
                    format!("[Extracted Media URLs: {}]\n\n{}", media.join(", "), text)
                }
            };
            let (bounded, _) = crate::tool::truncator::bound_tool_output("webfetch", &cleaned);
            json!({
                "ok": (200..300).contains(&status),
                "status": status,
                "url": url,
                "media": media,
                "output": bounded
            })
        }
        Err(e) => json!({ "ok": false, "error": format!("webfetch blocked/failed: {}", e) }),
    }
}

fn read_tag_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    for quote in ['"', '\''] {
        let pat = format!("{}={}", attr, quote);
        if let Some(idx) = tag.find(&pat) {
            let rest = &tag[idx + pat.len()..];
            if let Some(end) = rest.find(quote) {
                return Some(&rest[..end]);
            }
        }
    }
    None
}

fn push_unique_media_url(urls: &mut Vec<String>, raw: &str, max_urls: usize) {
    let cleaned = raw.replace("&amp;", "&").trim().to_string();
    if (cleaned.starts_with("https://") || cleaned.starts_with("http://"))
        && !urls.contains(&cleaned)
        && urls.len() < max_urls
    {
        urls.push(cleaned);
    }
}

pub(crate) fn extract_html_media_urls(html: &str) -> Vec<String> {
    const MAX_MEDIA_URLS: usize = 5;
    let mut urls = Vec::new();

    let mut pos = 0;
    while let Some(rel) = html[pos..].find('<') {
        let start = pos + rel;
        let Some(end_rel) = html[start..].find('>') else {
            break;
        };
        let tag = &html[start..=start + end_rel];
        let lower = tag.to_ascii_lowercase();
        if lower.starts_with("<meta") {
            let prop = read_tag_attr(&lower, "property")
                .or_else(|| read_tag_attr(&lower, "name"))
                .unwrap_or("");
            if matches!(
                prop,
                "og:image" | "twitter:image" | "twitter:image:src" | "og:video" | "og:video:url"
            ) {
                if let Some(content) = read_tag_attr(tag, "content") {
                    push_unique_media_url(&mut urls, content, MAX_MEDIA_URLS);
                }
            }
        } else if lower.starts_with("<img") {
            if let Some(src) = read_tag_attr(tag, "src") {
                push_unique_media_url(&mut urls, src, MAX_MEDIA_URLS);
            }
        }
        if urls.len() >= MAX_MEDIA_URLS {
            break;
        }
        pos = start + end_rel + 1;
    }

    urls
}

fn strip_html_to_readable_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_og_image_and_img_src_up_to_five_urls() {
        let html = r#"
            <html><head>
                <meta content="https://i.pinimg.com/736x/76/ed/af/76edaf00529634c5287f884a8b4ef38d.jpg" property="og:image"/>
                <meta property="og:video" content="https://v1.pinimg.com/videos/mc/720p/sample.mp4"/>
            </head><body>
                <img src="https://example.com/1.png"/>
                <img src="https://example.com/2.png"/>
                <img src="https://example.com/3.png"/>
                <img src="https://example.com/4.png"/>
            </body></html>
        "#;
        let media = extract_html_media_urls(html);
        assert_eq!(media.len(), 5);
        assert_eq!(
            media[0],
            "https://i.pinimg.com/736x/76/ed/af/76edaf00529634c5287f884a8b4ef38d.jpg"
        );
        assert_eq!(media[1], "https://v1.pinimg.com/videos/mc/720p/sample.mp4");
    }

    #[tokio::test]
    async fn validate_public_http_url_blocks_loopback_private_and_metadata_ips() {
        assert!(validate_public_http_url("http://127.0.0.1:4196/api/health").await.is_err());
        assert!(validate_public_http_url("http://169.254.169.254/latest/meta-data").await.is_err());
        assert!(validate_public_http_url("http://10.0.0.1/admin").await.is_err());
        assert!(validate_public_http_url("http://192.168.1.1/").await.is_err());
        assert!(validate_public_http_url("http://localhost:8080/").await.is_err());
        assert!(validate_public_http_url("file:///C:/Windows/win.ini").await.is_err());
        assert!(validate_public_http_url("https://93.184.216.34/page").await.is_ok());
    }
}

