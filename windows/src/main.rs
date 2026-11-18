#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Manager;

const REPO: &str = "https://github.com/siloneedsleep/VelunaMusic";
const INSTALLER: &str = "VelunaMusic-Windows-x64.exe";
#[derive(Serialize, Deserialize)]
struct Track {
    id: String,
    title: String,
}

fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("library.json"))
}
fn open_track(app: &tauri::AppHandle, path: PathBuf) -> Option<Track> {
    if !path.is_file() {
        return None;
    }
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !["mp3", "flac", "wav", "m4a", "ogg", "aac", "opus"].contains(&extension.as_str()) {
        return None;
    }
    app.asset_protocol_scope().allow_file(&path).ok()?;
    Some(Track {
        title: path.file_stem()?.to_string_lossy().into_owned(),
        id: path.to_string_lossy().into_owned(),
    })
}
#[tauri::command]
fn library(app: tauri::AppHandle) -> Result<Vec<Track>, String> {
    let index = library_path(&app)?;
    if !index.exists() {
        return Ok(vec![]);
    }
    let paths: Vec<PathBuf> =
        serde_json::from_slice(&std::fs::read(index).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    Ok(paths
        .into_iter()
        .filter_map(|p| open_track(&app, p))
        .collect())
}
#[tauri::command]
async fn add_music(app: tauri::AppHandle) -> Result<Vec<Track>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .add_filter(
            "Audio",
            &["mp3", "flac", "wav", "m4a", "ogg", "aac", "opus"],
        )
        .pick_files()
        .await;
    let mut tracks = library(app.clone())?;
    for item in picked.into_iter().flatten() {
        if let Some(t) = open_track(&app, item.path().to_owned()) {
            if !tracks.iter().any(|other| other.id == t.id) {
                tracks.push(t);
            }
        }
    }
    let index = library_path(&app)?;
    let temp = index.with_extension("tmp");
    let data = serde_json::to_vec(&tracks.iter().map(|t| &t.id).collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    std::fs::write(&temp, data)
        .and_then(|_| std::fs::rename(temp, index))
        .map_err(|e| e.to_string())?;
    Ok(tracks)
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}
async fn update() -> Result<Option<(String, Asset)>, String> {
    let http = reqwest::Client::builder()
        .user_agent("VelunaMusic")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let res = http
        .get("https://api.github.com/repos/siloneedsleep/VelunaMusic/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let release: Release = res
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if release.draft
        || release.prerelease
        || !veluna_core::newer_release(env!("CARGO_PKG_VERSION"), &release.tag_name)
    {
        return Ok(None);
    }
    let url = format!("{REPO}/releases/download/{}/{INSTALLER}", release.tag_name);
    let asset = release
        .assets
        .into_iter()
        .find(|a| {
            a.name == INSTALLER
                && a.browser_download_url == url
                && a.digest
                    .as_ref()
                    .is_some_and(|d| d.starts_with("sha256:") && d.len() == 71)
                && a.size > 0
                && a.size <= 256 * 1024 * 1024
        })
        .ok_or("Missing verified Windows installer")?;
    Ok(Some((release.tag_name, asset)))
}
#[tauri::command]
async fn check_update() -> Result<Option<String>, String> {
    Ok(update().await?.map(|(v, _)| v))
}
#[tauri::command]
async fn install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let (tag, asset) = update().await?.ok_or("No update available")?;
    if tag != version {
        return Err("Release changed. Please check again.".into());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("VelunaMusic-{tag}.exe"));
    let mut res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut content = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if content.len() as u64 + chunk.len() as u64 > asset.size {
            return Err("Invalid download length".into());
        }
        content.extend_from_slice(&chunk);
    }
    if content.len() as u64 != asset.size
        || Some(format!("sha256:{:x}", Sha256::digest(&content))) != asset.digest
    {
        return Err("Installer verification failed".into());
    }
    std::fs::write(&file, content).map_err(|e| e.to_string())?;
    std::process::Command::new(file)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            library,
            add_music,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("VelunaMusic startup failed");
}
