//! Persistent Warm Headless Chromium/Edge CDP Session Manager for Visual Preview Captures.
//! Avoids paying cold browser spawn latency (~1.5-2.5s) on every rapid preview edit iteration while
//! automatically reaping idle browser instances after 90s so memory stays bounded.

use super::cdp_ws::CdpWebSocket;
use super::html_renderer::{launch_headless_browser_with_cdp, ChromeProcessGuard};
use serde_json::json;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex;

pub(crate) const WARM_BROWSER_IDLE_TIMEOUT_MS: u64 = 300_000;
const REAPER_TICK_SECS: u64 = 15;
const ERROR_HOOK_SOURCE: &str = "window.__aetheriaHeadless = true; window.__aetheriaErrors = []; window.addEventListener('error', e => { const msg = String(e.message || e.error || 'Script error'); window.__aetheriaErrors.push(e.lineno ? `${msg} (line ${e.lineno}:${e.colno || 0})` : msg); }); window.addEventListener('unhandledrejection', e => window.__aetheriaErrors.push(String(e.reason || 'Unhandled promise rejection'))); (() => { const origErr = console.error; console.error = function(...args) { try { const txt = args.map(a => typeof a === 'object' && a && a.stack ? a.stack : String(a)).join(' ').slice(0, 320); if (txt && window.__aetheriaErrors.length < 16) window.__aetheriaErrors.push('console.error: ' + txt); } catch (_) {} return origErr.apply(console, args); }; })();";

pub(crate) struct WarmPreviewBrowser {
    pub(crate) cdp: CdpWebSocket,
    _guard: ChromeProcessGuard,
    last_used_ms: u64,
}

static WARM_PREVIEW_BROWSER: OnceLock<Mutex<Option<WarmPreviewBrowser>>> = OnceLock::new();
static REAPER_INIT: Once = Once::new();
static REAPER_STOP: AtomicBool = AtomicBool::new(false);

fn warm_browser_mutex() -> &'static Mutex<Option<WarmPreviewBrowser>> {
    WARM_PREVIEW_BROWSER.get_or_init(|| Mutex::new(None))
}

pub(crate) fn is_warm_browser_expired(last_used_ms: u64, now_ms: u64, ttl_ms: u64) -> bool {
    now_ms.saturating_sub(last_used_ms) >= ttl_ms
}

fn ensure_reaper_started() {
    REAPER_INIT.call_once(|| {
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                while !REAPER_STOP.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_secs(REAPER_TICK_SECS)).await;
                    let mut guard = warm_browser_mutex().lock().await;
                    let expired = guard
                        .as_ref()
                        .map(|w| {
                            is_warm_browser_expired(
                                w.last_used_ms,
                                crate::paths::now_ms(),
                                WARM_BROWSER_IDLE_TIMEOUT_MS,
                            )
                        })
                        .unwrap_or(false);
                    if expired {
                        let old = guard.take();
                        drop(guard);
                        drop(old);
                    }
                }
            });
        }
    });
}

/// Launches a fresh Chromium/Edge CDP browser instance and installs the page/runtime hooks once.
pub(crate) async fn acquire_fresh_preview_browser(
    browser_exe: &Path,
    width: u32,
    height: u32,
) -> Result<WarmPreviewBrowser, String> {
    let (guard, mut cdp) = launch_headless_browser_with_cdp(browser_exe, width, height).await?;
    let _ = cdp.call("Page.enable", json!({})).await?;
    let _ = cdp.call("Runtime.enable", json!({})).await?;
    let _ = cdp
        .call(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": ERROR_HOOK_SOURCE }),
        )
        .await?;
    Ok(WarmPreviewBrowser {
        cdp,
        _guard: guard,
        last_used_ms: crate::paths::now_ms(),
    })
}

/// Acquires an existing warm browser if within the 90s idle TTL, or spawns a fresh one.
/// Never holds `tokio::sync::Mutex` across browser spawn I/O.
pub(crate) async fn acquire_warm_preview_browser(
    browser_exe: &Path,
    width: u32,
    height: u32,
) -> Result<(WarmPreviewBrowser, bool), String> {
    ensure_reaper_started();
    let cached = {
        let mut slot = warm_browser_mutex().lock().await;
        slot.take()
    };
    if let Some(mut warm) = cached {
        if !is_warm_browser_expired(
            warm.last_used_ms,
            crate::paths::now_ms(),
            WARM_BROWSER_IDLE_TIMEOUT_MS,
        ) {
            warm.last_used_ms = crate::paths::now_ms();
            return Ok((warm, true));
        }
        // Expired: drop cleanly before launching fresh instance.
        drop(warm);
    }

    let fresh = acquire_fresh_preview_browser(browser_exe, width, height).await?;
    Ok((fresh, false))
}

/// Resets page state to `about:blank` to release previous canvas/GPU/timer memory and returns the
/// browser to the warm pool if healthy.
pub(crate) async fn release_warm_preview_browser(mut warm: WarmPreviewBrowser) {
    let alive = tokio::time::timeout(
        Duration::from_millis(900),
        warm.cdp.call("Page.navigate", json!({ "url": "about:blank" })),
    )
    .await
    .map(|res| res.is_ok())
    .unwrap_or(false);

    if !alive {
        drop(warm);
        return;
    }

    warm.last_used_ms = crate::paths::now_ms();
    let mut slot = warm_browser_mutex().lock().await;
    let evicted = slot.replace(warm);
    drop(slot);
    drop(evicted);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warm_browser_expiry_respects_ttl_and_clock_monotonicity() {
        assert!(!is_warm_browser_expired(1_000, 1_500, WARM_BROWSER_IDLE_TIMEOUT_MS));
        assert!(!is_warm_browser_expired(
            1_000,
            1_000 + WARM_BROWSER_IDLE_TIMEOUT_MS - 1,
            WARM_BROWSER_IDLE_TIMEOUT_MS
        ));
        assert!(is_warm_browser_expired(
            1_000,
            1_000 + WARM_BROWSER_IDLE_TIMEOUT_MS,
            WARM_BROWSER_IDLE_TIMEOUT_MS
        ));
        // Clock skew backward should not panic or falsely expire immediately.
        assert!(!is_warm_browser_expired(2_000, 1_500, WARM_BROWSER_IDLE_TIMEOUT_MS));
    }

    #[test]
    fn error_hook_marks_aetheria_headless_flag() {
        assert!(ERROR_HOOK_SOURCE.contains("window.__aetheriaHeadless = true"));
    }
}
