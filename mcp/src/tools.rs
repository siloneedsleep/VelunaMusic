use crate::protocol::{tool_result_json, INVALID_PARAMS};
use serde_json::{json, Value};
use std::fs::File;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use veluna_core::dj::{analyze, equal_power_gains, plan_crossfade_ms, Analysis, Section};
use veluna_core::http::build_client;
use veluna_core::ytmusic::models::SearchFilter;
use veluna_core::ytmusic::{
    default_video_thumbnails, normalize_video_id, shared_service, valid_video_id,
};

const DEFAULT_SUPABASE_URL: &str = "https://vkzrgfiopdnujookplbv.supabase.co";
const DEFAULT_SUPABASE_KEY: &str = "sb_publishable_BlbgnOiDqur6plECJLrA3g_ZTU4C9a1";

pub fn list_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "ytm_search",
            "description": "Search songs, videos, albums, and playlists on YouTube Music via veluna-core InnerTube.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search keywords."
                    },
                    "filter": {
                        "type": "string",
                        "enum": ["all", "songs", "videos", "albums", "playlists", "artists"],
                        "description": "Optional content type filter."
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "default": 10,
                        "description": "Maximum items returned per category (default 10)."
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "ytm_home_feed",
            "description": "Fetch personalized YouTube Music Home (FEmusic_home) recommendation carousels and Mood filter chips.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mood_params": {
                        "type": "string",
                        "description": "Optional InnerTube mood/genre params token returned by a previous call."
                    },
                    "continuation": {
                        "type": "string",
                        "description": "Optional pagination continuation token."
                    }
                },
                "additionalProperties": false
            }
        }),
        json!({
            "name": "ytm_resolve_track",
            "description": "Resolve track metadata, duration, high-resolution artwork URLs, and audio stream availability from a YouTube Music video_id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "video_id": {
                        "type": "string",
                        "description": "11-character YouTube video ID or ytmusic://<video_id> URI."
                    },
                    "force_refresh": {
                        "type": "boolean",
                        "default": false,
                        "description": "Bypass cached stream metadata and re-resolve from InnerTube."
                    }
                },
                "required": ["video_id"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "dj_analyze_automix",
            "description": "Compute cueInMs, cueOutMs, recommended overlap, and equal-power cos/sin crossfade curve between two tracks via veluna-core::dj.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "track_a_path": { "type": "string", "description": "Optional local audio file path for outgoing track A." },
                    "track_b_path": { "type": "string", "description": "Optional local audio file path for incoming track B." },
                    "track_a_duration_sec": { "type": "number", "minimum": 0.1, "description": "Outgoing track A duration in seconds when not analyzing a local file." },
                    "track_b_duration_sec": { "type": "number", "minimum": 0.1, "description": "Incoming track B duration in seconds when not analyzing a local file." },
                    "track_a_bpm": { "type": "integer", "minimum": 40, "maximum": 240, "description": "Optional BPM for outgoing track A outro." },
                    "track_b_bpm": { "type": "integer", "minimum": 40, "maximum": 240, "description": "Optional BPM for incoming track B intro." },
                    "track_a_rms": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
                    "track_b_rms": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
                    "track_b_cue_in_ms": { "type": "integer", "minimum": 0, "maximum": 4000 },
                    "style": {
                        "type": "string",
                        "enum": ["gentle", "party", "album"],
                        "default": "gentle",
                        "description": "AutoMix transition style (album forces 0ms overlap)."
                    },
                    "fixed_seconds": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 30,
                        "default": 0,
                        "description": "Optional fixed crossfade duration in seconds (0 = automatic)."
                    }
                },
                "additionalProperties": false
            }
        }),
        json!({
            "name": "remote_handoff_command",
            "description": "Dispatch a VelunaMusic playback control or handoff command (play, pause, next, previous, handoff) to a target device via Supabase RPC.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["play", "pause", "next", "previous", "handoff"],
                        "description": "Playback command or session handoff action."
                    },
                    "target_device_id": {
                        "type": "string",
                        "description": "UUID of the target VelunaMusic device."
                    },
                    "sender_device_id": {
                        "type": "string",
                        "description": "Optional UUID of the sender device (defaults to VELUNA_DEVICE_ID or generated UUIDv4)."
                    },
                    "playback_instance": {
                        "type": "string",
                        "description": "UUID of the target device's active playback instance (for play/pause/next/previous)."
                    },
                    "queue_version": {
                        "type": "string",
                        "description": "UUID of the target device's current queue version (for play/pause/next/previous)."
                    },
                    "track_title": {
                        "type": "string",
                        "description": "Track display title (used when action is handoff)."
                    },
                    "track_digest": {
                        "type": "string",
                        "description": "Track SHA-256 hex digest or ytmusic://<video_id> URI (used when action is handoff)."
                    },
                    "dry_run": {
                        "type": "boolean",
                        "default": false,
                        "description": "Validate and return the structured Supabase RPC payload without sending an HTTP request."
                    }
                },
                "required": ["action", "target_device_id"],
                "additionalProperties": false
            }
        }),
    ]
}

pub async fn call_tool(name: &str, args: &Value) -> Result<Value, (i32, String)> {
    match name {
        "ytm_search" => Ok(handle_ytm_search(args).await),
        "ytm_home_feed" => Ok(handle_ytm_home_feed(args).await),
        "ytm_resolve_track" => Ok(handle_ytm_resolve_track(args).await),
        "dj_analyze_automix" => Ok(handle_dj_analyze_automix(args).await),
        "remote_handoff_command" => Ok(handle_remote_handoff_command(args).await),
        other => Err((INVALID_PARAMS, format!("Unknown tool: {other}"))),
    }
}

async fn handle_ytm_search(args: &Value) -> Value {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if query.is_empty() {
        return tool_result_json(json!({ "error": "Missing required parameter: query" }), true);
    }
    let filter_raw = args.get("filter").and_then(Value::as_str);
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .clamp(1, 50) as usize;
    let filter = SearchFilter::from_opt(filter_raw);

    match shared_service().search(query, filter).await {
        Ok(mut res) => {
            res.tracks.truncate(limit);
            res.videos.truncate(limit);
            res.albums.truncate(limit);
            res.playlists.truncate(limit);
            res.artists.truncate(limit);
            tool_result_json(
                json!({
                    "query": res.query,
                    "filter": filter_raw.unwrap_or("all"),
                    "limit": limit,
                    "counts": {
                        "tracks": res.tracks.len(),
                        "videos": res.videos.len(),
                        "albums": res.albums.len(),
                        "playlists": res.playlists.len(),
                        "artists": res.artists.len()
                    },
                    "tracks": res.tracks,
                    "videos": res.videos,
                    "albums": res.albums,
                    "playlists": res.playlists,
                    "artists": res.artists
                }),
                false,
            )
        }
        Err(err) => tool_result_json(json!({ "error": err.to_string() }), true),
    }
}

async fn handle_ytm_home_feed(args: &Value) -> Value {
    let mood_params = args
        .get("mood_params")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let continuation = args
        .get("continuation")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match shared_service().get_home_page(mood_params, continuation).await {
        Ok(home) => tool_result_json(
            json!({
                "chipCount": home.chips.len(),
                "shelfCount": home.shelves.len(),
                "chips": home.chips,
                "shelves": home.shelves,
                "continuation": home.continuation
            }),
            false,
        ),
        Err(err) => tool_result_json(json!({ "error": err.to_string() }), true),
    }
}

async fn handle_ytm_resolve_track(args: &Value) -> Value {
    let raw_id = args
        .get("video_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(vid) = normalize_video_id(raw_id) else {
        return tool_result_json(
            json!({ "error": "Invalid video_id: expected 11-character YouTube ID or ytmusic://<id>" }),
            true,
        );
    };
    let force_refresh = args
        .get("force_refresh")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let service = shared_service();
    let resolved = match service.resolve_stream(vid, force_refresh).await {
        Ok(info) => Ok(info),
        Err(_) => service.direct_stream(vid, force_refresh).await,
    };

    let thumbnails = default_video_thumbnails(vid);

    match resolved {
        Ok(info) => {
            let now_epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let available = !info.url.is_empty() && (info.expires_at == 0 || info.expires_at > now_epoch);
            tool_result_json(
                json!({
                    "video_id": vid,
                    "uri": format!("ytmusic://{vid}"),
                    "title": info.title,
                    "author": info.author,
                    "duration_ms": info.duration_ms,
                    "thumbnails": thumbnails,
                    "stream": {
                        "available": available,
                        "codec": info.codec,
                        "container": info.container,
                        "mime_type": info.mime_type,
                        "itag": info.itag,
                        "bitrate": info.bitrate,
                        "bitrate_kbps": info.bitrate_kbps,
                        "sample_rate": info.sample_rate,
                        "channels": info.channels,
                        "loudness_db": info.loudness_db,
                        "expires_at": info.expires_at,
                        "client_used": info.client_used
                    }
                }),
                false,
            )
        }
        Err(err) => tool_result_json(
            json!({
                "video_id": vid,
                "uri": format!("ytmusic://{vid}"),
                "thumbnails": thumbnails,
                "stream": {
                    "available": false,
                    "reason": err.to_string()
                }
            }),
            true,
        ),
    }
}

struct TrackMixInput {
    analysis: Option<Analysis>,
    duration_sec: Option<f64>,
    intro: Section,
    outro: Option<Section>,
    cue_in_ms: u64,
}

fn load_track_input(
    path: Option<&str>,
    duration_override: Option<f64>,
    bpm_override: Option<u16>,
    rms_override: Option<f32>,
    cue_override: Option<u64>,
) -> Result<TrackMixInput, String> {
    if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        let file = File::open(p).map_err(|e| format!("Failed to open '{p}': {e}"))?;
        let data = analyze(file)?;
        let intro = Section {
            bpm: bpm_override.or(data.intro.bpm),
            confidence: data.intro.confidence,
            rms: rms_override.unwrap_or(data.intro.rms),
        };
        let outro = data.outro.clone().map(|mut s| {
            if let Some(b) = bpm_override {
                s.bpm = Some(b);
            }
            if let Some(r) = rms_override {
                s.rms = r;
            }
            s
        });
        let duration_sec = duration_override.or(data.duration);
        let cue_in_ms = cue_override.unwrap_or(data.cue_in_ms).min(4000);
        return Ok(TrackMixInput {
            analysis: Some(data),
            duration_sec,
            intro,
            outro,
            cue_in_ms,
        });
    }

    let sec = Section {
        bpm: bpm_override,
        confidence: if bpm_override.is_some() { 0.85 } else { 0.0 },
        rms: rms_override.unwrap_or(0.25).clamp(0.0, 1.0),
    };
    Ok(TrackMixInput {
        analysis: None,
        duration_sec: duration_override,
        intro: sec.clone(),
        outro: Some(sec),
        cue_in_ms: cue_override.unwrap_or(0).min(4000),
    })
}

async fn handle_dj_analyze_automix(args: &Value) -> Value {
    let args_owned = args.clone();
    let computed = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let style = args_owned
            .get("style")
            .and_then(Value::as_str)
            .unwrap_or("gentle");
        let fixed_seconds = args_owned
            .get("fixed_seconds")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(30);

        let a = load_track_input(
            args_owned.get("track_a_path").and_then(Value::as_str),
            args_owned
                .get("track_a_duration_sec")
                .and_then(Value::as_f64),
            args_owned
                .get("track_a_bpm")
                .and_then(Value::as_u64)
                .and_then(|v| u16::try_from(v).ok()),
            args_owned
                .get("track_a_rms")
                .and_then(Value::as_f64)
                .map(|v| v as f32),
            None,
        )?;
        let b = load_track_input(
            args_owned.get("track_b_path").and_then(Value::as_str),
            args_owned
                .get("track_b_duration_sec")
                .and_then(Value::as_f64),
            args_owned
                .get("track_b_bpm")
                .and_then(Value::as_u64)
                .and_then(|v| u16::try_from(v).ok()),
            args_owned
                .get("track_b_rms")
                .and_then(Value::as_f64)
                .map(|v| v as f32),
            args_owned.get("track_b_cue_in_ms").and_then(Value::as_u64),
        )?;

        let crossfade_ms = plan_crossfade_ms(
            style,
            fixed_seconds,
            a.outro.as_ref(),
            &b.intro,
            a.duration_sec,
            b.duration_sec,
        );

        let duration_a_ms = a
            .duration_sec
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| (d * 1000.0).round() as u64);
        let cue_out_ms = duration_a_ms.map(|d| d.saturating_sub(crossfade_ms));
        let cue_in_ms = if style == "album" { 0 } else { b.cue_in_ms };

        let curve: Vec<Value> = [0.0f32, 0.25, 0.5, 0.75, 1.0]
            .into_iter()
            .map(|p| {
                let (out_gain, in_gain) = equal_power_gains(p);
                json!({
                    "progress": p,
                    "outGain": (out_gain * 10000.0).round() / 10000.0,
                    "inGain": (in_gain * 10000.0).round() / 10000.0,
                    "energySum": ((out_gain * out_gain + in_gain * in_gain) * 10000.0).round() / 10000.0
                })
            })
            .collect();

        Ok(json!({
            "style": style,
            "cueInMs": cue_in_ms,
            "cueOutMs": cue_out_ms,
            "crossfadeMs": crossfade_ms,
            "curveType": "equal-power-cos-sin",
            "equalPowerCurve": curve,
            "trackA": {
                "durationSec": a.duration_sec,
                "outro": a.outro,
                "codec": a.analysis.as_ref().and_then(|x| x.codec),
                "sampleRate": a.analysis.as_ref().and_then(|x| x.sample_rate),
                "channels": a.analysis.as_ref().and_then(|x| x.channels),
                "averageFileKbps": a.analysis.as_ref().and_then(|x| x.average_file_kbps)
            },
            "trackB": {
                "durationSec": b.duration_sec,
                "intro": b.intro,
                "cueInMs": b.cue_in_ms,
                "codec": b.analysis.as_ref().and_then(|x| x.codec),
                "sampleRate": b.analysis.as_ref().and_then(|x| x.sample_rate),
                "channels": b.analysis.as_ref().and_then(|x| x.channels),
                "averageFileKbps": b.analysis.as_ref().and_then(|x| x.average_file_kbps)
            }
        }))
    })
    .await;

    match computed {
        Ok(Ok(val)) => tool_result_json(val, false),
        Ok(Err(err)) => tool_result_json(json!({ "error": err }), true),
        Err(err) => tool_result_json(json!({ "error": format!("Analysis task failed: {err}") }), true),
    }
}

fn is_valid_uuid(raw: &str) -> bool {
    let b = raw.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (idx, &ch) in b.iter().enumerate() {
        if matches!(idx, 8 | 13 | 18 | 23) {
            if ch != b'-' {
                return false;
            }
        } else if !ch.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

fn generate_uuid_v4() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Failed to generate UUID entropy".to_string())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    ))
}

fn format_iso8601_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let rem = epoch_secs % 86_400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let mut y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

async fn handle_remote_handoff_command(args: &Value) -> Value {
    let action = args
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !matches!(action, "play" | "pause" | "next" | "previous" | "handoff") {
        return tool_result_json(
            json!({ "error": "Invalid action: expected one of play, pause, next, previous, handoff" }),
            true,
        );
    }

    let target_device_id = args
        .get("target_device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !is_valid_uuid(target_device_id) {
        return tool_result_json(
            json!({ "error": "Invalid target_device_id: expected RFC 4122 UUID" }),
            true,
        );
    }

    let env_device = std::env::var("VELUNA_DEVICE_ID").ok();
    let sender_device_id = match args
        .get("sender_device_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| env_device.as_deref().filter(|s| !s.is_empty()))
    {
        Some(v) => {
            if !is_valid_uuid(v) {
                return tool_result_json(
                    json!({ "error": "Invalid sender_device_id: expected RFC 4122 UUID" }),
                    true,
                );
            }
            v.to_string()
        }
        None => match generate_uuid_v4() {
            Ok(id) => id,
            Err(err) => return tool_result_json(json!({ "error": err }), true),
        },
    };

    let op_id = match generate_uuid_v4() {
        Ok(id) => id,
        Err(err) => return tool_result_json(json!({ "error": err }), true),
    };
    let dry_run = args.get("dry_run").and_then(Value::as_bool).unwrap_or(false);

    let (rpc_path, payload) = if action == "handoff" {
        let title = args
            .get("track_title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("VelunaMusic Track");
        let digest = args
            .get("track_digest")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        let valid_digest = digest
            .strip_prefix("ytmusic://")
            .is_some_and(valid_video_id)
            || (digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()));
        if !valid_digest {
            return tool_result_json(
                json!({ "error": "handoff requires track_digest as a 64-char SHA-256 hex digest or ytmusic://<video_id>" }),
                true,
            );
        }
        (
            "/rest/v1/rpc/veluna_offer",
            json!({
                "p_id": op_id,
                "p_source": sender_device_id,
                "p_target": target_device_id,
                "p_digest": digest,
                "p_title": title.chars().take(160).collect::<String>()
            }),
        )
    } else {
        let playback_instance = match args
            .get("playback_instance")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(v) if is_valid_uuid(v) => v.to_string(),
            Some(_) => {
                return tool_result_json(
                    json!({ "error": "Invalid playback_instance: expected RFC 4122 UUID" }),
                    true,
                );
            }
            None if dry_run => match generate_uuid_v4() {
                Ok(id) => id,
                Err(err) => return tool_result_json(json!({ "error": err }), true),
            },
            None => {
                return tool_result_json(
                    json!({ "error": "playback_instance UUID is required when dispatching live remote commands" }),
                    true,
                );
            }
        };
        let queue_version = match args
            .get("queue_version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(v) if is_valid_uuid(v) => v.to_string(),
            Some(_) => {
                return tool_result_json(
                    json!({ "error": "Invalid queue_version: expected RFC 4122 UUID" }),
                    true,
                );
            }
            None if dry_run => match generate_uuid_v4() {
                Ok(id) => id,
                Err(err) => return tool_result_json(json!({ "error": err }), true),
            },
            None => {
                return tool_result_json(
                    json!({ "error": "queue_version UUID is required when dispatching live remote commands" }),
                    true,
                );
            }
        };
        let deadline_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() + 30)
            .unwrap_or(30);
        (
            "/rest/v1/rpc/veluna_command",
            json!({
                "p_id": op_id,
                "p_sender": sender_device_id,
                "p_recipient": target_device_id,
                "p_instance": playback_instance,
                "p_version": queue_version,
                "p_action": action,
                "p_value": 0.0,
                "p_destination": 0,
                "p_deadline": format_iso8601_utc(deadline_secs)
            }),
        )
    };

    let supabase_url = std::env::var("VELUNA_SUPABASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SUPABASE_URL.to_string());
    let supabase_key = std::env::var("VELUNA_SUPABASE_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SUPABASE_KEY.to_string());
    let endpoint = format!("{}{}", supabase_url.trim_end_matches('/'), rpc_path);

    if dry_run {
        return tool_result_json(
            json!({
                "dispatched": false,
                "dryRun": true,
                "action": action,
                "opId": op_id,
                "endpoint": endpoint,
                "payload": payload
            }),
            false,
        );
    }

    let access_token = match std::env::var("VELUNA_SUPABASE_ACCESS_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        Some(token) => token,
        None => {
            return tool_result_json(
                json!({
                    "dispatched": false,
                    "error": "VELUNA_SUPABASE_ACCESS_TOKEN environment variable is required for live dispatch (or pass dry_run: true to inspect the command payload).",
                    "endpoint": endpoint,
                    "payload": payload
                }),
                true,
            );
        }
    };

    let client = match build_client(Duration::from_secs(15), None) {
        Ok(c) => c,
        Err(err) => return tool_result_json(json!({ "error": err.to_string() }), true),
    };

    let response = client
        .post(&endpoint)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {access_token}"))
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            let parsed_body: Value = serde_json::from_str(&body_text).unwrap_or(json!(body_text));
            if status.is_success() {
                tool_result_json(
                    json!({
                        "dispatched": true,
                        "status": status.as_u16(),
                        "action": action,
                        "opId": op_id,
                        "endpoint": endpoint,
                        "response": parsed_body
                    }),
                    false,
                )
            } else {
                tool_result_json(
                    json!({
                        "dispatched": false,
                        "status": status.as_u16(),
                        "action": action,
                        "opId": op_id,
                        "error": parsed_body
                    }),
                    true,
                )
            }
        }
        Err(err) => tool_result_json(
            json!({
                "dispatched": false,
                "action": action,
                "opId": op_id,
                "error": err.without_url().to_string()
            }),
            true,
        ),
    }
}
