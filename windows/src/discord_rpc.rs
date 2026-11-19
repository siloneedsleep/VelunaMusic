use serde::Deserialize;
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_CLIENT_ID: &str = "1359482710482915388";
const WEBSITE_URL: &str = "https://veluna.siloneedsleep.xyz";

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresencePayload {
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork_url: Option<String>,
    pub playing: bool,
    #[serde(default)]
    pub position_sec: f64,
    #[serde(default)]
    pub duration_sec: f64,
}

enum RpcCommand {
    SetEnabled(bool),
    Update(DiscordPresencePayload),
}

pub struct DiscordRpc {
    tx: Sender<RpcCommand>,
}

impl Default for DiscordRpc {
    fn default() -> Self {
        Self::new()
    }
}

impl DiscordRpc {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<RpcCommand>();
        let _ = std::thread::Builder::new()
            .name("veluna-discord-rpc".to_string())
            .spawn(move || run_worker(rx));
        Self { tx }
    }

    pub fn set_enabled(&self, enabled: bool) {
        let _ = self.tx.send(RpcCommand::SetEnabled(enabled));
    }

    pub fn update(&self, payload: DiscordPresencePayload) {
        let _ = self.tx.send(RpcCommand::Update(payload));
    }
}

fn encode_frame(opcode: u32, payload: &Value) -> Option<Vec<u8>> {
    let body = serde_json::to_vec(payload).ok()?;
    let len = u32::try_from(body.len()).ok()?;
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&opcode.to_le_bytes());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&body);
    Some(out)
}

fn read_frame(pipe: &mut File) -> std::io::Result<(u32, Value)> {
    let mut header = [0u8; 8];
    pipe.read_exact(&mut header)?;
    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len == 0 || len > 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Invalid Discord IPC frame size",
        ));
    }
    let mut buf = vec![0u8; len];
    pipe.read_exact(&mut buf)?;
    let json = serde_json::from_slice(&buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok((opcode, json))
}

fn write_frame(pipe: &mut File, opcode: u32, payload: &Value) -> std::io::Result<()> {
    let frame = encode_frame(opcode, payload).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "Failed to encode frame")
    })?;
    pipe.write_all(&frame)?;
    pipe.flush()
}

fn truncate_chars(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

pub fn build_activity_payload(
    payload: Option<&DiscordPresencePayload>,
    now_epoch_sec: u64,
    pid: u32,
    nonce: u64,
) -> Value {
    let activity = payload.and_then(|p| {
        let title = p.title.trim();
        if title.is_empty() || !p.playing {
            return None;
        }
        let details = truncate_chars(&format!("Listening to {title}"), 128);
        let state_text = if p.artist.trim().is_empty() {
            "VelunaMusic".to_string()
        } else {
            truncate_chars(&p.artist, 128)
        };
        let large_image = p
            .artwork_url
            .as_deref()
            .map(str::trim)
            .filter(|u| u.starts_with("https://") && u.len() <= 256)
            .unwrap_or("veluna_logo");
        let large_text = if p.album.trim().is_empty() {
            "VelunaMusic".to_string()
        } else {
            truncate_chars(&p.album, 128)
        };

        let mut act = json!({
            "type": 2,
            "details": details,
            "state": state_text,
            "assets": {
                "large_image": large_image,
                "large_text": large_text
            },
            "buttons": [
                {
                    "label": "VelunaMusic",
                    "url": WEBSITE_URL
                }
            ]
        });

        if p.duration_sec.is_finite() && p.duration_sec > 0.0 {
            let pos = if p.position_sec.is_finite() && p.position_sec >= 0.0 {
                p.position_sec.min(p.duration_sec)
            } else {
                0.0
            };
            let start = now_epoch_sec.saturating_sub(pos.round() as u64);
            let end = start.saturating_add(p.duration_sec.round() as u64);
            act["timestamps"] = json!({
                "start": start,
                "end": end
            });
        }
        Some(act)
    });

    json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": pid,
            "activity": activity
        },
        "nonce": format!("veluna-{nonce}")
    })
}

fn connect_discord_pipe(client_id: &str) -> Option<File> {
    #[cfg(target_os = "windows")]
    {
        for idx in 0..=9 {
            let path = format!(r"\\?\pipe\discord-ipc-{idx}");
            let Ok(mut pipe) = OpenOptions::new().read(true).write(true).open(&path) else {
                continue;
            };
            let handshake = json!({ "v": 1, "client_id": client_id });
            if write_frame(&mut pipe, OP_HANDSHAKE, &handshake).is_err() {
                continue;
            }
            if let Ok((op, _)) = read_frame(&mut pipe) {
                if op == OP_FRAME {
                    return Some(pipe);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = client_id;
        None
    }
}

fn run_worker(rx: mpsc::Receiver<RpcCommand>) {
    let client_id = std::env::var("VELUNA_DISCORD_CLIENT_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
    let pid = std::process::id();
    let mut enabled = false;
    let mut last_payload: Option<DiscordPresencePayload> = None;
    let mut pipe: Option<File> = None;
    let mut last_connect_attempt: Option<Instant> = None;
    let mut nonce: u64 = 0;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            RpcCommand::SetEnabled(next) => {
                enabled = next;
                if !enabled {
                    if let Some(ref mut p) = pipe {
                        nonce += 1;
                        let clear = build_activity_payload(None, 0, pid, nonce);
                        let _ = write_frame(p, OP_FRAME, &clear);
                    }
                    pipe = None;
                    continue;
                }
            }
            RpcCommand::Update(payload) => {
                last_payload = Some(payload);
            }
        }

        if !enabled {
            continue;
        }

        if pipe.is_none() {
            let cooldown_ok = last_connect_attempt
                .is_none_or(|t| t.elapsed() >= Duration::from_secs(15));
            if !cooldown_ok {
                continue;
            }
            last_connect_attempt = Some(Instant::now());
            pipe = connect_discord_pipe(&client_id);
            if pipe.is_none() {
                continue;
            }
        }

        let now_sec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        nonce += 1;
        let frame = build_activity_payload(last_payload.as_ref(), now_sec, pid, nonce);

        if let Some(ref mut active_pipe) = pipe {
            if write_frame(active_pipe, OP_FRAME, &frame).is_err() {
                pipe = None;
                continue;
            }
            match read_frame(active_pipe) {
                Ok((OP_PING, ping_body)) => {
                    let _ = write_frame(active_pipe, OP_PONG, &ping_body);
                }
                Ok(_) => {}
                Err(_) => {
                    pipe = None;
                }
            }
        }
    }
}

#[tauri::command]
pub fn discord_rpc_set_enabled(
    state: tauri::State<DiscordRpc>,
    enabled: bool,
) -> Result<(), String> {
    state.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_update(
    state: tauri::State<DiscordRpc>,
    payload: DiscordPresencePayload,
) -> Result<(), String> {
    state.update(payload);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_discord_ipc_frame_and_builds_listening_activity() {
        let payload = DiscordPresencePayload {
            title: "Cobalt Midnight".to_string(),
            artist: "Veluna Artist".to_string(),
            album: "Liquid Glass EP".to_string(),
            artwork_url: Some("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg".to_string()),
            playing: true,
            position_sec: 45.0,
            duration_sec: 210.0,
        };
        let msg = build_activity_payload(Some(&payload), 1_700_000_100, 4242, 7);
        assert_eq!(msg["cmd"], "SET_ACTIVITY");
        assert_eq!(msg["args"]["pid"], 4242);
        assert_eq!(msg["args"]["activity"]["type"], 2);
        assert_eq!(msg["args"]["activity"]["details"], "Listening to Cobalt Midnight");
        assert_eq!(msg["args"]["activity"]["state"], "Veluna Artist");
        assert_eq!(msg["args"]["activity"]["timestamps"]["start"], 1_700_000_055);
        assert_eq!(msg["args"]["activity"]["timestamps"]["end"], 1_700_000_265);
        assert_eq!(
            msg["args"]["activity"]["assets"]["large_image"],
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
        );
        assert_eq!(
            msg["args"]["activity"]["buttons"][0]["url"],
            "https://veluna.siloneedsleep.xyz"
        );

        let wire = encode_frame(OP_FRAME, &msg).expect("wire frame");
        assert_eq!(u32::from_le_bytes([wire[0], wire[1], wire[2], wire[3]]), OP_FRAME);
        let body_len = u32::from_le_bytes([wire[4], wire[5], wire[6], wire[7]]) as usize;
        assert_eq!(body_len + 8, wire.len());

        let paused = DiscordPresencePayload {
            playing: false,
            ..payload
        };
        let cleared = build_activity_payload(Some(&paused), 1_700_000_100, 4242, 8);
        assert!(cleared["args"]["activity"].is_null());
    }
}
