use crate::protocol::INVALID_PARAMS;
use serde_json::{json, Value};

pub const URI_ARCHITECTURE_OVERVIEW: &str = "veluna://architecture/overview";
pub const URI_MCP_SNIPPET: &str = "veluna://config/mcp-snippet";

pub fn list_resources() -> Vec<Value> {
    vec![
        json!({
            "uri": URI_ARCHITECTURE_OVERVIEW,
            "name": "VelunaMusic Architecture Overview",
            "description": "Workspace layout (core, windows, android, ui, mcp) and module capabilities.",
            "mimeType": "application/json"
        }),
        json!({
            "uri": URI_MCP_SNIPPET,
            "name": "VelunaMusic MCP Client Config Snippet",
            "description": "Ready-to-use mcpServers JSON snippet for Antigravity, Claude Desktop, Codex, and Orbis Agent.",
            "mimeType": "application/json"
        }),
    ]
}

pub fn read_resource(uri: &str) -> Result<Value, (i32, String)> {
    match uri {
        URI_ARCHITECTURE_OVERVIEW => {
            let payload = json!({
                "project": "VelunaMusic",
                "version": env!("CARGO_PKG_VERSION"),
                "license": "GPL-3.0-only",
                "workspace": {
                    "core": {
                        "crate": "veluna-core",
                        "crateTypes": ["rlib", "cdylib"],
                        "status": "active",
                        "modules": [
                            "ytmusic (InnerTube WEB_REMIX/ANDROID_MUSIC/VISIONOS/TVHTML5, search, FEmusic_home, stream resolver, cipher, lyrics)",
                            "dj (Symphonia decoding, BPM/RMS intro-outro analysis, cue-in detection, equal-power crossfade)",
                            "media (ID3/MP4/FLAC/WAV tag & embedded cover reader)",
                            "jni (Android native bindings)"
                        ]
                    },
                    "windows": {
                        "crate": "velunamusic",
                        "framework": "Tauri v2",
                        "status": "active",
                        "modules": [
                            "main.rs (IPC commands, tray icon, single-instance, deep links)",
                            "stream_server.rs (Axum loopback Range streamer with capability token)",
                            "nearby.rs (TLS + QR pinned LAN transfer & mDNS)",
                            "vault.rs (Windows Credential Manager)",
                            "ytmusic.rs (Tauri async bindings to veluna-core)"
                        ]
                    },
                    "android": {
                        "package": "xyz.siloneedsleep.veluna",
                        "framework": "Media3 ExoPlayer + WebView + JNI",
                        "status": "active",
                        "modules": [
                            "MainActivity (edge-to-edge safe insets, JavascriptInterface bridge)",
                            "PlaybackService & AutoMix (foreground playback, pre-resolve, equal-power crossfade)",
                            "RemotePlayback, CommandInbox & NativeHandoff (Supabase Realtime + latency-compensated handoff)",
                            "NearbyClient (TLS LAN sender with certificate pinning)"
                        ]
                    },
                    "ui": {
                        "status": "active",
                        "design": "Spotify Desktop + High-Density Dark Glass & Spotify Mobile Sheet",
                        "modules": [
                            "Unified Search (0ms local + debounced InnerTube with searchSeqId)",
                            "YouTube Music Home (FEmusic_home mood chips & horizontal carousels)",
                            "Gapless & Equal-Power Crossfade dual-deck controller",
                            "Spotify Connect-style Device Picker Sheet"
                        ]
                    },
                    "mcp": {
                        "crate": "veluna-mcp",
                        "transport": "JSON-RPC 2.0 over stdio",
                        "protocolVersions": ["2025-03-26", "2024-11-05"],
                        "status": "active",
                        "tools": [
                            "ytm_search",
                            "ytm_home_feed",
                            "ytm_resolve_track",
                            "dj_analyze_automix",
                            "remote_handoff_command"
                        ],
                        "resources": [
                            URI_ARCHITECTURE_OVERVIEW,
                            URI_MCP_SNIPPET
                        ]
                    }
                }
            });
            let text =
                serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
            Ok(json!({
                "contents": [
                    {
                        "uri": URI_ARCHITECTURE_OVERVIEW,
                        "mimeType": "application/json",
                        "text": text
                    }
                ]
            }))
        }
        URI_MCP_SNIPPET => {
            let snippet = json!({
                "mcpServers": {
                    "veluna-music": {
                        "command": "/path/to/VelunaMusic/target/release/veluna-mcp",
                        "args": [],
                        "env": {
                            "VELUNA_SUPABASE_URL": "https://vkzrgfiopdnujookplbv.supabase.co",
                            "VELUNA_SUPABASE_KEY": "sb_publishable_BlbgnOiDqur6plECJLrA3g_ZTU4C9a1",
                            "VELUNA_SUPABASE_ACCESS_TOKEN": "<optional-user-jwt-for-remote-handoff>",
                            "VELUNA_DEVICE_ID": "<optional-uuid-for-this-agent-device>"
                        }
                    }
                }
            });
            let text =
                serde_json::to_string_pretty(&snippet).unwrap_or_else(|_| snippet.to_string());
            Ok(json!({
                "contents": [
                    {
                        "uri": URI_MCP_SNIPPET,
                        "mimeType": "application/json",
                        "text": text
                    }
                ]
            }))
        }
        other => Err((INVALID_PARAMS, format!("Unknown resource URI: {other}"))),
    }
}
