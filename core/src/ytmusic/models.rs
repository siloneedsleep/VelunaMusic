use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug)]
pub enum YtmError {
    Http(reqwest::Error),
    Json(serde_json::Error),
    Regex(regex::Error),
    Protocol(String),
    NotFound(String),
}

impl fmt::Display for YtmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            YtmError::Http(err) => write!(f, "HTTP error: {err}"),
            YtmError::Json(err) => write!(f, "JSON error: {err}"),
            YtmError::Regex(err) => write!(f, "Regex error: {err}"),
            YtmError::Protocol(msg) => write!(f, "Protocol error: {msg}"),
            YtmError::NotFound(msg) => write!(f, "Not found: {msg}"),
        }
    }
}

impl std::error::Error for YtmError {}

impl From<reqwest::Error> for YtmError {
    fn from(value: reqwest::Error) -> Self {
        YtmError::Http(value.without_url())
    }
}

impl From<serde_json::Error> for YtmError {
    fn from(value: serde_json::Error) -> Self {
        YtmError::Json(value)
    }
}

impl From<regex::Error> for YtmError {
    fn from(value: regex::Error) -> Self {
        YtmError::Regex(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingKind {
    Original,
    Live,
    Remix,
    Cover,
    Instrumental,
    Karaoke,
}

impl RecordingKind {
    pub fn label_vi(&self) -> &'static str {
        match self {
            RecordingKind::Original => "Bản gốc",
            RecordingKind::Live => "Live",
            RecordingKind::Remix => "Remix",
            RecordingKind::Cover => "Cover",
            RecordingKind::Instrumental => "Instrumental",
            RecordingKind::Karaoke => "Karaoke",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchFilter {
    All,
    Songs,
    Videos,
    Albums,
    Playlists,
    Artists,
}

impl SearchFilter {
    pub fn from_opt(raw: Option<&str>) -> Self {
        match raw.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "songs" | "song" | "music" => SearchFilter::Songs,
            "videos" | "video" | "mv" => SearchFilter::Videos,
            "albums" | "album" => SearchFilter::Albums,
            "playlists" | "playlist" => SearchFilter::Playlists,
            "artists" | "artist" => SearchFilter::Artists,
            _ => SearchFilter::All,
        }
    }

    pub fn params(&self) -> Option<&'static str> {
        match self {
            SearchFilter::All => None,
            SearchFilter::Songs => Some("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
            SearchFilter::Videos => Some("EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D"),
            SearchFilter::Albums => Some("EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"),
            SearchFilter::Playlists => Some("EgeKAQQoAEABahIQAxAJEAUQDhAEEAoQFRAREBA%3D"),
            SearchFilter::Artists => Some("EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtistRef {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlbumRef {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YtmTrack {
    pub video_id: String,
    pub title: String,
    pub artists: Vec<ArtistRef>,
    pub artist_text: String,
    pub album: Option<AlbumRef>,
    pub duration_sec: Option<u64>,
    pub duration_text: Option<String>,
    pub thumbnails: Vec<String>,
    pub is_explicit: bool,
    pub recording_kind: RecordingKind,
    pub recording_label: String,
    pub source: String,
    pub uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YtmAlbumSummary {
    pub browse_id: String,
    pub playlist_id: Option<String>,
    pub title: String,
    pub artists: Vec<ArtistRef>,
    pub year: Option<String>,
    pub thumbnails: Vec<String>,
    pub is_explicit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YtmArtistSummary {
    pub browse_id: String,
    pub name: String,
    pub subscribers: Option<String>,
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct YtmPlaylistSummary {
    pub browse_id: String,
    pub playlist_id: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub track_count_text: Option<String>,
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResponse {
    pub query: String,
    pub tracks: Vec<YtmTrack>,
    pub videos: Vec<YtmTrack>,
    pub albums: Vec<YtmAlbumSummary>,
    #[serde(default)]
    pub playlists: Vec<YtmPlaylistSummary>,
    pub artists: Vec<YtmArtistSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlbumDetail {
    pub browse_id: String,
    pub playlist_id: Option<String>,
    pub title: String,
    pub artists: Vec<ArtistRef>,
    pub year: Option<String>,
    pub description: Option<String>,
    pub track_count: usize,
    pub duration_text: Option<String>,
    pub thumbnails: Vec<String>,
    pub tracks: Vec<YtmTrack>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtistDetail {
    pub browse_id: String,
    pub name: String,
    pub description: Option<String>,
    pub subscribers: Option<String>,
    pub views: Option<String>,
    pub thumbnails: Vec<String>,
    pub top_songs: Vec<YtmTrack>,
    pub albums: Vec<YtmAlbumSummary>,
    pub singles: Vec<YtmAlbumSummary>,
    pub videos: Vec<YtmTrack>,
    pub live_performances: Vec<YtmTrack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamInfo {
    pub video_id: String,
    pub url: String,
    pub codec: String,
    pub container: String,
    pub mime_type: String,
    pub itag: u32,
    pub bitrate: u64,
    pub bitrate_kbps: u32,
    pub sample_rate: u32,
    pub channels: u8,
    pub content_length: Option<u64>,
    pub duration_ms: Option<u64>,
    pub loudness_db: Option<f64>,
    pub expires_at: u64,
    pub client_used: String,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub words: Vec<LyricWord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricsResult {
    pub video_id: String,
    pub source_provider: String,
    pub has_time_sync: bool,
    pub has_word_sync: bool,
    pub synced_lrc: Option<String>,
    pub plain_lyrics: String,
    pub lines: Vec<LyricLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HomeItemKind {
    Song,
    Playlist,
    Album,
    Video,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeMoodChip {
    pub label: String,
    pub params: String,
    pub browse_id: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeItem {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub artist: String,
    pub thumbnail: String,
    #[serde(rename = "type")]
    pub item_type: HomeItemKind,
    pub video_id: Option<String>,
    pub browse_id: Option<String>,
    pub playlist_id: Option<String>,
    pub recording_kind: Option<RecordingKind>,
    pub recording_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeShelf {
    pub title: String,
    pub items: Vec<HomeItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeResponse {
    pub chips: Vec<HomeMoodChip>,
    pub shelves: Vec<HomeShelf>,
    pub continuation: Option<String>,
}
