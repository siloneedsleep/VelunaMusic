use crate::ytmusic::cipher::{extract_query_param_raw, CipherEngine};
use crate::ytmusic::client::{InnerTubeClient, InnerTubeClientKind};
use crate::ytmusic::models::{StreamInfo, YtmError};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct StreamResolver {
    cache: RwLock<HashMap<String, StreamInfo>>,
}

impl Default for StreamResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamResolver {
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn invalidate(&self, video_id: &str) {
        if let Ok(mut guard) = self.cache.write() {
            guard.remove(video_id);
        }
    }

    pub async fn resolve_stream(
        &self,
        client: &InnerTubeClient,
        cipher: &CipherEngine,
        video_id: &str,
        force_refresh: bool,
    ) -> Result<StreamInfo, YtmError> {
        let now = now_epoch_sec();
        if !force_refresh {
            if let Some(hit) = self
                .cache
                .read()
                .ok()
                .and_then(|g| g.get(video_id).cloned())
            {
                if now + 120 < hit.expires_at {
                    return Ok(hit);
                }
            }
        }

        let sts = cipher
            .ensure_player_context(client)
            .await
            .map(|c| c.sts)
            .unwrap_or(20773);

        let clients = [
            InnerTubeClientKind::VisionOs,
            InnerTubeClientKind::TvHtml5,
            InnerTubeClientKind::AndroidMusic,
            InnerTubeClientKind::WebRemix,
            InnerTubeClientKind::Android,
        ];

        let mut last_err = format!("No playable audio stream found for {}", video_id);

        for kind in clients {
            let payload = match kind {
                InnerTubeClientKind::WebRemix | InnerTubeClientKind::TvHtml5 => json!({
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true,
                    "playbackContext": {
                        "contentPlaybackContext": {
                            "html5Preference": "HTML5_PREF_WANTS",
                            "signatureTimestamp": sts
                        }
                    }
                }),
                _ => json!({
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true
                }),
            };

            let player = match client.post_innertube(kind, "player", payload).await {
                Ok(v) => v,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };

            let status = player
                .get("playabilityStatus")
                .and_then(|p| p.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if status != "OK" {
                let reason = player
                    .get("playabilityStatus")
                    .and_then(|p| p.get("reason"))
                    .and_then(|s| s.as_str())
                    .unwrap_or(status);
                last_err = format!("{}: {}", kind.as_str(), reason);
                continue;
            }

            let title = player
                .get("videoDetails")
                .and_then(|d| d.get("title"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let author = player
                .get("videoDetails")
                .and_then(|d| d.get("author"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let Some(streaming) = player.get("streamingData") else {
                last_err = format!("{}: missing streamingData", kind.as_str());
                continue;
            };

            let mut raw_formats = Vec::new();
            if let Some(arr) = streaming.get("adaptiveFormats").and_then(|a| a.as_array()) {
                for fmt in arr {
                    let mime = fmt.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
                    if mime.starts_with("audio/") {
                        raw_formats.push(fmt);
                    }
                }
            }

            let mut candidates = Vec::new();
            for fmt in raw_formats {
                let itag = fmt.get("itag").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let mime_type = fmt
                    .get("mimeType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("audio/mp4")
                    .to_string();
                let (container, codec) = parse_mime_type(&mime_type);
                let bitrate = fmt
                    .get("averageBitrate")
                    .or_else(|| fmt.get("bitrate"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let sample_rate = parse_num_field(fmt.get("audioSampleRate"))
                    .map(|v| v as u32)
                    .unwrap_or(if codec.contains("opus") { 48000 } else { 44100 });
                let channels = fmt
                    .get("audioChannels")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(2) as u8;
                let content_length = parse_num_field(fmt.get("contentLength"));
                let duration_ms = parse_num_field(fmt.get("approxDurationMs"));
                let loudness_db = fmt.get("loudnessDb").and_then(|v| v.as_f64());

                let direct_url = fmt.get("url").and_then(|v| v.as_str());
                let sig_cipher = fmt
                    .get("signatureCipher")
                    .or_else(|| fmt.get("cipher"))
                    .and_then(|v| v.as_str());

                let decode_n_param = sig_cipher.is_some()
                    || matches!(
                        kind,
                        InnerTubeClientKind::WebRemix | InnerTubeClientKind::TvHtml5
                    );
                let Ok(url) = cipher
                    .deobfuscate_url(client, direct_url, sig_cipher, decode_n_param)
                    .await
                else {
                    continue;
                };

                let expires_at = parse_expires_at(&url);
                let rank = codec_rank(itag, &mime_type, &codec);

                candidates.push((
                    rank,
                    bitrate,
                    sample_rate,
                    StreamInfo {
                        video_id: video_id.to_string(),
                        url,
                        codec,
                        container,
                        mime_type,
                        itag,
                        bitrate,
                        bitrate_kbps: ((bitrate + 500) / 1000) as u32,
                        sample_rate,
                        channels,
                        content_length,
                        duration_ms,
                        loudness_db,
                        expires_at,
                        client_used: kind.as_str().to_string(),
                        title: title.clone(),
                        author: author.clone(),
                    },
                ));
            }

            candidates.sort_by(|a, b| {
                b.0.cmp(&a.0)
                    .then_with(|| b.1.cmp(&a.1))
                    .then_with(|| b.2.cmp(&a.2))
            });

            for (_, _, _, info) in candidates.into_iter().take(4) {
                if verify_stream_reachable(client, &info.url, kind.user_agent()).await {
                    if let Ok(mut guard) = self.cache.write() {
                        guard.insert(video_id.to_string(), info.clone());
                    }
                    return Ok(info);
                }
            }

            if let Some(hls_url) = streaming.get("hlsManifestUrl").and_then(|v| v.as_str()) {
                if verify_stream_reachable(client, hls_url, kind.user_agent()).await {
                    let info = StreamInfo {
                        video_id: video_id.to_string(),
                        url: hls_url.to_string(),
                        codec: "aac".to_string(),
                        container: "hls".to_string(),
                        mime_type: "application/x-mpegURL".to_string(),
                        itag: 0,
                        bitrate: 128000,
                        bitrate_kbps: 128,
                        sample_rate: 44100,
                        channels: 2,
                        content_length: None,
                        duration_ms: None,
                        loudness_db: None,
                        expires_at: parse_expires_at(hls_url),
                        client_used: kind.as_str().to_string(),
                        title,
                        author,
                    };
                    if let Ok(mut guard) = self.cache.write() {
                        guard.insert(video_id.to_string(), info.clone());
                    }
                    return Ok(info);
                }
            }

            last_err = format!("{}: candidate URLs failed HTTP check", kind.as_str());
        }

        Err(YtmError::Protocol(last_err))
    }
}

async fn verify_stream_reachable(client: &InnerTubeClient, url: &str, user_agent: &str) -> bool {
    if let Ok(resp) = client
        .http()
        .head(url)
        .header("User-Agent", user_agent)
        .send()
        .await
    {
        if resp.status().as_u16() == 200 || resp.status().as_u16() == 206 {
            return true;
        }
    }

    if let Ok(resp) = client
        .http()
        .get(url)
        .header("User-Agent", user_agent)
        .header("Range", "bytes=0-16383")
        .send()
        .await
    {
        let code = resp.status().as_u16();
        if code == 200 || code == 206 {
            return true;
        }
    }

    let separator = if url.contains('?') { '&' } else { '?' };
    if let Ok(resp) = client
        .http()
        .get(format!("{}{}range=0-16383", url, separator))
        .header("User-Agent", user_agent)
        .send()
        .await
    {
        let code = resp.status().as_u16();
        return code == 200 || code == 206;
    }

    false
}

pub(super) fn direct_audio(id: &str, player: &Value) -> Result<StreamInfo, YtmError> {
    let unavailable = || YtmError::NotFound("Open this track in the YouTube player".into());
    if player
        .pointer("/playabilityStatus/status")
        .and_then(Value::as_str)
        != Some("OK")
    {
        return Err(unavailable());
    }
    let formats = player
        .pointer("/streamingData/adaptiveFormats")
        .and_then(Value::as_array)
        .ok_or_else(unavailable)?;
    let (fmt, url, mime) = formats
        .iter()
        .filter_map(|fmt| {
            let mime = fmt["mimeType"].as_str()?;
            let url = url::Url::parse(fmt["url"].as_str()?).ok()?;
            (mime.starts_with("audio/")
                && url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && url.host_str()?.ends_with(".googlevideo.com")
                && fmt.get("drmFamilies").is_none())
            .then_some((fmt, url, mime))
        })
        .max_by_key(|(fmt, _, _)| parse_num_field(fmt.get("bitrate")).unwrap_or(0))
        .ok_or_else(unavailable)?;
    let (container, codec) = parse_mime_type(mime);
    let bitrate = parse_num_field(fmt.get("averageBitrate"))
        .or_else(|| parse_num_field(fmt.get("bitrate")))
        .unwrap_or(0);
    Ok(StreamInfo {
        video_id: id.into(),
        expires_at: parse_expires_at(url.as_str()),
        url: url.into(),
        codec,
        container,
        mime_type: mime.into(),
        itag: fmt["itag"].as_u64().unwrap_or(0) as u32,
        bitrate,
        bitrate_kbps: ((bitrate + 500) / 1000) as u32,
        sample_rate: parse_num_field(fmt.get("audioSampleRate")).unwrap_or(0) as u32,
        channels: fmt["audioChannels"].as_u64().unwrap_or(0) as u8,
        content_length: parse_num_field(fmt.get("contentLength")),
        duration_ms: parse_num_field(fmt.get("approxDurationMs")),
        loudness_db: fmt["loudnessDb"].as_f64(),
        client_used: "WEB_REMIX".into(),
        title: player
            .pointer("/videoDetails/title")
            .and_then(Value::as_str)
            .map(str::to_owned),
        author: player
            .pointer("/videoDetails/author")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

pub fn now_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn parse_expires_at(url: &str) -> u64 {
    if let Some(exp) = extract_query_param_raw(url, "expire").and_then(|s| s.parse::<u64>().ok()) {
        return exp;
    }
    if let Some(seg) = url.split("/expire/").nth(1) {
        if let Some(num) = seg.split('/').next().and_then(|s| s.parse::<u64>().ok()) {
            return num;
        }
    }
    now_epoch_sec() + 18000
}

pub fn parse_mime_type(mime: &str) -> (String, String) {
    let base = mime.split(';').next().unwrap_or("").trim();
    let container = match base {
        "audio/webm" => "webm",
        "audio/mp4" => "mp4",
        "audio/ogg" => "ogg",
        other => other.strip_prefix("audio/").unwrap_or("unknown"),
    }
    .to_string();

    let codec = if let Some(after) = mime.split("codecs=").nth(1) {
        after
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .split('"')
            .next()
            .unwrap_or("")
            .trim()
            .to_string()
    } else if container == "webm" {
        "opus".to_string()
    } else {
        "mp4a.40.2".to_string()
    };

    (container, codec)
}

pub fn codec_rank(itag: u32, mime: &str, codec: &str) -> i32 {
    match itag {
        774 => 1000,
        251 => 950,
        141 => 900,
        140 => 850,
        250 => 700,
        139 => 620,
        249 => 580,
        _ => {
            let c = codec.to_ascii_lowercase();
            let m = mime.to_ascii_lowercase();
            if c.contains("opus") || m.contains("opus") {
                820
            } else if c.contains("mp4a") || c.contains("aac") {
                760
            } else {
                200
            }
        }
    }
}

fn parse_num_field(val: Option<&Value>) -> Option<u64> {
    val.and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_direct_audio_requires_playability_and_a_provider_media_url() {
        let mut player = json!({"playabilityStatus":{"status":"OK"},"streamingData":{"adaptiveFormats":[
            {"mimeType":"audio/webm; codecs=\"opus\"","bitrate":140000,"audioSampleRate":"48000","url":"https://music.googlevideo.com/file"},
            {"mimeType":"audio/mp4","bitrate":500000,"url":"https://googlevideo.com.example.org/file"}
        ]}});
        let info = direct_audio("abcdefghijk", &player).unwrap();
        assert_eq!((info.bitrate_kbps, info.sample_rate), (140, 48000));
        player["playabilityStatus"]["status"] = json!("UNPLAYABLE");
        assert!(direct_audio("abcdefghijk", &player).is_err());
    }

    #[test]
    fn codec_selection_prefers_opus_and_high_aac() {
        assert!(
            codec_rank(251, "audio/webm; codecs=\"opus\"", "opus")
                > codec_rank(140, "audio/mp4; codecs=\"mp4a.40.2\"", "mp4a.40.2")
        );
        assert!(
            codec_rank(774, "audio/webm; codecs=\"opus\"", "opus")
                > codec_rank(251, "audio/webm; codecs=\"opus\"", "opus")
        );
        assert!(
            codec_rank(140, "audio/mp4; codecs=\"mp4a.40.2\"", "mp4a.40.2")
                > codec_rank(250, "audio/webm; codecs=\"opus\"", "opus")
        );
    }

    #[test]
    fn mime_and_expire_parsing() {
        let (container, codec) = parse_mime_type("audio/webm; codecs=\"opus\"");
        assert_eq!(container, "webm");
        assert_eq!(codec, "opus");

        let (container_aac, codec_aac) = parse_mime_type("audio/mp4; codecs=\"mp4a.40.2\"");
        assert_eq!(container_aac, "mp4");
        assert_eq!(codec_aac, "mp4a.40.2");

        assert_eq!(
            parse_expires_at(
                "https://example.googlevideo.com/videoplayback?expire=1799999999&itag=251"
            ),
            1799999999
        );
    }
}
