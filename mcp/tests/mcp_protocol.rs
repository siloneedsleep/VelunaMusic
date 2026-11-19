use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use veluna_mcp::server::serve_stdio;

fn write_test_wav(name: &str, seconds: u32, intro_period: u32, outro_period: u32) -> PathBuf {
    let rate = 8000_u32;
    let frames = rate * seconds;
    let path = std::env::temp_dir().join(format!(
        "veluna-mcp-{}-{}-{}.wav",
        name,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let mut out = BufWriter::new(File::create(&path).expect("create wav"));
    let size = frames * 2;
    out.write_all(b"RIFF").expect("riff");
    out.write_all(&(size + 36).to_le_bytes()).expect("size");
    out.write_all(b"WAVEfmt ").expect("wavefmt");
    out.write_all(&16u32.to_le_bytes()).expect("fmt len");
    for n in [1_u16, 1] {
        out.write_all(&n.to_le_bytes()).expect("pcm/ch");
    }
    for n in [rate, rate * 2] {
        out.write_all(&n.to_le_bytes()).expect("rate/byte");
    }
    for n in [2_u16, 16] {
        out.write_all(&n.to_le_bytes()).expect("align/bits");
    }
    out.write_all(b"data").expect("data");
    out.write_all(&size.to_le_bytes()).expect("data size");
    let silence_frames = rate / 4;
    for frame in 0..frames {
        let pulse = if frame < silence_frames {
            0i16
        } else {
            let period = if frame < frames / 2 {
                intro_period
            } else {
                outro_period
            };
            if frame % period < 160 {
                9000_i16
            } else {
                0
            }
        };
        out.write_all(&pulse.to_le_bytes()).expect("sample");
    }
    out.flush().expect("flush");
    path
}

async fn send_rpc(
    tx: &mut tokio::io::DuplexStream,
    rx: &mut BufReader<tokio::io::DuplexStream>,
    req: Value,
) -> Value {
    let encoded = serde_json::to_string(&req).expect("serialize request");
    tx.write_all(encoded.as_bytes()).await.expect("write");
    tx.write_all(b"\n").await.expect("newline");
    tx.flush().await.expect("flush");

    let mut line = String::new();
    let n = rx.read_line(&mut line).await.expect("read line");
    assert!(n > 0, "expected JSON-RPC response line");
    serde_json::from_str(&line).expect("parse response json")
}

#[tokio::test]
async fn mcp_stdio_lifecycle_tools_and_resources() {
    let (mut client_tx, server_rx) = tokio::io::duplex(64 * 1024);
    let (server_tx, client_rx) = tokio::io::duplex(64 * 1024);
    let server_task = tokio::spawn(async move {
        serve_stdio(BufReader::new(server_rx), server_tx)
            .await
            .expect("serve_stdio");
    });

    let mut reader = BufReader::new(client_rx);

    let init = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "test-client", "version": "1.0.0" }
            }
        }),
    )
    .await;
    assert_eq!(init["jsonrpc"], "2.0");
    assert_eq!(init["id"], 1);
    assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(init["result"]["serverInfo"]["name"], "veluna-mcp");
    assert!(init["result"]["capabilities"]["tools"].is_object());
    assert!(init["result"]["capabilities"]["resources"].is_object());

    client_tx
        .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
        .await
        .expect("send initialized notification");
    client_tx.flush().await.expect("flush");

    let ping = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }),
    )
    .await;
    assert_eq!(ping["id"], 2);
    assert_eq!(ping["result"], json!({}));

    let tools_list = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }),
    )
    .await;
    let tools = tools_list["result"]["tools"].as_array().expect("tools array");
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str))
        .collect();
    assert_eq!(
        names,
        vec![
            "ytm_search",
            "ytm_home_feed",
            "ytm_resolve_track",
            "dj_analyze_automix",
            "remote_handoff_command"
        ]
    );

    let wav_a = write_test_wav("track-a", 28, 4000, 4000);
    let wav_b = write_test_wav("track-b", 28, 4000, 4000);
    let dj_call = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "dj_analyze_automix",
                "arguments": {
                    "track_a_path": wav_a.to_string_lossy(),
                    "track_b_path": wav_b.to_string_lossy(),
                    "style": "gentle"
                }
            }
        }),
    )
    .await;
    let _ = std::fs::remove_file(&wav_a);
    let _ = std::fs::remove_file(&wav_b);

    assert_eq!(dj_call["result"]["isError"], false);
    let text = dj_call["result"]["content"][0]["text"]
        .as_str()
        .expect("dj tool text");
    let parsed: Value = serde_json::from_str(text).expect("dj payload json");
    assert_eq!(parsed["crossfadeMs"], 4000);
    assert_eq!(parsed["cueOutMs"], 24000);
    assert!(parsed["cueInMs"].as_u64().expect("cueInMs") >= 200);
    let curve = parsed["equalPowerCurve"].as_array().expect("curve");
    assert_eq!(curve.len(), 5);
    assert_eq!(curve[2]["energySum"], 1.0);

    let handoff_call = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "remote_handoff_command",
                "arguments": {
                    "action": "handoff",
                    "target_device_id": "11111111-1111-4111-8111-111111111111",
                    "sender_device_id": "22222222-2222-4222-8222-222222222222",
                    "track_title": "Cobalt Wave",
                    "track_digest": "ytmusic://dQw4w9WgXcQ",
                    "dry_run": true
                }
            }
        }),
    )
    .await;
    assert_eq!(handoff_call["result"]["isError"], false);
    assert_eq!(handoff_call["result"]["structuredContent"]["dryRun"], true);
    assert_eq!(
        handoff_call["result"]["structuredContent"]["payload"]["p_digest"],
        "ytmusic://dQw4w9WgXcQ"
    );

    let play_call = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "remote_handoff_command",
                "arguments": {
                    "action": "play",
                    "target_device_id": "11111111-1111-4111-8111-111111111111",
                    "dry_run": true
                }
            }
        }),
    )
    .await;
    assert_eq!(play_call["result"]["isError"], false);
    assert_eq!(
        play_call["result"]["structuredContent"]["payload"]["p_action"],
        "play"
    );

    let resources_list = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 7, "method": "resources/list" }),
    )
    .await;
    let resources = resources_list["result"]["resources"]
        .as_array()
        .expect("resources array");
    assert_eq!(resources.len(), 2);

    let overview = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "resources/read",
            "params": { "uri": "veluna://architecture/overview" }
        }),
    )
    .await;
    let overview_text = overview["result"]["contents"][0]["text"]
        .as_str()
        .expect("overview text");
    let overview_json: Value = serde_json::from_str(overview_text).expect("overview json");
    assert_eq!(overview_json["project"], "VelunaMusic");
    assert_eq!(overview_json["workspace"]["mcp"]["crate"], "veluna-mcp");

    let snippet = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "resources/read",
            "params": { "uri": "veluna://config/mcp-snippet" }
        }),
    )
    .await;
    let snippet_text = snippet["result"]["contents"][0]["text"]
        .as_str()
        .expect("snippet text");
    let snippet_json: Value = serde_json::from_str(snippet_text).expect("snippet json");
    assert!(snippet_json["mcpServers"]["veluna-music"]["command"].is_string());

    let unknown = send_rpc(
        &mut client_tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 10, "method": "unknown/method" }),
    )
    .await;
    assert_eq!(unknown["error"]["code"], -32601);

    drop(client_tx);
    server_task.await.expect("server exit");
}
