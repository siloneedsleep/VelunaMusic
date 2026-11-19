use crate::protocol::{
    negotiate_protocol, JsonRpcRequest, JsonRpcResponse, INVALID_PARAMS, INVALID_REQUEST,
    JSONRPC_VERSION, METHOD_NOT_FOUND, PARSE_ERROR,
};
use crate::resources::{list_resources, read_resource};
use crate::tools::{call_tool, list_tools};
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub struct McpServer {
    initialized: bool,
    protocol_version: String,
}

impl Default for McpServer {
    fn default() -> Self {
        Self::new()
    }
}

impl McpServer {
    pub fn new() -> Self {
        Self {
            initialized: false,
            protocol_version: crate::protocol::PROTOCOL_LATEST.to_string(),
        }
    }

    pub async fn handle_line(&mut self, raw: &str) -> Option<JsonRpcResponse> {
        let req: JsonRpcRequest = match serde_json::from_str(raw) {
            Ok(parsed) => parsed,
            Err(err) => {
                return Some(JsonRpcResponse::err(
                    Value::Null,
                    PARSE_ERROR,
                    format!("Parse error: {err}"),
                    None,
                ));
            }
        };

        if req.jsonrpc != JSONRPC_VERSION {
            return req.id.map(|id| {
                JsonRpcResponse::err(id, INVALID_REQUEST, "Unsupported jsonrpc version", None)
            });
        }

        let Some(id) = req.id else {
            if req.method == "notifications/initialized" {
                self.initialized = true;
                eprintln!("[veluna-mcp] client initialized ({})", self.protocol_version);
            }
            return None;
        };

        let response = match req.method.as_str() {
            "initialize" => {
                let requested = req.params.get("protocolVersion").and_then(Value::as_str);
                let negotiated = negotiate_protocol(requested);
                self.protocol_version = negotiated.to_string();
                JsonRpcResponse::ok(
                    id,
                    json!({
                        "protocolVersion": negotiated,
                        "capabilities": {
                            "tools": { "listChanged": false },
                            "resources": { "subscribe": false, "listChanged": false }
                        },
                        "serverInfo": {
                            "name": "veluna-mcp",
                            "version": env!("CARGO_PKG_VERSION")
                        }
                    }),
                )
            }
            "ping" => JsonRpcResponse::ok(id, json!({})),
            "tools/list" => JsonRpcResponse::ok(id, json!({ "tools": list_tools() })),
            "tools/call" => {
                let Some(tool_name) = req.params.get("name").and_then(Value::as_str) else {
                    return Some(JsonRpcResponse::err(
                        id,
                        INVALID_PARAMS,
                        "Missing required parameter: name",
                        None,
                    ));
                };
                let args = req
                    .params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match call_tool(tool_name, &args).await {
                    Ok(result) => JsonRpcResponse::ok(id, result),
                    Err((code, message)) => JsonRpcResponse::err(id, code, message, None),
                }
            }
            "resources/list" => JsonRpcResponse::ok(id, json!({ "resources": list_resources() })),
            "resources/read" => {
                let Some(uri) = req.params.get("uri").and_then(Value::as_str) else {
                    return Some(JsonRpcResponse::err(
                        id,
                        INVALID_PARAMS,
                        "Missing required parameter: uri",
                        None,
                    ));
                };
                match read_resource(uri) {
                    Ok(result) => JsonRpcResponse::ok(id, result),
                    Err((code, message)) => JsonRpcResponse::err(id, code, message, None),
                }
            }
            other => JsonRpcResponse::err(
                id,
                METHOD_NOT_FOUND,
                format!("Method not found: {other}"),
                None,
            ),
        };

        Some(response)
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
}

async fn read_message<R: AsyncBufRead + Unpin>(reader: &mut R) -> std::io::Result<Option<String>> {
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(len_str) = trimmed
            .strip_prefix("Content-Length:")
            .or_else(|| trimmed.strip_prefix("content-length:"))
        {
            let content_len = len_str
                .trim()
                .parse::<usize>()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid Content-Length"))?;
            let mut header_line = String::new();
            loop {
                header_line.clear();
                let h = reader.read_line(&mut header_line).await?;
                if h == 0 || header_line.trim().is_empty() {
                    break;
                }
            }
            let mut body = vec![0u8; content_len];
            reader.read_exact(&mut body).await?;
            let text = String::from_utf8(body)
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid UTF-8 body"))?;
            return Ok(Some(text));
        }
        return Ok(Some(trimmed.to_string()));
    }
}

pub async fn serve_stdio<R, W>(mut reader: R, mut writer: W) -> std::io::Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut server = McpServer::new();
    while let Some(message) = read_message(&mut reader).await? {
        if let Some(response) = server.handle_line(&message).await {
            let encoded = serde_json::to_string(&response)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            writer.write_all(encoded.as_bytes()).await?;
            writer.write_all(b"\n").await?;
            writer.flush().await?;
        }
    }
    Ok(())
}
