use std::path::Path;
use tauri::Manager;
use veluna_core::offline::{OfflineEntry, OfflineResolved, OfflineStore};

fn store_for(app: &tauri::AppHandle) -> Result<OfflineStore, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(OfflineStore::new(dir))
}

fn allow_entry_files(app: &tauri::AppHandle, store: &OfflineStore, entry: &OfflineEntry) {
    let scope = app.asset_protocol_scope();
    if let Some(safe_audio) = super::stream_server::safe_contained_path(store.dir(), Path::new(&entry.audio_path)) {
        let _ = scope.allow_file(&safe_audio);
    }
    if let Some(cover) = entry.cover_path.as_deref() {
        if let Some(safe_cover) = super::stream_server::safe_contained_path(store.dir(), Path::new(cover)) {
            let _ = scope.allow_file(&safe_cover);
        }
    }
}

#[tauri::command]
pub fn offline_list(app: tauri::AppHandle) -> Result<Vec<OfflineEntry>, String> {
    let store = store_for(&app)?;
    let entries = store.list()?;
    for entry in &entries {
        allow_entry_files(&app, &store, entry);
    }
    Ok(entries)
}

#[tauri::command]
pub async fn offline_download(
    app: tauri::AppHandle,
    video_id: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    thumbnail: Option<String>,
    lyrics: Option<String>,
) -> Result<OfflineEntry, String> {
    let store = store_for(&app)?;
    let entry = store
        .download_track(
            &video_id,
            title.as_deref(),
            artist.as_deref(),
            album.as_deref(),
            thumbnail.as_deref(),
            lyrics.as_deref(),
        )
        .await?;
    allow_entry_files(&app, &store, &entry);
    Ok(entry)
}

#[tauri::command]
pub fn offline_delete(app: tauri::AppHandle, video_id: String) -> Result<bool, String> {
    store_for(&app)?.delete(&video_id)
}

#[tauri::command]
pub fn offline_resolve(
    app: tauri::AppHandle,
    video_id: String,
) -> Result<Option<OfflineResolved>, String> {
    let store = store_for(&app)?;
    let resolved = store.resolve(&video_id)?;
    if let Some(ref item) = resolved {
        allow_entry_files(&app, &store, &item.entry);
    }
    Ok(resolved)
}
