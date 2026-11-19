pub mod cipher;
pub mod client;
pub mod models;
pub mod parser;
pub mod stream;

use cipher::CipherEngine;
use client::{InnerTubeClient, InnerTubeClientKind};
use models::{
    AlbumDetail, ArtistDetail, LyricsResult, SearchFilter, SearchResponse, StreamInfo, YtmError,
};
use parser::{fetch_lyrics, parse_album_detail, parse_artist_detail, parse_search_response};
use serde_json::json;
use std::sync::{Arc, OnceLock};
use stream::StreamResolver;
use tokio::runtime::Runtime;

pub struct YtMusicService {
    client: InnerTubeClient,
    cipher: CipherEngine,
    stream: StreamResolver,
    direct_cache: std::sync::RwLock<std::collections::HashMap<String, StreamInfo>>,
}

impl Default for YtMusicService {
    fn default() -> Self {
        Self::new()
    }
}

impl YtMusicService {
    pub fn new() -> Self {
        Self {
            client: InnerTubeClient::new(),
            cipher: CipherEngine::new(),
            stream: StreamResolver::new(),
            direct_cache: Default::default(),
        }
    }

    pub async fn direct_stream(
        &self,
        video_id: &str,
        refresh: bool,
    ) -> Result<StreamInfo, YtmError> {
        if !valid_video_id(video_id) {
            return Err(YtmError::Protocol("Invalid video ID".into()));
        }
        if !refresh {
            if let Some(info) = self.direct_cache.read().ok().and_then(|cache| {
                cache
                    .get(video_id)
                    .filter(|s| s.expires_at > stream::now_epoch_sec() + 120)
                    .cloned()
            }) {
                return Ok(info);
            }
        }
        let player = self
            .client
            .post_innertube(
                InnerTubeClientKind::WebRemix,
                "player",
                json!({"videoId":video_id}),
            )
            .await?;
        let info = stream::direct_audio(video_id, &player)?;
        if let Ok(mut cache) = self.direct_cache.write() {
            cache.retain(|_, value| value.expires_at > stream::now_epoch_sec() + 120);
            if cache.len() >= 128 {
                cache.clear();
            }
            cache.insert(video_id.to_owned(), info.clone());
        }
        Ok(info)
    }

    pub async fn visitor_id(&self) -> String {
        self.client.ensure_visitor_id().await
    }

    pub async fn search(
        &self,
        query: &str,
        filter: SearchFilter,
    ) -> Result<SearchResponse, YtmError> {
        let mut payload = json!({ "query": query });
        if let Some(params) = filter.params() {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("params".to_string(), json!(params));
            }
        }
        let raw = self
            .client
            .post_innertube(InnerTubeClientKind::WebRemix, "search", payload)
            .await?;
        Ok(parse_search_response(query, &raw))
    }

    pub async fn resolve_stream(
        &self,
        video_id: &str,
        force_refresh: bool,
    ) -> Result<StreamInfo, YtmError> {
        self.stream
            .resolve_stream(&self.client, &self.cipher, video_id, force_refresh)
            .await
    }

    pub async fn refresh_stream(&self, video_id: &str) -> Result<StreamInfo, YtmError> {
        self.stream.invalidate(video_id);
        self.stream
            .resolve_stream(&self.client, &self.cipher, video_id, true)
            .await
    }

    pub async fn get_album(&self, browse_id: &str) -> Result<AlbumDetail, YtmError> {
        let raw = self
            .client
            .post_innertube(
                InnerTubeClientKind::WebRemix,
                "browse",
                json!({ "browseId": browse_id }),
            )
            .await?;
        parse_album_detail(browse_id, &raw)
    }

    pub async fn get_artist(&self, browse_id: &str) -> Result<ArtistDetail, YtmError> {
        let raw = self
            .client
            .post_innertube(
                InnerTubeClientKind::WebRemix,
                "browse",
                json!({ "browseId": browse_id }),
            )
            .await?;
        parse_artist_detail(browse_id, &raw)
    }

    pub async fn get_lyrics(
        &self,
        video_id: &str,
        title: Option<&str>,
        artist: Option<&str>,
        duration_sec: Option<u64>,
    ) -> Result<LyricsResult, YtmError> {
        fetch_lyrics(&self.client, video_id, title, artist, duration_sec).await
    }
}

pub fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}

fn shared_runtime() -> &'static Runtime {
    static RT: OnceLock<Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("ytmusic runtime")
    })
}

pub fn shared_service() -> &'static Arc<YtMusicService> {
    static SVC: OnceLock<Arc<YtMusicService>> = OnceLock::new();
    SVC.get_or_init(|| Arc::new(YtMusicService::new()))
}

fn json_result<T: serde::Serialize>(
    task: impl std::future::Future<Output = Result<T, YtmError>>,
) -> Result<String, String> {
    let result = shared_runtime().block_on(task).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

pub fn search_json(query: &str, filter: Option<&str>) -> Result<String, String> {
    let filter_enum = SearchFilter::from_opt(filter);
    json_result(shared_service().search(query, filter_enum))
}

pub fn resolve_stream_json(video_id: &str, force_refresh: bool) -> Result<String, String> {
    json_result(shared_service().resolve_stream(video_id, force_refresh))
}

pub fn refresh_stream_json(video_id: &str) -> Result<String, String> {
    json_result(shared_service().refresh_stream(video_id))
}

pub fn album_json(browse_id: &str) -> Result<String, String> {
    json_result(shared_service().get_album(browse_id))
}

pub fn artist_json(browse_id: &str) -> Result<String, String> {
    json_result(shared_service().get_artist(browse_id))
}

pub fn lyrics_json(
    video_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
    duration_sec: Option<u64>,
) -> Result<String, String> {
    json_result(shared_service().get_lyrics(video_id, title, artist, duration_sec))
}

#[cfg(test)]
mod tests {
    use super::*;
    use models::RecordingKind;

    #[test]
    #[ignore = "requires residential IP"]
    fn ytmusic_live_search_and_stream_200_ok() {
        let rt = shared_runtime();
        let svc = YtMusicService::new();
        rt.block_on(async {
            let visitor = svc.visitor_id().await;
            assert!(visitor.starts_with("Cg"), "invalid visitor identifier");

            let search = svc
                .search("Rick Astley Never Gonna Give You Up", SearchFilter::Songs)
                .await
                .expect("live search failed");
            assert!(
                !search.tracks.is_empty(),
                "expected at least one track from live search"
            );
            let first = &search.tracks[0];

            let live_search = svc
                .search("Hotel California Live Eagles", SearchFilter::All)
                .await
                .expect("live version search failed");
            let has_live = live_search
                .tracks
                .iter()
                .chain(live_search.videos.iter())
                .any(|t| t.recording_kind == RecordingKind::Live);
            assert!(has_live, "expected at least one Live classification");

            let remix_search = svc
                .search("See Tinh Remix", SearchFilter::All)
                .await
                .expect("remix search failed");
            let has_remix = remix_search
                .tracks
                .iter()
                .chain(remix_search.videos.iter())
                .any(|t| t.recording_kind == RecordingKind::Remix);
            assert!(has_remix, "expected at least one Remix classification");

            let stream = svc
                .resolve_stream(&first.video_id, true)
                .await
                .expect("resolve stream failed");
            assert!(stream.bitrate > 0);
            assert!(stream.sample_rate > 0);
            assert!(stream.expires_at > stream::now_epoch_sec());
            assert!(
                stream.codec.contains("opus")
                    || stream.codec.contains("mp4a")
                    || stream.codec.contains("aac")
            );

            let head_resp = svc
                .client
                .http()
                .head(&stream.url)
                .header("User-Agent", InnerTubeClientKind::VisionOs.user_agent())
                .send()
                .await
                .map_err(reqwest::Error::without_url)
                .expect("stream HEAD failed");
            assert_eq!(head_resp.status().as_u16(), 200);

            let refreshed = svc
                .refresh_stream(&first.video_id)
                .await
                .expect("refresh stream failed");
            assert!(!refreshed.url.is_empty());
        });
    }

    #[test]
    fn ytmusic_live_album_artist_and_lyrics() {
        let rt = shared_runtime();
        let svc = YtMusicService::new();
        rt.block_on(async {
            let album = svc
                .get_album("MPREb_dcYZhAh5urI")
                .await
                .expect("album browse failed");
            assert!(!album.title.is_empty());
            assert!(!album.tracks.is_empty());

            let artist = svc
                .get_artist("UCwZEU0wAwIyZb4x5G_KJp2w")
                .await
                .expect("artist browse failed");
            assert!(!artist.name.is_empty());
            assert!(!artist.top_songs.is_empty());

            let lyrics = svc
                .get_lyrics(
                    "fJ9rUzIMcZQ",
                    Some("Bohemian Rhapsody"),
                    Some("Queen"),
                    Some(354),
                )
                .await
                .expect("lyrics fetch failed");
            assert!(lyrics.has_time_sync);
            assert!(!lyrics.lines.is_empty());
        });
    }
}
