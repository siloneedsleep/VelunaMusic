#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod nearby;
mod vault;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

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
async fn analyze_audio(
    app: tauri::AppHandle,
    id: String,
) -> Result<veluna_core::dj::Analysis, String> {
    if !library(app)?.iter().any(|track| track.id == id) {
        return Err("Track is missing from this library".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        veluna_core::dj::analyze(std::fs::File::open(id).map_err(|e| e.to_string())?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn track_digest(app: tauri::AppHandle, id: String) -> Result<String, String> {
    if !library(app)?.iter().any(|track| track.id == id) {
        return Err("Track is missing from this library".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(id).map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        std::io::copy(&mut file, &mut digest).map_err(|e| e.to_string())?;
        Ok(format!("{:x}", digest.finalize()))
    })
    .await
    .map_err(|e| e.to_string())?
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
    let paths = picked.into_iter().flatten().map(|f| f.path().to_owned());
    import_paths(&app, paths).map(|(library, _)| library)
}

#[tauri::command]
async fn pick_album(app: tauri::AppHandle) -> Result<(Vec<Track>, Vec<String>), String> {
    let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok((library(app)?, vec![]));
    };
    let mut files = std::fs::read_dir(folder.path())
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    files.sort();
    import_paths(&app, files)
}

fn import_paths(
    app: &tauri::AppHandle,
    paths: impl IntoIterator<Item = PathBuf>,
) -> Result<(Vec<Track>, Vec<String>), String> {
    static WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITER.lock().map_err(|_| "Could not lock library")?;
    let mut tracks = library(app.clone())?;
    let mut ids = Vec::new();
    for path in paths {
        if let Some(t) = open_track(app, path) {
            ids.push(t.id.clone());
            if !tracks.iter().any(|other| other.id == t.id) {
                tracks.push(t);
            }
        }
    }
    let index = library_path(app)?;
    let temp = index.with_extension("tmp");
    let data = serde_json::to_vec(&tracks.iter().map(|t| &t.id).collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    std::fs::write(&temp, data)
        .and_then(|_| std::fs::rename(temp, index))
        .map_err(|e| e.to_string())?;
    Ok((tracks, ids))
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
#[tauri::command]
async fn open_youtube(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id.len() != 11
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid YouTube video".into());
    }
    let url: tauri::Url = format!("https://veluna.siloneedsleep.xyz/watch?v={id}")
        .parse()
        .map_err(|_| "Invalid player URL")?;
    if let Some(window) = app.get_webview_window("youtube") {
        window.navigate(url).map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(&app, "youtube", tauri::WebviewUrl::External(url))
        .title("YouTube · VelunaMusic")
        .inner_size(860.0, 620.0)
        .min_inner_size(360.0, 300.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_spotify(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return Err("Invalid Spotify URL".into());
    }
    match (parsed.host_str(), parsed.path()) {
        (Some("accounts.spotify.com"), "/authorize") => {
            #[cfg(debug_assertions)]
            app.deep_link().register_all().map_err(|e| e.to_string())?;
            let _ = app;
        }
        (Some("open.spotify.com"), _) | (Some("www.spotify.com"), "/account/apps/") => (),
        _ => return Err("Unsupported Spotify URL".into()),
    }
    open::that_detached(parsed.as_str()).map_err(|e| e.to_string())
}
#[tauri::command]
fn spotify_callback(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .deep_link()
        .get_current()
        .map_err(|e| e.to_string())?
        .unwrap_or_default()
        .into_iter()
        .find(|url| {
            url.scheme() == "velunamusic"
                && url.host_str() == Some("spotify")
                && url.path() == "/callback"
        })
        .map(String::from))
}
fn main() {
    tauri::Builder::default()
        .manage(nearby::Nearby::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_| {
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.eval("window.dispatchEvent(new Event('spotify-return'))");
                }
            });
            Ok(())
        })
        .invoke_handler({
            let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                library,
                add_music,
                pick_album,
                track_digest,
                nearby::nearby_interfaces,
                nearby::nearby_start,
                nearby::nearby_stop,
                nearby::nearby_decide,
                nearby::nearby_forget,
                open_spotify,
                open_youtube,
                spotify_callback,
                analyze_audio,
                vault::read_secret,
                vault::write_secret,
                check_update,
                install_update
            ];
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                let view = invoke.message.webview_ref();
                let local = view.url().is_ok_and(|url| {
                    matches!(
                        (url.scheme(), url.host_str()),
                        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
                    )
                });
                if view.label() != "main" || !local {
                    invoke.resolver.reject("Commands require the local player.");
                    return true;
                }
                commands(invoke)
            }
        })
        .run(tauri::generate_context!())
        .expect("VelunaMusic startup failed");
}
