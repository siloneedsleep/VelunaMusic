# veluna-mcp

Model Context Protocol (MCP) server for **VelunaMusic**, written in Rust on top of `veluna-core` using JSON-RPC 2.0 over `stdio` (`2024-11-05` and `2025-03-26`). All diagnostic output is written strictly to `stderr` so `stdout` carries clean JSON-RPC frames.

## Build

```sh
cargo build --release -p veluna-mcp
```

The compiled binary is written to:
- Windows: `target/release/veluna-mcp.exe`
- Linux / macOS: `target/release/veluna-mcp`

## Client Configuration (`mcpServers`)

Add the following entry to Antigravity, Claude Desktop, Codex, or Orbis Agent:

```json
{
  "mcpServers": {
    "veluna-music": {
      "command": "/path/to/VelunaMusic/target/release/veluna-mcp",
      "args": [],
      "env": {
        "VELUNA_SUPABASE_URL": "https://vkzrgfiopdnujookplbv.supabase.co",
        "VELUNA_SUPABASE_KEY": "sb_publishable_BlbgnOiDqur6plECJLrA3g_ZTU4C9a1",
        "VELUNA_SUPABASE_ACCESS_TOKEN": "<optional-user-jwt-for-remote-handoff>",
        "VELUNA_DEVICE_ID": "<optional-uuid-for-this-agent>"
      }
    }
  }
}
```

## Tools

| Tool | Description | Key Parameters |
| --- | --- | --- |
| `ytm_search` | Search songs, videos, albums, and playlists on YouTube Music via `veluna-core`. | `query`, `filter` (`all\|songs\|videos\|albums\|playlists\|artists`), `limit` (default `10`) |
| `ytm_home_feed` | Fetch YouTube Music Home (`FEmusic_home`) shelves and Mood filter chips. | `mood_params` (optional), `continuation` (optional) |
| `ytm_resolve_track` | Resolve track metadata, duration, high-resolution artwork URLs, and stream availability. | `video_id`, `force_refresh` (optional) |
| `dj_analyze_automix` | Compute `cueInMs`, `cueOutMs`, `crossfadeMs`, and Equal-Power `cos/sin` curve via `core/src/dj.rs`. | `track_a_path`/`track_b_path` or duration/BPM overrides, `style` (`gentle\|party\|album`), `fixed_seconds` |
| `remote_handoff_command` | Dispatch `play`, `pause`, `next`, `previous`, or `handoff` commands to a VelunaMusic device via Supabase RPC. | `action`, `target_device_id`, `playback_instance`, `queue_version`, `track_digest`, `dry_run` |

## Resources

| URI | MIME Type | Contents |
| --- | --- | --- |
| `veluna://architecture/overview` | `application/json` | Workspace overview (`core/`, `windows/`, `android/`, `ui/`, `mcp/`) and module statuses. |
| `veluna://config/mcp-snippet` | `application/json` | Ready-to-paste `mcpServers` client configuration JSON. |

## Tests

```sh
cargo test --locked -p veluna-mcp
cargo clippy --workspace --all-targets --locked -- -D warnings
```
