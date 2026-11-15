//! Adobe Stock package builder (`output/microstock/adobe/<slug>/`) and F7 near-duplicate detector.

use super::adobe_profile::{
    AdobeProfile, RuleSeverity, URL_CSV, URL_DISTINCT, URL_GEN_AI_CONTENT, URL_LEGAL,
};
use super::loop_check::compare_images_psnr_ssim;
use super::manifest::{save_manifest, MicrostockManifest, PreflightItem};
use super::policy::{build_adobe_csv, build_metadata_txt, validate_metadata_and_filename};
use super::preflight::compute_file_sha256;
use crate::paths::{contains_path, locate_ffmpeg_binary, now_ms};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageBuildResult {
    pub package_dir: String,
    pub video_file: String,
    pub sha256: String,
    pub csv_path: String,
    pub txt_path: String,
    pub manifest_path: String,
    pub warnings: Vec<PreflightItem>,
}

fn extract_keyframe_png(ffmpeg_bin: &Path, video_path: &Path, out_png: &Path) -> bool {
    let mut cmd = std::process::Command::new(ffmpeg_bin);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let _ = cmd
        .args([
            "-y",
            "-hide_banner",
            "-ss",
            "1.0",
            "-i",
        ])
        .arg(video_path)
        .args(["-frames:v", "1", "-vf", "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2"])
        .arg(out_png)
        .output();
    out_png.is_file()
}

/// F7: Compares keyframe of `target_video` against existing packaged clips to warn on near-duplicates.
pub fn check_near_duplicate_packages(
    ws_root: &Path,
    project_dir: &Path,
    target_video: &Path,
    current_slug: &str,
    ssim_threshold: f64,
) -> Vec<PreflightItem> {
    let mut warnings = Vec::new();
    let Some(ffmpeg_bin) = locate_ffmpeg_binary() else {
        return warnings;
    };

    let mut search_roots = vec![project_dir.join("output").join("microstock").join("adobe")];
    let ws_adobe = ws_root.join("output").join("microstock").join("adobe");
    if ws_adobe != search_roots[0] {
        search_roots.push(ws_adobe);
    }
    let projects_dir = ws_root.join("projects");
    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for e in entries.flatten() {
            let p = e.path().join("output").join("microstock").join("adobe");
            if p.is_dir() && !search_roots.contains(&p) {
                search_roots.push(p);
            }
        }
    }

    let tmp_dir = std::env::temp_dir().join(format!("aetheria_dup_{}", now_ms()));
    let _ = std::fs::create_dir_all(&tmp_dir);
    let target_png = tmp_dir.join("target.png");
    if !extract_keyframe_png(&ffmpeg_bin, target_video, &target_png) {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return warnings;
    }

    for adobe_root in search_roots {
        let Ok(slug_entries) = std::fs::read_dir(&adobe_root) else {
            continue;
        };
        for slug_entry in slug_entries.flatten() {
            let slug_path = slug_entry.path();
            if !slug_path.is_dir() {
                continue;
            }
            let slug_name = slug_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if slug_name == current_slug {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&slug_path) else {
                continue;
            };
            for f in files.flatten() {
                let fp = f.path();
                let ext = fp
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "mp4" || ext == "mov" {
                    let other_png = tmp_dir.join(format!("other_{}.png", slug_name));
                    if extract_keyframe_png(&ffmpeg_bin, &fp, &other_png) {
                        if let Ok(sim) =
                            compare_images_psnr_ssim(&ffmpeg_bin, &target_png, &other_png)
                        {
                            if sim.ssim >= ssim_threshold {
                                warnings.push(PreflightItem {
                                    code: "NEAR_DUPLICATE".to_string(),
                                    severity: RuleSeverity::Warn,
                                    message: format!(
                                        "Clip keyframe is very similar to packaged clip '{}' (SSIM={:.4} >= {:.2}, PSNR={:.2}dB); Adobe Stock rejects near-identical variations.",
                                        slug_name, sim.ssim, ssim_threshold, sim.psnr_db
                                    ),
                                    source: URL_DISTINCT.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);
    warnings
}

pub fn build_adobe_package(
    profile: &AdobeProfile,
    ws_root: &Path,
    project_dir: &Path,
    slug: &str,
    manifest: &mut MicrostockManifest,
    ready_filename: Option<&str>,
) -> Result<PackageBuildResult, Vec<PreflightItem>> {
    let mut errors = Vec::new();

    if manifest.provenance.ai_declared.is_none() {
        errors.push(PreflightItem {
            code: "AI_DECLARATION_MISSING".to_string(),
            severity: RuleSeverity::Fail,
            message: "Cannot package: aiDeclared is unset.".to_string(),
            source: URL_GEN_AI_CONTENT.to_string(),
        });
    }
    if !manifest.checklist.is_complete() {
        errors.push(PreflightItem {
            code: "CHECKLIST_INCOMPLETE".to_string(),
            severity: RuleSeverity::Fail,
            message: "Cannot package: compliance checklist is incomplete.".to_string(),
            source: URL_LEGAL.to_string(),
        });
    }

    let ready_dir = project_dir.join("output").join("microstock").join("ready");
    let chosen_file = if let Some(explicit) = ready_filename.map(str::trim).filter(|s| !s.is_empty())
    {
        explicit.to_string()
    } else if let Some(last_ready) = manifest
        .renders
        .iter()
        .rev()
        .find(|r| r.preflight.promoted_to_ready)
    {
        last_ready.file.clone()
    } else {
        String::new()
    };

    let ready_video_path = ready_dir.join(&chosen_file);
    if chosen_file.is_empty() || !ready_video_path.is_file() {
        errors.push(PreflightItem {
            code: "CONTAINER_NOT_ALLOWED".to_string(),
            severity: RuleSeverity::Fail,
            message: format!(
                "No preflight-approved video found in ready/ (requested '{}'). Only files in ready/ can be packaged.",
                chosen_file
            ),
            source: URL_CSV.to_string(),
        });
    }

    let meta_errs = validate_metadata_and_filename(profile, &manifest.metadata, &chosen_file);
    errors.extend(meta_errs);

    if !errors.is_empty() {
        return Err(errors);
    }

    let csv_content =
        build_adobe_csv(profile, &[(chosen_file.clone(), manifest.metadata.clone())])
            .map_err(|e| vec![e])?;
    let txt_content = build_metadata_txt(profile, &chosen_file, manifest);

    let safe_slug: String = slug
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let pkg_slug = if safe_slug.is_empty() {
        "adobe-clip"
    } else {
        &safe_slug
    };

    let package_dir = project_dir
        .join("output")
        .join("microstock")
        .join("adobe")
        .join(pkg_slug);
    if !contains_path(ws_root, &package_dir) {
        return Err(vec![PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: "Access Denied: package directory escapes workspace.".to_string(),
            source: URL_CSV.to_string(),
        }]);
    }
    let _ = std::fs::create_dir_all(&package_dir);

    let packaged_video = package_dir.join(&chosen_file);
    std::fs::copy(&ready_video_path, &packaged_video).map_err(|e| {
        vec![PreflightItem {
            code: "METADATA_INVALID".to_string(),
            severity: RuleSeverity::Fail,
            message: format!("Failed copying video from ready/ to package: {}", e),
            source: URL_CSV.to_string(),
        }]
    })?;

    let sha256 = compute_file_sha256(&packaged_video).unwrap_or_default();
    if let Some(rec) = manifest.renders.iter_mut().find(|r| r.file == chosen_file) {
        rec.sha256 = sha256.clone();
    }
    let _ = save_manifest(ws_root, project_dir, manifest);

    let csv_path = package_dir.join("metadata.csv");
    let txt_path = package_dir.join("metadata.txt");
    let pkg_manifest_path = package_dir.join("manifest.json");

    let _ = std::fs::write(&csv_path, &csv_content);
    let _ = std::fs::write(&txt_path, &txt_content);
    if let Ok(m_json) = serde_json::to_string_pretty(manifest) {
        let _ = std::fs::write(&pkg_manifest_path, m_json);
    }

    let mut warnings =
        check_near_duplicate_packages(ws_root, project_dir, &packaged_video, pkg_slug, 0.94);
    warnings.push(PreflightItem {
        code: "CSV_VIDEO_UNCONFIRMED".to_string(),
        severity: RuleSeverity::Info,
        message: "CSV belum terkonfirmasi untuk video; label AI diatur di portal.".to_string(),
        source: URL_CSV.to_string(),
    });
    if manifest.provenance.ai_declared == Some(true) {
        warnings.push(PreflightItem {
            code: "AI_LABEL_REQUIRED".to_string(),
            severity: RuleSeverity::Info,
            message: format!(
                "Centang '{}' di Adobe Stock Contributor Portal.",
                profile.ai_portal_checkbox_label.value
            ),
            source: URL_GEN_AI_CONTENT.to_string(),
        });
    }

    Ok(PackageBuildResult {
        package_dir: package_dir.to_string_lossy().to_string(),
        video_file: packaged_video.to_string_lossy().to_string(),
        sha256,
        csv_path: csv_path.to_string_lossy().to_string(),
        txt_path: txt_path.to_string_lossy().to_string(),
        manifest_path: pkg_manifest_path.to_string_lossy().to_string(),
        warnings,
    })
}
