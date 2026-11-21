//! External binary discovery helpers for headless Chromium (Edge/Chrome) and FFmpeg.

use crate::paths::{aetheria_dot_dir, home_dir, project_root};
use std::path::PathBuf;

/// Collects candidate Windows `AppData\Local` directories, including fallbacks via `APPDATA`
/// and `USERNAME` so isolated test harnesses that override `LOCALAPPDATA` still locate
/// host-installed FFmpeg and Chromium binaries.
fn windows_local_appdata_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut push_unique = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !dirs.contains(&p) {
            dirs.push(p);
        }
    };
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        let trimmed = local_app.trim();
        if !trimmed.is_empty() {
            push_unique(PathBuf::from(trimmed));
        }
    }
    if let Ok(roaming) = std::env::var("APPDATA") {
        let trimmed = roaming.trim();
        if !trimmed.is_empty() {
            if let Some(parent) = PathBuf::from(trimmed).parent() {
                push_unique(parent.join("Local"));
            }
        }
    }
    if let Ok(username) = std::env::var("USERNAME") {
        let user_trimmed = username.trim();
        if !user_trimmed.is_empty() {
            let sys_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
            push_unique(
                PathBuf::from(format!("{}\\", sys_drive.trim_end_matches('\\')))
                    .join("Users")
                    .join(user_trimmed)
                    .join("AppData")
                    .join("Local"),
            );
        }
    }
    dirs
}

/// Builds candidate browser executable paths preferring Google Chrome across all roots
/// before falling back to Microsoft Edge so installed Edge does not shadow faster Chrome.
fn browser_candidate_paths(program_files: &[PathBuf], local_app_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let browsers = [
        ("Google", "Chrome", "chrome.exe"),
        ("Microsoft", "Edge", "msedge.exe"),
    ];
    let mut candidates = Vec::new();
    for (vendor, product, exe) in browsers {
        for root in program_files {
            candidates.push(root.join(vendor).join(product).join("Application").join(exe));
        }
        for local in local_app_dirs {
            candidates.push(local.join(vendor).join(product).join("Application").join(exe));
        }
    }
    candidates
}

/// Finds a Chromium build (Chrome preferred, Edge fallback) the headless CDP exporter can drive.
/// Supports `AETHERIA_BROWSER` explicit override; Chrome avoids ~7x `--headless=new` capture stalls seen on Edge.
pub fn detect_browser_executable() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("AETHERIA_BROWSER") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    let program_files: Vec<PathBuf> = ["PROGRAMFILES", "PROGRAMFILES(X86)"]
        .into_iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from)
        })
        .collect();
    let local_app_dirs = windows_local_appdata_dirs();

    browser_candidate_paths(&program_files, &local_app_dirs)
        .into_iter()
        .find(|path| path.is_file())
}

/// Locates an `ffmpeg` executable without relying on Node.js.
/// Checks `AETHERIA_FFMPEG`, `PATH`, user `.aetheria/bin`, repo/app `bin/`, and common Windows installs.
pub fn locate_ffmpeg_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("AETHERIA_FFMPEG") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    let bin_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Some(path_os) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_os) {
            let candidate = dir.join(bin_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let root = project_root();
    let mut fixed = vec![
        aetheria_dot_dir().join("bin").join(bin_name),
        root.join("bin").join(bin_name),
        root.join(bin_name),
    ];

    if cfg!(windows) {
        for local in windows_local_appdata_dirs() {
            fixed.push(local.join("Microsoft").join("WinGet").join("Links").join("ffmpeg.exe"));
            let winget_pkgs = local.join("Microsoft").join("WinGet").join("Packages");
            if let Ok(pkgs) = std::fs::read_dir(&winget_pkgs) {
                for pkg in pkgs.flatten() {
                    let pkg_name = pkg.file_name().to_string_lossy().to_lowercase();
                    if pkg_name.contains("ffmpeg") {
                        let direct = pkg.path().join("bin").join("ffmpeg.exe");
                        if direct.is_file() {
                            fixed.push(direct);
                        }
                        if let Ok(subs) = std::fs::read_dir(pkg.path()) {
                            for sub in subs.flatten() {
                                let nested = sub.path().join("bin").join("ffmpeg.exe");
                                if nested.is_file() {
                                    fixed.push(nested);
                                }
                            }
                        }
                    }
                }
            }
            let capcut_apps = local.join("CapCut").join("Apps");
            if let Ok(entries) = std::fs::read_dir(&capcut_apps) {
                let mut capcut_bins: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path().join("ffmpeg.exe"))
                    .filter(|p| p.is_file())
                    .collect();
                capcut_bins.sort();
                capcut_bins.reverse();
                fixed.extend(capcut_bins);
            }
            let npx_cache = local.join("npm-cache").join("_npx");
            if let Ok(entries) = std::fs::read_dir(&npx_cache) {
                for entry in entries.flatten() {
                    let remotion_ff = entry
                        .path()
                        .join("node_modules")
                        .join("@remotion")
                        .join("compositor-win32-x64-msvc")
                        .join("ffmpeg.exe");
                    if remotion_ff.is_file() {
                        fixed.push(remotion_ff);
                    }
                }
            }
        }
        let user = home_dir();
        fixed.push(user.join("scoop").join("shims").join("ffmpeg.exe"));
        fixed.push(PathBuf::from("C:\\ffmpeg\\bin\\ffmpeg.exe"));
    }

    fixed.into_iter().find(|p| p.is_file())
}

fn find_executable_in_path_or_dirs(names: &[&str], extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    if let Some(path_os) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_os) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    for dir in extra_dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Locates Python executable with preference for explicit `AETHERIA_PYTHON`,
/// workspace/user virtual environments (`.venv`), then `PATH`.
pub fn locate_python_binary() -> PathBuf {
    if let Ok(explicit) = std::env::var("AETHERIA_PYTHON") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                return p;
            }
        }
    }

    let root = project_root();
    let dot_dir = aetheria_dot_dir();
    let venv_candidates = if cfg!(windows) {
        [
            root.join(".venv").join("Scripts").join("python.exe"),
            dot_dir.join("venv").join("Scripts").join("python.exe"),
            dot_dir.join(".venv").join("Scripts").join("python.exe"),
        ]
    } else {
        [
            root.join(".venv").join("bin").join("python"),
            dot_dir.join("venv").join("bin").join("python"),
            dot_dir.join(".venv").join("bin").join("python"),
        ]
    };
    if let Some(found) = venv_candidates.into_iter().find(|p| p.is_file()) {
        return found;
    }

    let names: &[&str] = if cfg!(windows) {
        &["python.exe", "python3.exe"]
    } else {
        &["python3", "python"]
    };
    find_executable_in_path_or_dirs(names, &[dot_dir.join("bin"), root.join("bin")])
        .unwrap_or_else(|| PathBuf::from("python"))
}

/// Locates `yt-dlp` binary when installed for downloading full reference videos (e.g. YouTube).
pub fn locate_ytdlp_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("AETHERIA_YTDLP") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let root = project_root();
    let names: &[&str] = if cfg!(windows) {
        &["yt-dlp.exe", "yt-dlp"]
    } else {
        &["yt-dlp"]
    };
    find_executable_in_path_or_dirs(
        names,
        &[aetheria_dot_dir().join("bin"), root.join("bin"), root.clone()],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_candidate_paths_prefers_chrome_across_all_roots_over_edge() {
        let pf = vec![
            PathBuf::from("C:\\Program Files"),
            PathBuf::from("C:\\Program Files (x86)"),
        ];
        let local = vec![PathBuf::from("C:\\Users\\Test\\AppData\\Local")];
        let paths = browser_candidate_paths(&pf, &local);
        let chrome_local_idx = paths
            .iter()
            .position(|p| {
                p == &PathBuf::from("C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe")
            })
            .expect("chrome local path");
        let edge_pf_idx = paths
            .iter()
            .position(|p| p == &PathBuf::from("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"))
            .expect("edge pf path");
        assert!(chrome_local_idx < edge_pf_idx);
    }

    #[test]
    fn test_detect_browser_returns_existing_file() {
        if let Some(path) = detect_browser_executable() {
            assert!(
                path.is_file(),
                "detected browser {} does not exist",
                path.display()
            );
        }
    }
}

