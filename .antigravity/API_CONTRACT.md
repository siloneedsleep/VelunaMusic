# VelunaMusic — API, JNI & Liquid Glass UI Contract

## 1. Rust Core Public API (`core/src/ytmusic/`)

### 1.1 Module Entry Points (`core/src/ytmusic/mod.rs`)

```rust
pub struct YtMusicService { ... }

impl YtMusicService {
    pub fn new() -> Self;
    pub async fn visitor_id(&self) -> String;
    pub async fn search(&self, query: &str, filter: SearchFilter) -> Result<SearchResponse, YtmError>;
    pub async fn resolve_stream(&self, video_id: &str, force_refresh: bool) -> Result<StreamInfo, YtmError>;
    pub async fn refresh_stream(&self, video_id: &str) -> Result<StreamInfo, YtmError>;
    pub async fn get_album(&self, browse_id: &str) -> Result<AlbumDetail, YtmError>;
    pub async fn get_artist(&self, browse_id: &str) -> Result<ArtistDetail, YtmError>;
    pub async fn get_lyrics(
        &self,
        video_id: &str,
        title: Option<&str>,
        artist: Option<&str>,
        duration_sec: Option<u64>,
    ) -> Result<LyricsResult, YtmError>;
}

pub fn shared_service() -> &'static Arc<YtMusicService>;
pub fn search_json(query: &str, filter: Option<&str>) -> Result<String, String>;
pub fn resolve_stream_json(video_id: &str, force_refresh: bool) -> Result<String, String>;
pub fn refresh_stream_json(video_id: &str) -> Result<String, String>;
pub fn album_json(browse_id: &str) -> Result<String, String>;
pub fn artist_json(browse_id: &str) -> Result<String, String>;
pub fn lyrics_json(
    video_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
    duration_sec: Option<u64>,
) -> Result<String, String>;
```

---

## 2. JNI Signatures (`core/src/lib.rs` ↔ `MainActivity.java`)

All `ytm*` JNI exports return a UTF-8 JSON `String` (`{"error":"..."}` on failure).

| Rust `#[no_mangle]` Export | Java Declaration (`xyz.siloneedsleep.veluna.MainActivity`) |
|---|---|
| `Java_xyz_siloneedsleep_veluna_MainActivity_newerRelease(env, class, installed, tag)` | `static native boolean newerRelease(String installed, String tag);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmSearch(env, class, query, filter)` | `static native String ytmSearch(String query, String filter);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmResolveStream(env, class, video_id, force_refresh)` | `static native String ytmResolveStream(String videoId, boolean forceRefresh);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmRefreshStream(env, class, video_id)` | `static native String ytmRefreshStream(String videoId);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmAlbum(env, class, browse_id)` | `static native String ytmAlbum(String browseId);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmArtist(env, class, browse_id)` | `static native String ytmArtist(String browseId);` |
| `Java_xyz_siloneedsleep_veluna_MainActivity_ytmLyrics(env, class, video_id, title, artist, duration_sec)` | `static native String ytmLyrics(String videoId, String title, String artist, long durationSec);` |

### `PlaybackService.java` Package Helpers
- `static String extractYtmVideoId(Uri uri, String mediaId)`
- `static void invalidateYtmStream(String videoId)`
- `static JSONObject getCachedStreamMeta(Context ctx, String videoId)`
- `static JSONObject resolveYtmStream(Context ctx, String videoId, boolean forceRefresh) throws IOException`
- `static MediaSource.Factory buildMediaSourceFactory(Context context)`

---

## 3. Android WebView Bridge (`MainActivity.Bridge` via `window.VelunaAndroid`)

Ticket-based async calls deliver responses via `window.onVelunaTransferReply(ticket, resultJson, errorString)`.

| `@JavascriptInterface` Method | Description |
|---|---|
| `ytmSearch(String ticket, String query, String filter)` | InnerTube search (`"all"`, `"songs"`, `"videos"`, `"albums"`, `"artists"`). |
| `ytmStream(String ticket, String videoId, boolean forceRefresh)` | Resolves and caches best Opus/AAC stream metadata & URL. |
| `ytmRefreshStream(String ticket, String videoId)` | Invalidates cache and force-fetches a fresh stream URL. |
| `ytmAlbum(String ticket, String browseId)` | Fetches album metadata and tracklist (`MPREb_...` / `OLAK5uy_...`). |
| `ytmArtist(String ticket, String browseId)` | Fetches artist header, top songs, albums, singles, videos, live performances (`UC...`). |
| `ytmLyrics(String ticket, String videoId, String title, String artist, long durationSec)` | Fetches synced or plain lyrics (`SimpMusic` → `LRCLIB` → `InnerTube`). |
| `ytmAddOrPlay(String tracksJson, int startIndex, boolean playNow)` | Persists `ytmusic://<videoId>` tracks in library & `ytmMeta`; optionally queues and plays via `PlaybackService`. |
| `openYouTube(String id)` | Registers `ytmusic://<id>`, starts playback via `PlaybackService`, and enriches title/artist asynchronously. |
| `readTags` / `readCover` / `analyzeTrack` | Handles both local file descriptors and `ytmusic://` URIs via `ytmMeta` + cached `StreamInfo`. |

---

## 4. Web UI Contracts (`ui/*.js`)

### 4.1 `window.velunaYtm` (`ui/sources.js`)
- `videoId(value) -> string`
- `sourceBadge(track) -> "YouTube Music" | ""`
- `formatQuality(track) -> string` (e.g. `"OPUS · 140 kb/s · 48 kHz"`)
- `search(query, filter) -> Promise<SearchResponse>`
- `stream(vidOrUri, forceRefresh) -> Promise<StreamInfo>`
- `refreshStream(vidOrUri) -> Promise<StreamInfo>`
- `album(browseId) -> Promise<AlbumDetail>`
- `artist(browseId) -> Promise<ArtistDetail>`
- `lyrics(trackOrId) -> Promise<LyricsResult>`
- `ensureLyrics(trackId) -> Promise<LyricsResult | null>`
- `playTracks(list, startIndex, playNow) -> void`
- `metaForId(id) -> object | undefined`
- `lyricsMetaForId(id) -> object | undefined`

### 4.2 `window.velunaTheme` (`ui/theme.js`)
- `export() -> ThemeConfig` (`{ surfaces, preset, scale, motion, level, dynamicCover, batterySaver, position, shade }`)
- `apply(config) -> void`
- `setPreset(name: "clear" | "frost" | "dark" | "solid") -> void`
- `presets() -> string[]`
- `isMotionReduced() -> boolean`
- `isDynamicCoverEnabled() -> boolean`
- `isPowerSaving() -> boolean`
- Body data attributes managed cleanly: `data-preset`, `data-motion` (`on`/`off`), `data-intensity` (`full`/`balanced`/`economy`/`reduced`), `data-cover-bg` (`on`/`off`), `data-power` (`battery`/`ac`), `data-window-state` (`hidden`/`visible`).

### 4.3 `window.velunaMotion` & Player Helpers (`ui/player.js`)
- `canAnimate() -> boolean`
- `transitionCover(fromEl, toEl, updateFn, focusTarget) -> Promise<void>` (uses `document.startViewTransition` with single-element `view-transition-name: cover-hero` and cleanup)
- `applyCoverPalette(imgEl) -> void` / `clearCoverPalette() -> void` (updates `--cover-bg-1`, `--cover-bg-2`, `--cover-accent`)
- `sourceBadge(track) -> "YouTube Music" | "Thiết bị" | ""`
- `fmtQuality(track) -> string`

### 4.4 `ui/lrc.js` & `window.velunaListening` (`ui/listening.js`)
- `parseLyrics(input, strict = false) -> LyricEntry[]`
- `lyricAt(entries, timeSec) -> number`
- `hasWordTiming(entries) -> boolean` (true only when valid monotonic word timestamps exist)
- `wordProgress(entry, timeSec) -> { index: number, ratio: number }`
- `window.velunaListening.progress(time, playing)` & `window.velunaListening.reloadLyrics()`
- DOM CustomEvent on `window`: `CustomEvent("veluna-ytm-lyrics", { detail: { id, lyrics } })`.

---

## 5. JSON Schemas

### `SearchResponse`
```json
{
  "query": "string",
  "tracks": [ YtmTrack ],
  "videos": [ YtmTrack ],
  "albums": [
    {
      "browse_id": "MPREb_...",
      "playlist_id": "OLAK5uy_... | null",
      "title": "string",
      "artists": [{ "id": "UC... | null", "name": "string" }],
      "year": "2020 | null",
      "thumbnails": ["https://..."],
      "is_explicit": false
    }
  ],
  "artists": [
    {
      "browse_id": "UC...",
      "name": "string",
      "subscribers": "string | null",
      "thumbnails": ["https://..."]
    }
  ]
}
```

### `StreamInfo`
```json
{
  "video_id": "11-char-id",
  "url": "https://...googlevideo.com/videoplayback?...",
  "codec": "opus | mp4a.40.2 | aac",
  "container": "webm | mp4 | hls",
  "mime_type": "audio/webm; codecs=\"opus\"",
  "itag": 251,
  "bitrate": 129123,
  "bitrate_kbps": 129,
  "sample_rate": 48000,
  "channels": 2,
  "content_length": 3456789,
  "duration_ms": 213000,
  "loudness_db": -3.2,
  "expires_at": 1795108123,
  "client_used": "VISIONOS | TVHTML5 | ANDROID_MUSIC | WEB_REMIX | ANDROID",
  "title": "string | null",
  "author": "string | null"
}
```

## Windows bridge and background delivery

The local Windows player invokes ytm_search, ytm_album, ytm_artist, ytm_lyrics, ytm_stream and ytm_refresh_stream with the argument objects used by ui/sources.js. IPC returns structured objects. Stream metadata includes a process-local playback URL for verified provider URLs. The local server accepts GET, HEAD and a single byte range. Clients transfer stable video IDs between devices.

A listening Android device advertises durable remote support from its media session. The recipient validates the operation ID, playback instance and queue version before applying it. Transport commands expire within 30 seconds on the server. Queue moves can wait up to one day. Handoff uses offered, ready, released and received phases. The target can cancel after release when opening the prepared media fails. A suspended network connection resumes delivery of unexpired operations on reconnect.
