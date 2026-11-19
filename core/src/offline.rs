use crate::http::build_client;
use crate::ytmusic::{default_video_thumbnails, shared_service, valid_video_id};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_AUDIO_BYTES: usize = 256 * 1024 * 1024;
const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OfflineEntry {
    pub video_id: String,
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub codec: String,
    pub container: String,
    pub bitrate_kbps: u32,
    pub sample_rate: u32,
    pub loudness_db: Option<f64>,
    pub duration_sec: Option<u64>,
    pub audio_path: String,
    pub cover_path: Option<String>,
    pub lyrics_path: Option<String>,
    pub size_bytes: u64,
    pub downloaded_at: u64,
}

#[derive(Debug, Clone, Default)]
pub struct OfflineMeta {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub codec: String,
    pub container: String,
    pub bitrate_kbps: u32,
    pub sample_rate: u32,
    pub loudness_db: Option<f64>,
    pub duration_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineResolved {
    pub entry: OfflineEntry,
    pub lyrics: Option<String>,
}

pub struct OfflineStore {
    root: PathBuf,
}

static INDEX_LOCK: Mutex<()> = Mutex::new(());

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn safe_extension(container: &str, codec: &str) -> &'static str {
    let lower = container.trim().to_ascii_lowercase();
    match lower.as_str() {
        "webm" => "webm",
        "m4a" | "mp4" => "m4a",
        "ogg" => "ogg",
        "opus" => "opus",
        "mp3" => "mp3",
        _ => {
            if codec.to_ascii_lowercase().contains("opus") {
                "webm"
            } else {
                "m4a"
            }
        }
    }
}

async fn download_bounded(url: &str, timeout_secs: u64, max_bytes: usize) -> Result<Vec<u8>, String> {
    let client = build_client(Duration::from_secs(timeout_secs), Some("VelunaMusic"))
        .map_err(|e| e.without_url().to_string())?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .error_for_status()
        .map_err(|e| e.without_url().to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.without_url().to_string())? {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err("Offline asset exceeds maximum size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("Empty offline payload".into());
    }
    Ok(bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

impl OfflineStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            root: base_dir.join("offline"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.root
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("index.json")
    }

    fn ensure_dir(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())
    }

    fn read_index_unlocked(&self) -> Result<Vec<OfflineEntry>, String> {
        match fs::read(self.index_path()) {
            Ok(data) => serde_json::from_slice(&data).map_err(|e| e.to_string()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(err) => Err(err.to_string()),
        }
    }

    fn write_index_unlocked(&self, entries: &[OfflineEntry]) -> Result<(), String> {
        self.ensure_dir()?;
        let data = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
        write_atomic(&self.index_path(), &data)
    }

    pub fn is_contained_file(&self, candidate: &Path) -> bool {
        if candidate.as_os_str().is_empty()
            || candidate.to_string_lossy().contains('\0')
            || candidate
                .components()
                .any(|c| matches!(c, Component::ParentDir))
        {
            return false;
        }
        let Ok(canon_root) = fs::canonicalize(&self.root) else {
            return false;
        };
        let Ok(canon_file) = fs::canonicalize(candidate) else {
            return false;
        };
        canon_file.starts_with(&canon_root) && canon_file.is_file()
    }

    pub fn list(&self) -> Result<Vec<OfflineEntry>, String> {
        let _guard = INDEX_LOCK.lock().map_err(|_| "Offline cache lock error")?;
        let raw = self.read_index_unlocked()?;
        let before = raw.len();
        let valid: Vec<OfflineEntry> = raw
            .into_iter()
            .filter(|e| valid_video_id(&e.video_id) && self.is_contained_file(Path::new(&e.audio_path)))
            .collect();
        if valid.len() != before {
            let _ = self.write_index_unlocked(&valid);
        }
        Ok(valid)
    }

    pub fn get(&self, video_id: &str) -> Result<Option<OfflineEntry>, String> {
        if !valid_video_id(video_id) {
            return Err("Invalid video ID".into());
        }
        let entries = self.list()?;
        Ok(entries.into_iter().find(|e| e.video_id == video_id))
    }

    pub fn resolve(&self, video_id: &str) -> Result<Option<OfflineResolved>, String> {
        let Some(entry) = self.get(video_id)? else {
            return Ok(None);
        };
        let lyrics = entry
            .lyrics_path
            .as_deref()
            .filter(|p| self.is_contained_file(Path::new(p)))
            .and_then(|p| fs::read_to_string(p).ok())
            .filter(|s| !s.trim().is_empty());
        Ok(Some(OfflineResolved { entry, lyrics }))
    }

    pub fn save_bytes(
        &self,
        video_id: &str,
        meta: OfflineMeta,
        audio_bytes: &[u8],
        cover_bytes: Option<&[u8]>,
        lyrics_text: Option<&str>,
    ) -> Result<OfflineEntry, String> {
        if !valid_video_id(video_id) {
            return Err("Invalid video ID".into());
        }
        if audio_bytes.is_empty() || audio_bytes.len() > MAX_AUDIO_BYTES {
            return Err("Invalid audio payload size".into());
        }
        let _guard = INDEX_LOCK.lock().map_err(|_| "Offline cache lock error")?;
        self.ensure_dir()?;

        let ext = safe_extension(&meta.container, &meta.codec);
        let audio_file = self.root.join(format!("{video_id}.{ext}"));
        write_atomic(&audio_file, audio_bytes)?;

        let cover_path = if let Some(bytes) = cover_bytes.filter(|b| !b.is_empty() && b.len() <= MAX_COVER_BYTES) {
            let cover_file = self.root.join(format!("{video_id}.jpg"));
            write_atomic(&cover_file, bytes)?;
            Some(cover_file.to_string_lossy().into_owned())
        } else {
            None
        };

        let lyrics_path = if let Some(text) = lyrics_text.filter(|t| !t.trim().is_empty()) {
            let lrc_file = self.root.join(format!("{video_id}.lrc"));
            write_atomic(&lrc_file, text.as_bytes())?;
            Some(lrc_file.to_string_lossy().into_owned())
        } else {
            None
        };

        let entry = OfflineEntry {
            video_id: video_id.to_string(),
            id: format!("ytmusic://{video_id}"),
            title: if meta.title.trim().is_empty() {
                video_id.to_string()
            } else {
                meta.title.trim().to_string()
            },
            artist: meta.artist.trim().to_string(),
            album: meta.album.trim().to_string(),
            codec: meta.codec,
            container: meta.container,
            bitrate_kbps: meta.bitrate_kbps,
            sample_rate: meta.sample_rate,
            loudness_db: meta.loudness_db,
            duration_sec: meta.duration_sec,
            audio_path: audio_file.to_string_lossy().into_owned(),
            cover_path,
            lyrics_path,
            size_bytes: audio_bytes.len() as u64,
            downloaded_at: now_epoch(),
        };

        let mut entries = self.read_index_unlocked()?;
        if let Some(existing) = entries.iter().find(|e| e.video_id == video_id) {
            if existing.audio_path != entry.audio_path {
                let _ = fs::remove_file(&existing.audio_path);
            }
        }
        entries.retain(|e| e.video_id != video_id);
        entries.push(entry.clone());
        self.write_index_unlocked(&entries)?;
        Ok(entry)
    }

    pub async fn download_track(
        &self,
        video_id: &str,
        title: Option<&str>,
        artist: Option<&str>,
        album: Option<&str>,
        thumbnail_url: Option<&str>,
        lyrics_lrc: Option<&str>,
    ) -> Result<OfflineEntry, String> {
        if !valid_video_id(video_id) {
            return Err("Invalid video ID".into());
        }
        let service = shared_service();
        let stream = match service.resolve_stream(video_id, false).await {
            Ok(info) => info,
            Err(_) => service
                .direct_stream(video_id, false)
                .await
                .map_err(|e| e.to_string())?,
        };
        let audio_bytes = download_bounded(&stream.url, 180, MAX_AUDIO_BYTES).await?;

        let mut cover_bytes = None;
        let mut thumb_candidates = Vec::new();
        if let Some(url) = thumbnail_url.map(str::trim).filter(|u| u.starts_with("https://")) {
            thumb_candidates.push(url.to_string());
        }
        thumb_candidates.extend(default_video_thumbnails(video_id));
        for candidate in thumb_candidates {
            if let Ok(bytes) = download_bounded(&candidate, 20, MAX_COVER_BYTES).await {
                cover_bytes = Some(bytes);
                break;
            }
        }

        let resolved_title = title
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .or(stream.title.clone())
            .unwrap_or_else(|| video_id.to_string());
        let resolved_artist = artist
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .or(stream.author.clone())
            .unwrap_or_default();
        let duration_sec = stream.duration_ms.map(|ms| ms / 1000);

        let cached_lyrics = match lyrics_lrc.map(str::trim).filter(|s| !s.is_empty()) {
            Some(text) => Some(text.to_string()),
            None => service
                .get_lyrics(
                    video_id,
                    Some(&resolved_title),
                    (!resolved_artist.is_empty()).then_some(resolved_artist.as_str()),
                    duration_sec,
                )
                .await
                .ok()
                .and_then(|res| {
                    res.synced_lrc
                        .filter(|s| !s.trim().is_empty())
                        .or_else(|| (!res.plain_lyrics.trim().is_empty()).then_some(res.plain_lyrics))
                }),
        };

        let meta = OfflineMeta {
            title: resolved_title,
            artist: resolved_artist,
            album: album.unwrap_or("").trim().to_string(),
            codec: stream.codec,
            container: stream.container,
            bitrate_kbps: stream.bitrate_kbps,
            sample_rate: stream.sample_rate,
            loudness_db: stream.loudness_db,
            duration_sec,
        };

        self.save_bytes(
            video_id,
            meta,
            &audio_bytes,
            cover_bytes.as_deref(),
            cached_lyrics.as_deref(),
        )
    }

    pub fn delete(&self, video_id: &str) -> Result<bool, String> {
        if !valid_video_id(video_id) {
            return Err("Invalid video ID".into());
        }
        let _guard = INDEX_LOCK.lock().map_err(|_| "Offline cache lock error")?;
        let mut entries = self.read_index_unlocked()?;
        let Some(pos) = entries.iter().position(|e| e.video_id == video_id) else {
            return Ok(false);
        };
        let removed = entries.remove(pos);
        if self.is_contained_file(Path::new(&removed.audio_path)) {
            let _ = fs::remove_file(&removed.audio_path);
        }
        if let Some(cover) = removed.cover_path.filter(|p| self.is_contained_file(Path::new(p))) {
            let _ = fs::remove_file(cover);
        }
        if let Some(lyrics) = removed.lyrics_path.filter(|p| self.is_contained_file(Path::new(p))) {
            let _ = fs::remove_file(lyrics);
        }
        self.write_index_unlocked(&entries)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_store_saves_resolves_prunes_and_deletes() {
        let base = std::env::temp_dir().join(format!(
            "veluna-offline-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = OfflineStore::new(base.clone());
        let vid = "aB1_CD-2345";
        let saved = store
            .save_bytes(
                vid,
                OfflineMeta {
                    title: "Offline Track".into(),
                    artist: "Veluna Artist".into(),
                    album: "Veluna Album".into(),
                    codec: "opus".into(),
                    container: "webm".into(),
                    bitrate_kbps: 140,
                    sample_rate: 48000,
                    loudness_db: Some(-2.5),
                    duration_sec: Some(215),
                },
                b"fake-opus-stream-bytes",
                Some(b"fake-jpg-cover"),
                Some("[00:01.00] Hello Offline\n"),
            )
            .expect("save offline track");

        assert_eq!(saved.id, "ytmusic://aB1_CD-2345");
        assert!(Path::new(&saved.audio_path).is_file());
        assert!(saved.cover_path.as_deref().is_some_and(|p| Path::new(p).is_file()));
        assert_eq!(store.list().expect("list").len(), 1);

        let resolved = store.resolve(vid).expect("resolve").expect("present");
        assert_eq!(resolved.entry.loudness_db, Some(-2.5));
        assert_eq!(resolved.lyrics.as_deref(), Some("[00:01.00] Hello Offline\n"));

        assert!(store.delete(vid).expect("delete"));
        assert!(!Path::new(&saved.audio_path).is_file());
        assert!(store.list().expect("list empty").is_empty());
        assert!(!store.delete(vid).expect("delete missing"));

        let outside = base.join("escape.webm");
        fs::write(&outside, b"protected").unwrap();
        let poisoned = OfflineEntry {
            audio_path: store.dir().join("..").join("escape.webm").to_string_lossy().into_owned(),
            ..saved
        };
        fs::write(
            store.dir().join("index.json"),
            serde_json::to_vec(&vec![poisoned]).unwrap(),
        )
        .unwrap();
        assert!(store.list().expect("pruned traversal").is_empty());
        assert!(outside.is_file(), "outside file must never be deleted");

        let _ = fs::remove_dir_all(base);
    }
}
