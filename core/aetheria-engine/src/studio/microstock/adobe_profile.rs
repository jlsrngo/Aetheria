//! Adobe Stock technical, content, generative AI, and metadata profile data (checked 2026-11-15).

use serde::{Deserialize, Serialize};

pub const CHECKED_AT: &str = "2026-11-15";

pub const URL_TECHNICAL: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-videos/technical-requirements-for-video-submissions.html";
pub const URL_REFUSAL: &str = "https://helpx.adobe.com/stock/contributor/content-moderation/common-reasons-content-refusal.html";
pub const URL_BEST_PRACTICES: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-videos/video-creation-best-practices.html";
pub const URL_SUBMIT_VIDEOS: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-videos/submit-videos.html";
pub const URL_LEGAL: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-videos/legal-requirements-for-video-submissions.html";
pub const URL_DISTINCT: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-distinct-content/distinct-video-submission-best-practices.html";
pub const URL_GEN_AI_VIDEO: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/generative-ai-video-submission-guidelines.html";
pub const URL_GEN_AI_CONTENT: &str = "https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/generative-ai-content-guidelines.html";
pub const URL_TITLES_KEYWORDS: &str = "https://helpx.adobe.com/stock/contributor/help/titles-and-keyword";
pub const URL_CSV: &str = "https://helpx.adobe.com/stock/contributor/manage-your-portfolio/csv-requirements-content.html";
pub const URL_CATEGORIES: &str = "https://helpx.adobe.com/stock/contributor/content-policies-guidelines/metadata/choose-right-category-content.html";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleSeverity {
    Fail,
    Warn,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdobeRule<T> {
    pub id: String,
    pub value: T,
    pub source_url: String,
    pub checked_at: String,
    pub severity: RuleSeverity,
}

impl<T> AdobeRule<T> {
    pub fn new(id: &str, value: T, source_url: &str, severity: RuleSeverity) -> Self {
        Self {
            id: id.to_string(),
            value,
            source_url: source_url.to_string(),
            checked_at: CHECKED_AT.to_string(),
            severity,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionSpec {
    pub width: u32,
    pub height: u32,
    pub ratio: String,
    pub orientation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdobePreset {
    pub id: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub ratio: String,
    pub default_fps: u32,
    pub default_codec: String,
    pub container: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdobeUnknownItem {
    pub key: String,
    pub status: String,
    pub note: String,
    pub source_url: String,
    pub checked_at: String,
    pub severity: RuleSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdobeProfile {
    pub checked_at: String,
    pub motion_graphics_notice: String,
    pub ai_portal_checkbox_label: AdobeRule<String>,
    pub ai_portal_video_page_label: AdobeRule<String>,
    pub containers: AdobeRule<Vec<String>>,
    pub codecs: AdobeRule<Vec<String>>,
    pub allowed_fps: AdobeRule<Vec<u32>>,
    pub documented_fps: AdobeRule<Vec<String>>,
    pub duration_sec_range: AdobeRule<(u32, u32)>,
    pub max_file_size_mb: AdobeRule<u64>,
    pub max_filename_chars: AdobeRule<usize>,
    pub max_title_chars: AdobeRule<usize>,
    pub keyword_count_range: AdobeRule<(usize, usize)>,
    pub csv_headers_required: AdobeRule<Vec<String>>,
    pub csv_headers_optional: AdobeRule<Vec<String>>,
    pub csv_max_rows: AdobeRule<usize>,
    pub csv_max_size_bytes: AdobeRule<u64>,
    pub no_audio_required: AdobeRule<bool>,
    pub no_text_overlays: AdobeRule<bool>,
    pub no_upscaling: AdobeRule<bool>,
    pub no_logos_or_trademarks: AdobeRule<bool>,
    pub presets: Vec<AdobePreset>,
    pub preflight_whitelist_resolutions: AdobeRule<Vec<ResolutionSpec>>,
    pub categories: AdobeRule<Vec<String>>,
    pub banned_brand_terms: AdobeRule<Vec<String>>,
    pub unknowns: Vec<AdobeUnknownItem>,
}

impl AdobeProfile {
    pub fn default_profile() -> Self {
        let presets = vec![
            AdobePreset {
                id: "1920x1080".to_string(),
                label: "1080p Full HD Landscape (1920×1080)".to_string(),
                width: 1920,
                height: 1080,
                ratio: "16:9".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
            AdobePreset {
                id: "3840x2160".to_string(),
                label: "4K UHD Landscape (3840×2160)".to_string(),
                width: 3840,
                height: 2160,
                ratio: "16:9".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
            AdobePreset {
                id: "1080x1920".to_string(),
                label: "1080p Vertical (1080×1920)".to_string(),
                width: 1080,
                height: 1920,
                ratio: "9:16".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
            AdobePreset {
                id: "2160x3840".to_string(),
                label: "4K UHD Vertical (2160×3840)".to_string(),
                width: 2160,
                height: 3840,
                ratio: "9:16".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
            AdobePreset {
                id: "1080x1080".to_string(),
                label: "1080p Square (1080×1080)".to_string(),
                width: 1080,
                height: 1080,
                ratio: "1:1".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
            AdobePreset {
                id: "2160x2160".to_string(),
                label: "4K Square (2160×2160)".to_string(),
                width: 2160,
                height: 2160,
                ratio: "1:1".to_string(),
                default_fps: 30,
                default_codec: "h264".to_string(),
                container: "mp4".to_string(),
            },
        ];

        let whitelist_res = vec![
            ResolutionSpec { width: 1920, height: 1080, ratio: "16:9".into(), orientation: "landscape".into() },
            ResolutionSpec { width: 2048, height: 1080, ratio: "17:9".into(), orientation: "landscape".into() },
            ResolutionSpec { width: 3840, height: 2160, ratio: "16:9".into(), orientation: "landscape".into() },
            ResolutionSpec { width: 4096, height: 2160, ratio: "17:9".into(), orientation: "landscape".into() },
            ResolutionSpec { width: 4096, height: 2304, ratio: "16:9".into(), orientation: "landscape".into() },
            ResolutionSpec { width: 2304, height: 4096, ratio: "9:16".into(), orientation: "vertical".into() },
            ResolutionSpec { width: 2160, height: 4096, ratio: "9:17".into(), orientation: "vertical".into() },
            ResolutionSpec { width: 2160, height: 3840, ratio: "9:16".into(), orientation: "vertical".into() },
            ResolutionSpec { width: 1080, height: 1920, ratio: "9:16".into(), orientation: "vertical".into() },
            ResolutionSpec { width: 1080, height: 1080, ratio: "1:1".into(), orientation: "square".into() },
            ResolutionSpec { width: 2160, height: 2160, ratio: "1:1".into(), orientation: "square".into() },
        ];

        let categories = vec![
            "Animals",
            "Buildings and architecture",
            "Business",
            "Drinks",
            "The environment",
            "States of mind",
            "Food",
            "Graphic resources",
            "Hobbies and leisure",
            "Industry",
            "Landscape",
            "Lifestyle",
            "People",
            "Plants and flowers",
            "Culture and religion",
            "Science",
            "Social issues",
            "Sports",
            "Technology",
            "Transport",
            "Travel",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let banned_brands = vec![
            "adobe", "apple", "iphone", "ipad", "macbook", "microsoft", "windows", "google",
            "youtube", "tiktok", "instagram", "facebook", "meta", "netflix", "disney", "marvel",
            "pixar", "nike", "adidas", "tesla", "cocacola", "pepsi", "samsung", "sony",
            "playstation", "xbox", "nintendo", "midjourney", "sora", "runway",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let unknowns = vec![
            AdobeUnknownItem {
                key: "MOTION_GRAPHICS_RULES_UNKNOWN".to_string(),
                status: "unknown".to_string(),
                note: "Halaman Adobe tidak menjelaskan aturan khusus motion graphics. Uji unggah manual 1–2 aset dulu sebelum produksi massal.".to_string(),
                source_url: URL_TECHNICAL.to_string(),
                checked_at: CHECKED_AT.to_string(),
                severity: RuleSeverity::Info,
            },
            AdobeUnknownItem {
                key: "CSV_VIDEO_UNCONFIRMED".to_string(),
                status: "unknown".to_string(),
                note: "CSV belum terkonfirmasi untuk video (contoh .mov ada, tetapi tidak ditegaskan); label AI diatur di portal.".to_string(),
                source_url: URL_CSV.to_string(),
                checked_at: CHECKED_AT.to_string(),
                severity: RuleSeverity::Info,
            },
            AdobeUnknownItem {
                key: "AI_CODE_ASSISTED_LABELING_UNKNOWN".to_string(),
                status: "unknown".to_string(),
                note: "Halaman Adobe tidak mendefinisikan apakah motion graphic yang kodenya ditulis LLM wajib berlabel AI; konfirmasi ke dukungan Adobe.".to_string(),
                source_url: URL_GEN_AI_CONTENT.to_string(),
                checked_at: CHECKED_AT.to_string(),
                severity: RuleSeverity::Info,
            },
            AdobeUnknownItem {
                key: "SIMILARITY_NUMERIC_THRESHOLD_UNKNOWN".to_string(),
                status: "unknown".to_string(),
                note: "Adobe melarang klip yang terlalu mirip tetapi tidak mencantumkan angka ambang PSNR/SSIM.".to_string(),
                source_url: URL_DISTINCT.to_string(),
                checked_at: CHECKED_AT.to_string(),
                severity: RuleSeverity::Info,
            },
        ];

        Self {
            checked_at: CHECKED_AT.to_string(),
            motion_graphics_notice: "Halaman Adobe tidak menjelaskan aturan khusus motion graphics. Uji unggah manual 1–2 aset dulu sebelum produksi massal.".to_string(),
            ai_portal_checkbox_label: AdobeRule::new(
                "ai_portal_checkbox_label",
                "Created using generative AI tools".to_string(),
                URL_GEN_AI_CONTENT,
                RuleSeverity::Info,
            ),
            ai_portal_video_page_label: AdobeRule::new(
                "ai_portal_video_page_label",
                "Created using generative AI".to_string(),
                URL_GEN_AI_VIDEO,
                RuleSeverity::Info,
            ),
            containers: AdobeRule::new(
                "containers",
                vec!["mp4".to_string(), "mov".to_string()],
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            codecs: AdobeRule::new(
                "codecs",
                vec!["h264".to_string(), "prores".to_string()],
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            allowed_fps: AdobeRule::new(
                "allowed_fps",
                vec![24, 25, 30, 50, 60],
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            documented_fps: AdobeRule::new(
                "documented_fps",
                vec!["23.98", "24", "25", "29.97", "30", "50", "59.94", "60"]
                    .into_iter()
                    .map(String::from)
                    .collect(),
                URL_TECHNICAL,
                RuleSeverity::Info,
            ),
            duration_sec_range: AdobeRule::new(
                "duration_sec_range",
                (5, 60),
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            max_file_size_mb: AdobeRule::new(
                "max_file_size_mb",
                3900,
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            max_filename_chars: AdobeRule::new(
                "max_filename_chars",
                30,
                URL_CSV,
                RuleSeverity::Fail,
            ),
            max_title_chars: AdobeRule::new(
                "max_title_chars",
                70,
                URL_TITLES_KEYWORDS,
                RuleSeverity::Fail,
            ),
            keyword_count_range: AdobeRule::new(
                "keyword_count_range",
                (5, 49),
                URL_TITLES_KEYWORDS,
                RuleSeverity::Fail,
            ),
            csv_headers_required: AdobeRule::new(
                "csv_headers_required",
                vec!["Filename".to_string(), "Title".to_string(), "Keywords".to_string()],
                URL_CSV,
                RuleSeverity::Fail,
            ),
            csv_headers_optional: AdobeRule::new(
                "csv_headers_optional",
                vec!["Category".to_string(), "Releases".to_string()],
                URL_CSV,
                RuleSeverity::Info,
            ),
            csv_max_rows: AdobeRule::new("csv_max_rows", 5000, URL_CSV, RuleSeverity::Fail),
            csv_max_size_bytes: AdobeRule::new(
                "csv_max_size_bytes",
                1_000_000,
                URL_CSV,
                RuleSeverity::Fail,
            ),
            no_audio_required: AdobeRule::new(
                "no_audio_required",
                true,
                URL_SUBMIT_VIDEOS,
                RuleSeverity::Fail,
            ),
            no_text_overlays: AdobeRule::new(
                "no_text_overlays",
                true,
                URL_BEST_PRACTICES,
                RuleSeverity::Warn,
            ),
            no_upscaling: AdobeRule::new("no_upscaling", true, URL_REFUSAL, RuleSeverity::Fail),
            no_logos_or_trademarks: AdobeRule::new(
                "no_logos_or_trademarks",
                true,
                URL_LEGAL,
                RuleSeverity::Fail,
            ),
            presets,
            preflight_whitelist_resolutions: AdobeRule::new(
                "preflight_whitelist_resolutions",
                whitelist_res,
                URL_TECHNICAL,
                RuleSeverity::Fail,
            ),
            categories: AdobeRule::new("categories", categories, URL_CATEGORIES, RuleSeverity::Info),
            banned_brand_terms: AdobeRule::new(
                "banned_brand_terms",
                banned_brands,
                URL_LEGAL,
                RuleSeverity::Fail,
            ),
            unknowns,
        }
    }

    pub fn find_preset(&self, preset_id: &str) -> Option<&AdobePreset> {
        let norm = preset_id.trim().to_ascii_lowercase();
        self.presets.iter().find(|p| p.id.to_ascii_lowercase() == norm)
    }

    pub fn is_whitelisted_resolution(&self, width: u32, height: u32) -> bool {
        self.preflight_whitelist_resolutions
            .value
            .iter()
            .any(|r| r.width == width && r.height == height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_profile_rule_has_source_url_and_checked_at() {
        let p = AdobeProfile::default_profile();
        let rules: Vec<(&str, &str)> = vec![
            (&p.ai_portal_checkbox_label.source_url, &p.ai_portal_checkbox_label.checked_at),
            (&p.ai_portal_video_page_label.source_url, &p.ai_portal_video_page_label.checked_at),
            (&p.containers.source_url, &p.containers.checked_at),
            (&p.codecs.source_url, &p.codecs.checked_at),
            (&p.allowed_fps.source_url, &p.allowed_fps.checked_at),
            (&p.documented_fps.source_url, &p.documented_fps.checked_at),
            (&p.duration_sec_range.source_url, &p.duration_sec_range.checked_at),
            (&p.max_file_size_mb.source_url, &p.max_file_size_mb.checked_at),
            (&p.max_filename_chars.source_url, &p.max_filename_chars.checked_at),
            (&p.max_title_chars.source_url, &p.max_title_chars.checked_at),
            (&p.keyword_count_range.source_url, &p.keyword_count_range.checked_at),
            (&p.csv_headers_required.source_url, &p.csv_headers_required.checked_at),
            (&p.csv_headers_optional.source_url, &p.csv_headers_optional.checked_at),
            (&p.csv_max_rows.source_url, &p.csv_max_rows.checked_at),
            (&p.csv_max_size_bytes.source_url, &p.csv_max_size_bytes.checked_at),
            (&p.no_audio_required.source_url, &p.no_audio_required.checked_at),
            (&p.no_text_overlays.source_url, &p.no_text_overlays.checked_at),
            (&p.no_upscaling.source_url, &p.no_upscaling.checked_at),
            (&p.no_logos_or_trademarks.source_url, &p.no_logos_or_trademarks.checked_at),
            (
                &p.preflight_whitelist_resolutions.source_url,
                &p.preflight_whitelist_resolutions.checked_at,
            ),
            (&p.categories.source_url, &p.categories.checked_at),
            (&p.banned_brand_terms.source_url, &p.banned_brand_terms.checked_at),
        ];

        for (url, dt) in rules {
            assert!(url.starts_with("https://helpx.adobe.com/"), "invalid url: {url}");
            assert_eq!(dt, "2026-11-15");
        }
        for u in &p.unknowns {
            assert_eq!(u.status, "unknown");
            assert!(u.source_url.starts_with("https://helpx.adobe.com/"));
            assert_eq!(u.checked_at, "2026-11-15");
        }
        assert_eq!(p.presets.len(), 6);
        assert_eq!(p.categories.value.len(), 21);
    }
}
