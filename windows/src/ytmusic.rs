use veluna_core::ytmusic::{
    models::{
        AlbumDetail, ArtistDetail, LyricsResult, SearchFilter, SearchResponse, StreamInfo, YtmError,
    },
    shared_service,
};

fn message(e: YtmError) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn ytm_search(query: String, filter: Option<String>) -> Result<SearchResponse, String> {
    shared_service()
        .search(&query, SearchFilter::from_opt(filter.as_deref()))
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn ytm_album(browse_id: String) -> Result<AlbumDetail, String> {
    shared_service()
        .get_album(&browse_id)
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn ytm_artist(browse_id: String) -> Result<ArtistDetail, String> {
    shared_service()
        .get_artist(&browse_id)
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn ytm_lyrics(
    video_id: String,
    title: Option<String>,
    artist: Option<String>,
    duration_sec: Option<u64>,
) -> Result<LyricsResult, String> {
    shared_service()
        .get_lyrics(&video_id, title.as_deref(), artist.as_deref(), duration_sec)
        .await
        .map_err(message)
}

#[tauri::command]
pub async fn ytm_stream(video_id: String, force_refresh: bool) -> Result<StreamInfo, String> {
    let mut stream = shared_service()
        .direct_stream(&video_id, force_refresh)
        .await
        .map_err(message)?;
    stream.url = super::stream_server::media_url(&video_id).await?;
    Ok(stream)
}

#[tauri::command]
pub async fn ytm_refresh_stream(video_id: String) -> Result<StreamInfo, String> {
    ytm_stream(video_id, true).await
}
